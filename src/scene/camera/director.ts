/**
 * The camera director: the only code that moves the camera. (Adapted from FAB / ONE Humanoid's
 * director, whose velocity-continuous moves fixed the camera snaps and restarts of earlier
 * simulations; here the keep-outs are the car's body and the floor.)
 *
 * A camera state is an orbit about a target: azimuth, elevation, distance, field of view, and
 * a lens shift. A shot names a destination state (its target may follow an anchor on the
 * car), how long to get there, how the camera may drift while it holds, and how far the
 * visitor may orbit.
 *
 * Transitions are velocity-continuous: each parameter follows a quintic from the camera's
 * state *and velocity* at the moment the transition starts to the destination at rest. A new
 * shot requested mid-move therefore starts from the picture shown and how it is moving. The
 * carried velocity is bounded, so a fast fling or a sharp reversal never turns into a wide
 * overshoot. Asking again for the shot already being approached does not restart it.
 *
 * The path is planned clear of the car: before a move starts, the director samples it against
 * the body's collision capsules with the near plane's clearance, and if it passes too close it
 * swings the path out — a smooth dolly-out and rise that is zero at both ends — or, if the
 * destination itself is too close, settles further out. While holding, a soft avoidance keeps
 * a moving body (bouncing over a bump, opening its doors) out of the lens. A last-resort clamp
 * exists and is reported to the developer telemetry if it ever acts. The camera never goes
 * below the floor.
 *
 * Two clocks: shot moves, drift and follow run on the presentation clock (they stop while
 * the tour is paused); the visitor's orbit and its inertia run on the input clock. All
 * damping uses elapsed time, and a fling's speed comes from the pointer events' timestamps,
 * so behaviour does not depend on the frame or event rate.
 */
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

export interface CamState {
  target: Vector3;
  az: number;
  el: number;
  dist: number;
  fov: number;
  /** Lens shift as a fraction of the view (x: + moves the subject left on screen), so the
   * subject sits beside the interface instead of under it. */
  ox: number;
  oy: number;
}

export interface Shot {
  id: string;
  /** Destination target (world), or a function evaluated every frame (following an anchor). */
  target: Vector3 | (() => Vector3);
  az: number;
  el: number;
  dist: number;
  fov?: number;
  /** Lens shift (see CamState). */
  ox?: number;
  oy?: number;
  /** What the shot is about, as a box around its target (m): width across the view, height.
   * The camera keeps it inside the part of the view the interface leaves free (default: from
   * the shot's distance, as it was composed on a desktop screen). */
  subject?: { w: number; h: number };
  /** On a phone held upright: an extra vertical lens shift, for a composition that needs it. */
  phone?: { oy?: number };
  /** Transition time, s (default from how far the camera travels). */
  duration?: number;
  /** Slow orbit while holding, rad/s, and a gentle elevation sway amplitude, rad. */
  drift?: number;
  sway?: number;
  /** How closely a following shot tracks its anchor (rad/s; default 3.5). */
  follow?: number;
  /** What the visitor may do while the shot holds. */
  orbit?: { az?: [number, number] | null; el?: [number, number]; dist?: [number, number] } | false;
}

/** Something the camera must stay out of: a capsule from a to b with radius r (world). */
export interface KeepOut {
  a: Vector3;
  b: Vector3;
  r: number;
  id?: string;
}

const TAU = Math.PI * 2;

function quintic(p0: number, v0: number, p1: number, u: number): number {
  const d = p1 - p0;
  const a3 = 10 * d - 6 * v0;
  const a4 = -15 * d + 8 * v0;
  const a5 = 6 * d - 3 * v0;
  return p0 + v0 * u + a3 * u * u * u + a4 * u * u * u * u + a5 * u * u * u * u * u;
}

/** A bump that is 0 with zero slope and curvature at both ends and 1 in the middle. */
function bump(u: number): number {
  const x = u * (1 - u);
  return 64 * x * x * x;
}

function wrap(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Keep a carried velocity from overshooting: |v0·T| no more than k·|d| + floor. */
function boundV(v0: number, d: number, T: number, floor: number, k = 2.2): number {
  const lim = (k * Math.abs(d) + floor) / Math.max(1e-3, T);
  return MathUtils.clamp(v0, -lim, lim);
}

export function positionOf(s: CamState, out = new Vector3()): Vector3 {
  const c = Math.cos(s.el);
  return out.set(s.target.x + s.dist * c * Math.sin(s.az), s.target.y + s.dist * Math.sin(s.el), s.target.z + s.dist * c * Math.cos(s.az));
}

const _ab = new Vector3();
const _ap = new Vector3();
function capsuleClearance(k: KeepOut, p: Vector3): number {
  _ab.subVectors(k.b, k.a);
  _ap.subVectors(p, k.a);
  const L2 = _ab.lengthSq();
  const t = L2 > 1e-12 ? MathUtils.clamp(_ap.dot(_ab) / L2, 0, 1) : 0;
  return Math.hypot(p.x - (k.a.x + _ab.x * t), p.y - (k.a.y + _ab.y * t), p.z - (k.a.z + _ab.z * t)) - k.r;
}

interface Plan {
  /** Dolly-out and rise applied along the path (0 at both ends). */
  k: number;
  ke: number;
}

export class Director {
  camera: PerspectiveCamera;
  /** The state the camera shows now (before the visitor's offsets and the avoidance). */
  cur: CamState = { target: new Vector3(0, 0.6, 0), az: 2.2, el: 0.15, dist: 8, fov: 30, ox: 0, oy: 0 };
  /** Rate of change of each parameter (per second), for velocity-continuous transitions. */
  private vel = { t: new Vector3(), az: 0, el: 0, dist: 0, fov: 0, ox: 0, oy: 0 };
  private prev: CamState | null = null;
  shot: Shot | null = null;
  private from: CamState | null = null;
  private fromVel = { t: new Vector3(), az: 0, el: 0, dist: 0, fov: 0, ox: 0, oy: 0 };
  private dur = 1;
  private t = 0;
  private plan: Plan = { k: 0, ke: 0 };
  /** Destination distance factor when the shot's own distance is too close to the car. */
  private endScale = 1;
  /** The visitor's orbit offsets on top of the shot. */
  user = { az: 0, el: 0, zoom: 1 };
  private userVel = { az: 0, el: 0 };
  private driftPhase = 0;
  /** Static obstacles (props); the car's come from `obstacles`. */
  keepOut: KeepOut[] = [];
  /** Moving obstacles, read every frame (the car's collision capsules). */
  obstacles: () => readonly KeepOut[] = () => [];
  /** Soft avoidance while holding: extra distance factor and its rate. */
  private avoid = 0;
  private avoidV = 0;
  /** A transition is running. */
  moving = false;
  /** Counts transitions started (telemetry: which move a frame belongs to). */
  transitionId = 0;
  /** Called if the last-resort clamp had to push the camera out (telemetry). */
  onClamp?: (by: number) => void;
  /** Called when a move starts, with the shot and the move's duration (telemetry). */
  onMove?: (shot: string, duration: number) => void;
  /** Time scale for reduced motion (transitions become short cross-moves). */
  reducedMotion = false;
  floor = 0.08;
  ceiling = 7;
  /** Viewport size (for the lens shift) and a compact layout flag (phones: no side shift). */
  viewW = 1280;
  viewH = 800;
  compact = false;
  /** The part of the view the interface leaves free (fractions: left, top, right, bottom),
   * measured from the page's header and panels. Shots keep their subject inside it. */
  free = { l: 0, t: 0, r: 1, b: 1 };
  /** `free` as the framing uses it: followed by a critically damped spring, so a change of
   * layout (a caption of another length, a sheet collapsing) reframes smoothly, even mid-move. */
  private freeNow = { l: 0, t: 0, r: 1, b: 1 };
  private freeV = { l: 0, t: 0, r: 0, b: 0 };
  /** The framing's own drift (distance and lens shift moving with the layout), per second, and
   * the hold's springs, which start from it when a move ends: no stop-start at the handover. */
  private endPrev: { dist: number; ox: number; oy: number } | null = null;
  private endVel = { dist: 0, ox: 0, oy: 0 };
  private holdV = { dist: 0, ox: 0, oy: 0 };
  /** The followed target, filtered (a shot's anchor, without the body's millimetre motion). */
  private follow = new Vector3();
  private followV = new Vector3();
  private dragging = false;

  constructor(camera: PerspectiveCamera) {
    this.camera = camera;
  }

  /** The shot's subject box (m): given, or what its composed distance frames on a desktop. */
  private subjectOf(s: Shot): { w: number; h: number } {
    if (s.subject) return s.subject;
    const span = 2 * s.dist * Math.tan(((s.fov ?? 30) * Math.PI) / 360);
    // wide shots frame the car (wider than tall), close-ups leave room around the part
    const h = span * (s.dist > 3.5 ? 0.5 : 0.62);
    return { w: h * (s.dist > 3.5 ? 2.4 : 1.2), h };
  }

  /**
   * The distance that fits the subject in the free part of the view (margins included). On a
   * desktop the composed distance stands when the subject fits; on a phone the fit decides.
   */
  private fitDist(s: Shot): number {
    const sub = this.subjectOf(s);
    const f = this.freeNow;
    const tan = Math.tan(((s.fov ?? 30) * Math.PI) / 360);
    const fh = Math.max(0.2, f.b - f.t) * 0.9;
    const fw = Math.max(0.2, f.r - f.l) * 0.92;
    const aspect = this.viewW / Math.max(1, this.viewH);
    return Math.max(sub.h / (2 * tan * fh), sub.w / (2 * tan * aspect * fw));
  }

  private distOf(s: Shot): number {
    const d = this.compact ? this.fitDist(s) : Math.max(s.dist, this.fitDist(s));
    return d * this.endScale;
  }

  /** Half the subject's size on screen, as fractions of the view (at the shot's distance). */
  private halfSize(s: Shot): { x: number; y: number } {
    const sub = this.subjectOf(s);
    const span = 2 * this.distOf(s) * Math.tan(((s.fov ?? 30) * Math.PI) / 360);
    return { x: sub.w / (2 * span * (this.viewW / Math.max(1, this.viewH))), y: sub.h / (2 * span) };
  }

  /**
   * The shot's horizontal lens shift for the current layout: as composed (none on phones),
   * moved only as far as needed to keep the subject in the free part of the view. The subject
   * appears at 0.5 − ox across the view.
   */
  private lensX(s: Shot): number {
    const f = this.freeNow;
    const half = this.halfSize(s).x;
    const want = 0.5 - (this.compact ? 0 : (s.ox ?? 0));
    const lo = f.l + 0.02 + half;
    const hi = f.r - 0.02 - half;
    const x = lo <= hi ? MathUtils.clamp(want, lo, hi) : (f.l + f.r) / 2;
    return 0.5 - x;
  }

  /** Vertical lens shift, likewise: the subject appears at 0.5 + oy down the view. On phones it
   * is centred in the room above the sheet. */
  private lensY(s: Shot): number {
    const f = this.freeNow;
    const half = this.halfSize(s).y;
    const want = this.compact ? (f.t + f.b) / 2 + (this.viewH > this.viewW ? (s.phone?.oy ?? 0) : 0) : 0.5 + (s.oy ?? 0);
    const lo = f.t + 0.02 + half;
    const hi = f.b - 0.02 - half;
    const y = lo <= hi ? MathUtils.clamp(want, lo, hi) : (f.t + f.b) / 2;
    return y - 0.5;
  }

  private targetOf(s: Shot): Vector3 {
    return typeof s.target === 'function' ? s.target() : s.target;
  }

  /** Clearance of a camera position from every obstacle, less the margin it needs (m). */
  clearanceAt(p: Vector3, dist: number): number {
    const margin = 0.05 + dist * 0.03;
    let c = Infinity;
    for (const k of this.obstacles()) c = Math.min(c, capsuleClearance(k, p));
    for (const k of this.keepOut) c = Math.min(c, capsuleClearance(k, p));
    return c - margin;
  }

  /** Start a shot from wherever the camera is, carrying its current motion. */
  go(shot: Shot, opts: { duration?: number; keepUser?: boolean; instant?: boolean; replan?: boolean } = {}) {
    // the same shot again while it is being approached or held: carry on
    if (!opts.instant && !opts.replan && this.shot && this.shot.id === shot.id && !opts.keepUser && opts.duration === undefined) {
      this.shot = shot;
      return;
    }
    this.transitionId++;
    // start from the camera as drawn (the visitor's offsets, the avoidance and any clearance
    // correction included), then clear the offsets
    const start = this.drawn ?? this.effective();
    this.from = { target: start.target.clone(), az: start.az, el: start.el, dist: start.dist, fov: start.fov, ox: start.ox, oy: start.oy };
    const v = this.vel;
    this.fromVel = { t: v.t.clone(), az: v.az, el: v.el, dist: v.dist, fov: v.fov, ox: v.ox, oy: v.oy };
    if (!opts.keepUser) {
      this.user = { az: 0, el: 0, zoom: 1 };
      this.userVel = { az: 0, el: 0 };
    }
    this.avoid = 0;
    this.avoidV = 0;
    this.cur = { ...this.from, target: this.from.target.clone() };
    this.shot = shot;
    this.endScale = 1;
    this.driftPhase = 0;
    this.t = 0;
    const dest = this.targetOf(shot);
    this.follow.copy(dest);
    this.followV.set(0, 0, 0);
    // duration from how far the camera travels: long enough that its acceleration stays near
    // A_MAX (a quintic's peak is about 5.8·D/T² over a distance D), and the view turns at a
    // comfortable rate. Most moves take 0.8–1.8 s.
    const dAz = Math.abs(wrap(shot.az - this.from.az));
    const dEl = Math.abs(shot.el - this.from.el);
    const d1 = this.distOf(shot);
    const dm = (this.from.dist + d1) / 2;
    const dT = dest.distanceTo(this.from.target);
    const travel = dm * (dAz * Math.cos((shot.el + this.from.el) / 2) + dEl) + Math.abs(d1 - this.from.dist) + dT;
    const auto = Math.max(0.8 + 0.25 * dAz + 0.4 * dEl, Math.sqrt((5.8 * travel) / A_MAX));
    this.dur = opts.instant ? 0 : (opts.duration ?? shot.duration ?? Math.min(2.4, Math.max(0.8, auto)));
    if (this.reducedMotion && !opts.instant) this.dur = Math.min(this.dur, 0.5);
    // bound the carried velocity so it cannot throw the path wide
    const T = Math.max(0.05, this.dur);
    const fv = this.fromVel;
    fv.az = boundV(MathUtils.clamp(fv.az, -1.6, 1.6), wrap(shot.az - this.from.az), T, 0.2);
    fv.el = boundV(MathUtils.clamp(fv.el, -1, 1), shot.el - this.from.el, T, 0.08);
    const d0 = Math.max(0.05, this.from.dist);
    fv.dist = boundV(MathUtils.clamp(fv.dist / d0, -1.5, 1.5), Math.log(this.distOf(shot) / d0), T, 0.12) * d0;
    fv.fov = boundV(MathUtils.clamp(fv.fov, -20, 20), (shot.fov ?? 30) - this.from.fov, T, 0.5);
    fv.ox = boundV(fv.ox, this.lensX(shot) - this.from.ox, T, 0.01);
    fv.oy = boundV(fv.oy, this.lensY(shot) - this.from.oy, T, 0.01);
    for (const ax of ['x', 'y', 'z'] as const) fv.t[ax] = boundV(MathUtils.clamp(fv.t[ax], -2, 2), dest[ax] - this.from.target[ax], T, 0.3);
    this.moving = this.dur > 0;
    this.planPath();
    if (!this.moving) this.snapToShot();
    else this.onMove?.(shot.id, this.dur);
  }

  /** The state along the planned move at u (0 … 1), without avoidance. */
  private sample(u: number, out: CamState): CamState {
    const s = this.shot!;
    const f = this.from!;
    const v = this.fromVel;
    const T = this.dur;
    const dest = this.follow;
    const azDest = f.az + wrap(s.az - f.az);
    out.az = quintic(f.az, v.az * T, azDest, u);
    out.el = quintic(f.el, v.el * T, s.el, u) + this.plan.ke * bump(u);
    out.dist = Math.exp(quintic(Math.log(f.dist), (v.dist / Math.max(0.05, f.dist)) * T, Math.log(this.distOf(s)), u)) * (1 + this.plan.k * bump(u));
    out.fov = quintic(f.fov, v.fov * T, s.fov ?? 30, u);
    out.ox = quintic(f.ox, v.ox * T, this.lensX(s), u);
    out.oy = quintic(f.oy, v.oy * T, this.lensY(s), u);
    out.target.set(quintic(f.target.x, v.t.x * T, dest.x, u), quintic(f.target.y, v.t.y * T, dest.y, u), quintic(f.target.z, v.t.z * T, dest.z, u));
    return out;
  }

  /** Choose the smallest swing-out that keeps the whole move clear of the car. */
  private planPath() {
    this.plan = { k: 0, ke: 0 };
    if (!this.shot || !this.from || (!this.obstacles().length && !this.keepOut.length)) return;
    const st: CamState = { target: new Vector3(), az: 0, el: 0, dist: 0, fov: 30, ox: 0, oy: 0 };
    const p = new Vector3();
    if (!this.moving) {
      // an instant shot that would sit inside the car settles further out
      for (let i = 0; i < 12; i++) {
        const s = this.shot;
        const probe: CamState = { target: this.targetOf(s).clone(), az: s.az, el: s.el, dist: this.distOf(s), fov: s.fov ?? 30, ox: 0, oy: 0 };
        if (this.clearanceAt(positionOf(probe, p), probe.dist) >= 0) break;
        this.endScale *= 1.08;
      }
      return;
    }
    // the destination first: a shot that would sit inside the car settles further out
    for (let i = 0; i < 12; i++) {
      this.sample(1, st);
      if (this.clearanceAt(positionOf(st, p), st.dist) >= 0) break;
      this.endScale *= 1.08;
    }
    const worst = () => {
      let m = Infinity;
      for (let i = 1; i < 32; i++) {
        this.sample(i / 32, st);
        m = Math.min(m, this.clearanceAt(positionOf(st, p), st.dist));
      }
      return m;
    };
    if (worst() >= 0) return;
    let best: Plan | null = null;
    let bestCost = Infinity;
    for (const k of [0.1, 0.2, 0.35, 0.5, 0.75, 1.0, 1.4]) {
      for (const ke of [0, 0.12, 0.25, 0.4]) {
        const cost = k + ke * 1.6;
        if (cost >= bestCost) continue;
        this.plan = { k, ke };
        if (worst() >= 0) {
          best = { k, ke };
          bestCost = cost;
        }
      }
    }
    this.plan = best ?? { k: 1.4, ke: 0.4 };
    if (best) this.dur = Math.min(3.4, this.dur * (1 + 0.25 * best.k));
  }

  private snapToShot() {
    const s = this.shot!;
    this.holdV = { dist: 0, ox: 0, oy: 0 };
    this.cur = { target: this.targetOf(s).clone(), az: s.az, el: s.el, dist: this.distOf(s), fov: s.fov ?? 30, ox: this.lensX(s), oy: this.lensY(s) };
    this.follow.copy(this.cur.target);
  }

  /** The state shown: with the visitor's orbit offsets and the avoidance. */
  effective(): CamState {
    return {
      target: this.cur.target.clone(),
      az: this.cur.az + this.user.az,
      el: this.cur.el + this.user.el,
      dist: this.cur.dist * this.user.zoom * (1 + this.avoid),
      fov: this.cur.fov,
      ox: this.cur.ox,
      oy: this.cur.oy,
    };
  }

  /**
   * Advance: `dt` on the presentation clock (0 while paused: the move and the follow stop),
   * `inputDt` on the real clock (the visitor's orbit keeps working).
   */
  update(dt: number, inputDt = dt) {
    const s = this.shot;
    if (!s) return;
    // the layout's free area, followed smoothly, on the presentation clock: a paused picture
    // holds still (a layout change made during a pause is taken up on play)
    const ft = dt;
    if (ft > 0) {
      const w = 4;
      const k = Math.exp(-w * ft);
      for (const key of ['l', 't', 'r', 'b'] as const) {
        const e = this.freeNow[key] - this.free[key];
        const c = this.freeV[key] + w * e;
        this.freeNow[key] = this.free[key] + (e + c * ft) * k;
        this.freeV[key] = (this.freeV[key] - w * c * ft) * k;
      }
    }
    // the followed anchor, filtered: tracks the task, not the sway
    if (dt > 0) {
      const anchor = this.targetOf(s);
      if (typeof s.target === 'function') {
        const w = s.follow ?? 3.5;
        const e = _e.subVectors(anchor, this.follow);
        const m = e.length();
        const db = 0.006;
        if (m < 2 * db) e.multiplyScalar((m / (2 * db)) * (m / (2 * db)));
        this.followV.addScaledVector(e, w * w * dt).addScaledVector(this.followV, -2 * w * dt);
        this.follow.addScaledVector(this.followV, dt);
      } else this.follow.copy(anchor);
    }
    // how fast the framing itself is moving (a layout change mid-move)
    if (dt > 0) {
      const d = this.distOf(s);
      const x = this.lensX(s);
      const y = this.lensY(s);
      if (this.endPrev) {
        this.endVel.dist = (d - this.endPrev.dist) / dt;
        this.endVel.ox = (x - this.endPrev.ox) / dt;
        this.endVel.oy = (y - this.endPrev.oy) / dt;
        this.endPrev.dist = d;
        this.endPrev.ox = x;
        this.endPrev.oy = y;
      } else this.endPrev = { dist: d, ox: x, oy: y };
    }
    let planned = false;
    if (this.moving && this.from) {
      this.t += dt;
      const u = Math.min(1, this.t / this.dur);
      this.sample(u, this.cur);
      if (u < 1 && dt > 0) {
        // the path's own rate of change (exact, no estimation lag) for the next move's start
        const h = Math.min(0.01, 1 - u, u) || 0.005;
        const a = this.sample(Math.max(0, u - h), _sa);
        const b = this.sample(Math.min(1, u + h), _sb);
        const k = 1 / ((Math.min(1, u + h) - Math.max(0, u - h)) * this.dur);
        this.vel.az = wrap(b.az - a.az) * k;
        this.vel.el = (b.el - a.el) * k;
        this.vel.dist = (b.dist - a.dist) * k * this.user.zoom * (1 + this.avoid);
        this.vel.fov = (b.fov - a.fov) * k;
        this.vel.ox = (b.ox - a.ox) * k;
        this.vel.oy = (b.oy - a.oy) * k;
        this.vel.t.subVectors(b.target, a.target).multiplyScalar(k);
        planned = true;
      }
      if (u >= 1) {
        this.moving = false;
        this.cur.az = wrap(this.cur.az);
        // the swing-out ends at zero: the hold starts exactly where the move ended, moving as
        // the framing moves
        this.plan = { k: 0, ke: 0 };
        this.holdV = { ...this.endVel };
      }
    } else if (dt > 0) {
      // holding: follow the target, drift slowly
      this.cur.target.copy(this.follow);
      this.driftPhase += dt;
      if (s.drift) this.cur.az = wrap(this.cur.az + s.drift * dt);
      else this.cur.az = s.az + wrap(this.cur.az - s.az) * Math.exp(-dt * 2);
      const sway = s.sway ? s.sway * Math.sin(this.driftPhase * 0.21) * Math.min(1, this.driftPhase / 4) : 0;
      const k3 = 1 - Math.exp(-dt * 3);
      this.cur.el += (s.el + sway - this.cur.el) * k3;
      this.cur.fov += ((s.fov ?? 30) - this.cur.fov) * k3;
      // distance and lens shift follow the framing with critically damped springs (they keep
      // the speed a move ended with, when the layout was changing under it)
      const w = 3;
      const hv = this.holdV;
      const e = { dist: this.distOf(s) - this.cur.dist, ox: this.lensX(s) - this.cur.ox, oy: this.lensY(s) - this.cur.oy };
      for (const k of ['dist', 'ox', 'oy'] as const) {
        hv[k] += (w * w * e[k] - 2 * w * hv[k]) * dt;
        this.cur[k] += hv[k] * dt;
      }
    }
    // visitor orbit inertia (input clock)
    if (!this.dragging && inputDt > 0) {
      this.user.az += this.userVel.az * inputDt;
      this.user.el += this.userVel.el * inputDt;
      const k = Math.exp(-inputDt * 4.5);
      this.userVel.az *= k;
      this.userVel.el *= k;
    }
    if (inputDt > 0) this.clampUser(inputDt);
    // soft avoidance: a moving body (or the visitor's orbit) must not reach the lens
    const tick = dt > 0 ? dt : inputDt;
    if (tick > 0) {
      const probe = this.effective();
      const p = positionOf(probe, _p);
      const c = this.clearanceAt(p, probe.dist);
      // the extra distance that would clear it (clearance grows about one for one with distance)
      const need = c < 0.02 ? Math.min(1.2, this.avoid + (0.02 - c) / Math.max(0.2, probe.dist)) : Math.max(0, this.avoid - 0.5 * tick);
      const w = 7;
      this.avoidV += (w * w * (need - this.avoid) - 2 * w * this.avoidV) * tick;
      this.avoid = Math.max(0, this.avoid + this.avoidV * tick);
    }
    // velocities of the effective state (for the next transition's start)
    const eff = this.effective();
    if (this.prev && dt > 0 && !planned) {
      const a = 1 - Math.exp(-dt / 0.03);
      this.vel.t.lerp(_e.subVectors(eff.target, this.prev.target).divideScalar(dt), a);
      this.vel.az += (wrap(eff.az - this.prev.az) / dt - this.vel.az) * a;
      this.vel.el += ((eff.el - this.prev.el) / dt - this.vel.el) * a;
      this.vel.dist += ((eff.dist - this.prev.dist) / dt - this.vel.dist) * a;
      this.vel.fov += ((eff.fov - this.prev.fov) / dt - this.vel.fov) * a;
      this.vel.ox += ((eff.ox - this.prev.ox) / dt - this.vel.ox) * a;
      this.vel.oy += ((eff.oy - this.prev.oy) / dt - this.vel.oy) * a;
    }
    if (dt > 0 || !this.prev) this.prev = eff;
    this.apply(eff);
  }

  private clampUser(dt: number) {
    const s = this.shot;
    const o = s?.orbit;
    if (!s || o === false || o === undefined) {
      // no orbit here: whatever the visitor did eases back
      const k = Math.exp(-dt * 6.3);
      this.user.az *= k;
      this.user.el *= k;
      this.user.zoom = 1 + (this.user.zoom - 1) * k;
      return;
    }
    if (o.az) this.user.az = MathUtils.clamp(this.user.az, o.az[0], o.az[1]);
    const el = o.el ?? [0.02, 1.2];
    this.user.el = MathUtils.clamp(this.user.el, el[0] - this.cur.el, el[1] - this.cur.el);
    const d = o.dist ?? [0.6, 1.8];
    this.user.zoom = MathUtils.clamp(this.user.zoom, d[0], d[1]);
  }

  private _p = new Vector3();
  /** The state actually drawn last frame (after the clearance correction), for interruptions. */
  private drawn: CamState | null = null;
  /** Telemetry: how many frames needed the last-resort clamp, and the deepest push (m). */
  clamps = { frames: 0, deepest: 0 };
  private apply(s: CamState) {
    const cam = this.camera;
    const p = positionOf(s, this._p);
    let clamped = 0;
    // last resort: never inside an obstacle
    for (const list of [this.obstacles(), this.keepOut]) {
      for (const k of list) {
        const d = capsuleClearance(k, p);
        if (d < 0.01) {
          _ab.subVectors(k.b, k.a);
          const t = MathUtils.clamp(_ap.subVectors(p, k.a).dot(_ab) / Math.max(1e-6, _ab.lengthSq()), 0, 1);
          const closest = _e.copy(k.a).addScaledVector(_ab, t);
          const dir = _ap.subVectors(p, closest);
          if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
          p.copy(closest).addScaledVector(dir.normalize(), k.r + 0.01);
          this.onClamp?.(0.01 - d);
          clamped = Math.max(clamped, 0.01 - d);
        }
      }
    }
    if (clamped > 0) {
      this.clamps.frames++;
      this.clamps.deepest = Math.max(this.clamps.deepest, clamped);
    }
    p.y = MathUtils.clamp(p.y, this.floor, this.ceiling);
    // what is drawn, as an orbit about the target (a later move starts from exactly this)
    {
      const dx = p.x - s.target.x;
      const dy = p.y - s.target.y;
      const dz = p.z - s.target.z;
      const dist = Math.max(1e-4, Math.hypot(dx, dy, dz));
      const d = this.drawn ?? (this.drawn = { target: new Vector3(), az: 0, el: 0, dist: 1, fov: 30, ox: 0, oy: 0 });
      d.target.copy(s.target);
      d.az = s.az + wrap(Math.atan2(dx, dz) - s.az);
      d.el = Math.asin(MathUtils.clamp(dy / dist, -1, 1));
      d.dist = dist;
      d.fov = s.fov;
      d.ox = s.ox;
      d.oy = s.oy;
    }
    cam.position.copy(p);
    cam.up.set(0, 1, 0);
    cam.lookAt(s.target);
    if (Math.abs(cam.fov - s.fov) > 1e-4) cam.fov = s.fov;
    const dist = p.distanceTo(s.target);
    cam.near = MathUtils.clamp(dist * 0.02, 0.01, 0.25);
    cam.far = 120;
    // lens shift: render a window offset within a larger virtual frame
    const W = this.viewW;
    const H = this.viewH;
    if (Math.abs(s.ox) > 1e-4 || Math.abs(s.oy) > 1e-4) cam.setViewOffset(W, H, s.ox * W, -s.oy * H, W, H);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }

  // ─────────────────────────── visitor input ───────────────────────────

  private pointers = new Map<number, { x: number; y: number }>();
  /** Recent single-pointer moves (for the fling), with their timestamps (ms). */
  private trail: { t: number; az: number; el: number }[] = [];
  private pinch0 = 0;
  private zoom0 = 1;
  /** Pointers something else owns (the IK target being dragged): the camera ignores them. */
  claimed = new Set<number>();

  /** Whether the shot lets the visitor orbit at all. */
  shotAllowsOrbit(): boolean {
    return !!this.shot && this.shot.orbit !== false && this.shot.orbit !== undefined;
  }

  /**
   * The owner of the camera decides whether the visitor may take it now (the animation
   * director: never during an authored move). Without an owner, the shot decides.
   */
  permit: () => boolean = () => this.shotAllowsOrbit();

  canOrbit(): boolean {
    return this.permit();
  }

  attach(el: HTMLElement): () => void {
    const down = (e: PointerEvent) => {
      // while something else owns a pointer (the IK target is being dragged) the camera stays put
      if (!this.canOrbit() || this.claimed.size > 0) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events have no capture */
      }
      this.dragging = true;
      this.userVel = { az: 0, el: 0 };
      this.trail = [];
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoom0 = this.user.zoom;
      }
    };
    const move = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      // an authored move took the camera (a request arrived mid-drag): let go of it
      if (!this.canOrbit()) {
        this.pointers.clear();
        this.dragging = false;
        this.trail = [];
        return;
      }
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 1) {
        const k = 0.0055;
        this.user.az -= dx * k;
        this.user.el += dy * k;
        this.trail.push({ t: e.timeStamp, az: -dx * k, el: dy * k });
        while (this.trail.length > 1 && e.timeStamp - this.trail[0].t > 100) this.trail.shift();
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch0 > 0) this.user.zoom = this.zoom0 * (this.pinch0 / Math.max(1, d));
        this.trail = [];
      }
    };
    const up = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 1) {
        // one finger left after a pinch: carry on orbiting from here, no jump
        this.pinch0 = 0;
        this.trail = [];
      }
      if (this.pointers.size === 0) {
        this.dragging = false;
        // a fling: the speed of the last ~0.1 s of movement, measured from the events' times
        const tr = this.trail;
        if (e.type !== 'pointercancel' && tr.length >= 3 && e.timeStamp - tr[tr.length - 1].t < 60) {
          const span = Math.max(16, tr[tr.length - 1].t - tr[0].t) / 1000;
          let az = 0;
          let elv = 0;
          for (let i = 1; i < tr.length; i++) (az += tr[i].az), (elv += tr[i].el);
          this.userVel.az = MathUtils.clamp((az / span) * 0.35, -2, 2);
          this.userVel.el = MathUtils.clamp((elv / span) * 0.35, -1, 1);
        }
        this.trail = [];
      }
    };
    const wheel = (e: WheelEvent) => {
      if (!this.canOrbit()) return;
      e.preventDefault();
      this.user.zoom *= Math.exp(MathUtils.clamp(e.deltaY, -120, 120) * 0.0012);
    };
    // the keyboard, with the canvas focused: arrows orbit (a smooth nudge that settles), + and −
    // zoom, Home returns to the directed framing
    const key = (e: KeyboardEvent) => {
      if (!this.canOrbit() || e.altKey || e.ctrlKey || e.metaKey) return;
      const nudge = e.shiftKey ? 1.6 : 0.8;
      let used = true;
      if (e.key === 'ArrowLeft') this.userVel.az = -nudge;
      else if (e.key === 'ArrowRight') this.userVel.az = nudge;
      else if (e.key === 'ArrowUp') this.userVel.el = nudge * 0.6;
      else if (e.key === 'ArrowDown') this.userVel.el = -nudge * 0.6;
      else if (e.key === '+' || e.key === '=') this.user.zoom *= 0.88;
      else if (e.key === '-' || e.key === '_') this.user.zoom *= 1.12;
      else if (e.key === 'Home') this.recenter();
      else used = false;
      if (used) e.preventDefault();
    };
    el.addEventListener('keydown', key);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('keydown', key);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }

  /** The visitor is dragging the camera now. */
  get isDragging(): boolean {
    return this.dragging;
  }

  /** The visitor has moved the camera away from the directed framing. */
  get offFraming(): boolean {
    return Math.abs(this.user.az) > 0.05 || Math.abs(this.user.el) > 0.05 || Math.abs(this.user.zoom - 1) > 0.05;
  }

  /** Return to the directed framing (smoothly, from the picture shown; the move's length
   * comes from how far the visitor took the camera). */
  recenter() {
    if (this.shot) {
      const s = this.shot;
      this.shot = null;
      this.go(s);
    }
  }

  /** The layout's free area is known (first measured, or changed while nothing is on screen):
   * a holding shot takes its framing at once instead of easing into it. */
  snapFraming() {
    Object.assign(this.freeNow, this.free);
    this.freeV = { l: 0, t: 0, r: 0, b: 0 };
    this.holdV = { dist: 0, ox: 0, oy: 0 };
    this.endPrev = null;
    if (this.shot && !this.moving) {
      this.cur.dist = this.distOf(this.shot);
      this.cur.ox = this.lensX(this.shot);
      this.cur.oy = this.lensY(this.shot);
      const eff = this.effective();
      this.apply(eff);
      // the snap is a new starting point, not a motion: the next move starts from rest here
      this.prev = eff;
      this.vel = { t: new Vector3(), az: 0, el: 0, dist: 0, fov: 0, ox: 0, oy: 0 };
    }
  }
}

/** The acceleration a planned camera move is sized for, m/s². */
const A_MAX = 8;

const _e = new Vector3();
const _p = new Vector3();
const _sa: CamState = { target: new Vector3(), az: 0, el: 0, dist: 1, fov: 30, ox: 0, oy: 0 };
const _sb: CamState = { target: new Vector3(), az: 0, el: 0, dist: 1, fov: 30, ox: 0, oy: 0 };
