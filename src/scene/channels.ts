/**
 * Scene channels: every animated property of the scene that is not the camera or the car's
 * mechanism is a named number (how ghosted the hood is, how far the engine is taken apart,
 * where the cutaway's plane is, how strong the coolant flow overlay is…). A view is a set of
 * channel targets; `to(targets)` plans the move from the current values in four phases:
 *
 *   1. overlays that are leaving (flows, arrows, highlights, labels, heat) fade out;
 *   2. reveals open — bodywork turns to glass, panels open, parts ghost or fade, assemblies
 *      come apart, section planes slide in — earliest stage first;
 *   3. covers close — whatever the new view no longer needs revealed comes back, latest stage
 *      first (a cut closes before its parts reassemble, before the bodywork turns solid);
 *   4. the new view's overlays fade in.
 *
 *   So solid bodywork never fills the picture halfway through a move between two x-ray views:
 *   the next view's reveal happens before the last view's cover. The room light and the
 *   isolation dimming (studio, dim) move from the start, alongside;
 *   - each stage starts when the previous one is mostly done (they overlap a little);
 *   - every channel starts from its current value and speed, so asking for a new view halfway
 *     through a move reverses or redirects it smoothly, whatever the order of requests;
 *   - asking for the value a channel is already heading to lets its move run on (no restart).
 *
 * The stage of a channel comes from its kind (its name's prefix): bodywork ghosts before an
 * assembly ghosts, ghosts before parts come apart, parts come apart before a cutaway slices,
 * and overlays and labels appear last. Closing runs the same order backwards, so every
 * transition, interrupted or not, keeps the same choreography. Nothing waits on a timer: the
 * channels advance with the clock they are given.
 */

export interface KindSpec {
  stage: number;
  /** Time for a full 0 → 1 move, s. */
  duration: number;
}

/** Kinds by prefix (`ghost:hood`, `explode:engine`, …). */
export const KINDS: Record<string, KindSpec> = {
  /** Room light (the studio dims around a demonstration) and isolation of the subject. */
  studio: { stage: 0, duration: 1.2 },
  dim: { stage: 0, duration: 0.9 },
  /** Body panels become an x-ray shell (0 solid … 1 ghost). */
  body: { stage: 0, duration: 0.9 },
  /** Hood, doors and trunk opening on their hinges. */
  open: { stage: 1, duration: 1.4 },
  /** Assemblies or parts ghosting. */
  ghost: { stage: 1, duration: 0.8 },
  /** Parts fading out of the way completely. */
  hide: { stage: 0, duration: 0.7 },
  /** Lesson-only parts fading in (structure, deployed airbags, the rolling road). */
  show: { stage: 2, duration: 0.9 },
  /** Taking apart: the whole car, the engine, the converter, a brake. */
  explode: { stage: 2, duration: 2.2 },
  /** Section planes sliding through an assembly. */
  cut: { stage: 3, duration: 1.2 },
  /** Thermal tint. */
  heat: { stage: 3, duration: 1.0 },
  /** Flows, force arrows and the network overlay. */
  flow: { stage: 4, duration: 0.7 },
  arrow: { stage: 4, duration: 0.6 },
  /** Highlight (edge light) of the subject. */
  hl: { stage: 4, duration: 0.5 },
  /** In-scene labels. */
  label: { stage: 5, duration: 0.45 },
};

const DEFAULT: KindSpec = { stage: 2, duration: 0.9 };

/** Kinds drawn over the scene: they leave first and arrive last. */
const OVERLAY = new Set(['flow', 'arrow', 'hl', 'label', 'heat']);
/** Kinds that move from the start of a transition whatever their direction. */
const AMBIENT = new Set(['studio', 'dim']);

export type Phase = 'ambient' | 'overlay-out' | 'reveal' | 'cover' | 'overlay-in';

/** Which phase of a transition a channel's move belongs to. */
export function phaseOf(id: string, from: number, to: number): Phase {
  const k = id.split(':')[0];
  if (AMBIENT.has(k)) return 'ambient';
  if (OVERLAY.has(k)) return to < from ? 'overlay-out' : 'overlay-in';
  return to < from ? 'cover' : 'reveal';
}

export function kindOf(id: string): KindSpec {
  const k = id.split(':')[0];
  return KINDS[k] ?? DEFAULT;
}

interface Tween {
  from: number;
  v0: number;
  to: number;
  delay: number;
  dur: number;
  t: number;
}

/** Braking time for a channel that is moving when it has to wait for its stage, s. */
const BRAKE = 0.28;

/** Quintic from p0 (with speed v0·T) to p1 at rest, u ∈ [0, 1]. */
function hermite5(p0: number, v0T: number, p1: number, u: number): number {
  const d = p1 - p0;
  const a3 = 10 * d - 6 * v0T;
  const a4 = -15 * d + 8 * v0T;
  const a5 = 6 * d - 3 * v0T;
  return p0 + v0T * u + a3 * u * u * u + a4 * u * u * u * u + a5 * u * u * u * u * u;
}

export class Channels {
  values = new Map<string, number>();
  rates = new Map<string, number>();
  private tweens = new Map<string, Tween>();
  /** Multiplier for all durations (reduced motion shortens them). */
  speed = 1;

  get(id: string): number {
    return this.values.get(id) ?? 0;
  }

  /** True while any channel is moving. */
  get busy(): boolean {
    return this.tweens.size > 0;
  }

  /** Where a channel is heading (its value if it is not moving). */
  target(id: string): number {
    return this.tweens.get(id)?.to ?? this.get(id);
  }

  /** All channel ids with a non-zero value or target. */
  active(): string[] {
    const s = new Set<string>();
    for (const [k, v] of this.values) if (v > 0) s.add(k);
    for (const [k, t] of this.tweens) if (t.to > 0) s.add(k);
    return [...s];
  }

  /**
   * Move to a view's channel state. Channels not mentioned return to 0, except those whose
   * prefix is in `keep` (they carry on as they are).
   */
  to(targets: Record<string, number>, opts: { keep?: string[]; overlap?: number } = {}) {
    const full: Record<string, number> = {};
    const keep = (k: string) => opts.keep?.some((p) => k === p || k.startsWith(p + ':')) ?? false;
    for (const k of new Set([...this.values.keys(), ...this.tweens.keys()])) if (!keep(k)) full[k] = 0;
    for (const [k, v] of Object.entries(targets)) full[k] = v;
    this.plan(full, opts.overlap ?? 0.6);
  }

  /** Move only the channels named; `pace` scales durations. */
  toSome(targets: Record<string, number>, overlap = 0.6, pace = 1) {
    this.plan(targets, overlap, pace);
  }

  private plan(full: Record<string, number>, overlap: number, pace = 1) {
    const groups: Record<Phase, string[]> = { ambient: [], 'overlay-out': [], reveal: [], cover: [], 'overlay-in': [] };
    for (const k of Object.keys(full)) {
      const cur = this.get(k);
      const want = full[k];
      const rate = this.rates.get(k) ?? 0;
      if (Math.abs(want - cur) < 1e-4 && Math.abs(rate) < 1e-3) {
        this.tweens.delete(k);
        this.values.set(k, want);
        this.rates.set(k, 0);
        continue;
      }
      const tw = this.tweens.get(k);
      if (tw && Math.abs(tw.to - want) < 1e-4) continue;
      groups[phaseOf(k, cur, want)].push(k);
    }
    const durOf = (k: string) => Math.max(0.25, kindOf(k).duration * Math.sqrt(Math.abs(full[k] - this.get(k)))) * this.speed * pace;
    const start = (k: string, delay: number) => {
      const dur = durOf(k);
      this.tweens.set(k, { from: this.get(k), v0: this.rates.get(k) ?? 0, to: full[k], delay, dur, t: 0 });
      return dur;
    };
    for (const k of groups.ambient) start(k, 0);
    // a phase's stages, from `t0`: each starts when the one before is `overlap` done; returns
    // when the phase's last channel arrives
    const run = (ids: string[], order: 1 | -1, t0: number): number => {
      const stages = [...new Set(ids.map((k) => kindOf(k).stage))].sort((a, b) => (a - b) * order);
      let t = t0;
      let end = t0;
      for (const st of stages) {
        let longest = 0;
        for (const k of ids.filter((i) => kindOf(i).stage === st)) longest = Math.max(longest, start(k, t));
        end = Math.max(end, t + longest);
        t += longest * overlap;
      }
      return end;
    };
    const outEnd = run(groups['overlay-out'], -1, 0);
    const tOut = groups['overlay-out'].length ? outEnd * 0.6 : 0;
    const revealEnd = run(groups.reveal, 1, tOut);
    // covering starts once the reveal is half done: the next subject is already showing
    const coverStart = groups.reveal.length ? tOut + (revealEnd - tOut) * 0.5 : tOut;
    const coverEnd = run(groups.cover, -1, coverStart);
    const inStart = Math.max(tOut, Math.max(revealEnd, coverStart + (coverEnd - coverStart) * 0.5) - 0.15);
    run(groups['overlay-in'], 1, inStart);
  }

  /** Set a channel immediately (no animation): only for the first frame of a visit. */
  set(id: string, v: number) {
    this.tweens.delete(id);
    this.values.set(id, v);
    this.rates.set(id, 0);
  }

  update(dt: number) {
    if (dt <= 0) return;
    for (const k of this.rates.keys()) if (!this.tweens.has(k)) this.rates.set(k, 0);
    for (const [k, tw] of this.tweens) {
      const before = this.get(k);
      tw.t += dt;
      let v: number;
      if (tw.t < tw.delay) {
        // waiting for its stage: a moving channel brakes to a stop, a still one holds
        const tb = Math.min(BRAKE, tw.delay);
        const x = Math.min(tw.t, tb);
        v = tw.from + tw.v0 * (x - (x * x) / (2 * tb));
      } else {
        const waited = tw.delay > 0;
        const tb = Math.min(BRAKE, tw.delay);
        const start = waited ? tw.from + (tw.v0 * tb) / 2 : tw.from;
        const v0T = waited ? 0 : tw.v0 * tw.dur;
        const u = Math.min(1, (tw.t - tw.delay) / tw.dur);
        v = hermite5(start, v0T, tw.to, u);
        // arrive exactly (the final state is deterministic, not a rounding of it)
        if (u >= 1) {
          v = tw.to;
          this.tweens.delete(k);
        }
      }
      v = Math.min(1, Math.max(0, v));
      this.values.set(k, v);
      this.rates.set(k, (v - before) / dt);
    }
  }
}
