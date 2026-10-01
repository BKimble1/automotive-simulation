/**
 * Geometry helpers for the procedural car: solids of revolution along any axis, tubes along
 * paths, rounded boxes, gears, springs, belts and chains, and merging. Everything is built in
 * vehicle coordinates (metres) unless a function says it returns a local part.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Matrix4,
  Quaternion,
  Shape,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type Curve,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Axis = 'x' | 'y' | 'z';

const _m = new Matrix4();
const _q = new Quaternion();

/** Rotate a geometry built along +y so its axis lies along `axis`. */
export function alongAxis(g: BufferGeometry, axis: Axis): BufferGeometry {
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  else if (axis === 'z') g.rotateX(Math.PI / 2);
  return g;
}

/** Place a geometry: translate by (x, y, z). */
export function at(g: BufferGeometry, x: number, y: number, z: number): BufferGeometry {
  g.translate(x, y, z);
  return g;
}

/**
 * A solid of revolution from a profile of [radius, position-along-axis] points (from one end
 * to the other), around `axis`. `arc` (rad) less than 2π gives a cut-away part.
 */
export function lathe(profile: [number, number][], axis: Axis = 'y', segments = 48, arc = Math.PI * 2, start = 0): BufferGeometry {
  const pts = profile.map(([r, h]) => new Vector2(Math.max(0, r), h));
  const g = new LatheGeometry(pts, segments, start, arc);
  return alongAxis(g, axis);
}

/** A cylinder between two points. */
export function rod(a: Vector3, b: Vector3, r: number, seg = 16, r2 = r): BufferGeometry {
  const d = new Vector3().subVectors(b, a);
  const len = d.length();
  const g = new CylinderGeometry(r2, r, len, seg, 1, false);
  _q.setFromUnitVectors(new Vector3(0, 1, 0), d.normalize());
  _m.compose(new Vector3().addVectors(a, b).multiplyScalar(0.5), _q, new Vector3(1, 1, 1));
  g.applyMatrix4(_m);
  return g;
}

/** A tube through points (a smooth curve), radius r. */
export function tube(points: Vector3[] | Curve<Vector3>, r: number, opts: { segments?: number; radial?: number; closed?: boolean; tension?: number } = {}): BufferGeometry {
  const curve = Array.isArray(points) ? new CatmullRomCurve3(points, opts.closed ?? false, 'catmullrom', opts.tension ?? 0.5) : points;
  const len = Array.isArray(points) ? curve.getLength() : 1;
  return new TubeGeometry(curve, opts.segments ?? Math.max(8, Math.ceil(len * 40)), r, opts.radial ?? 10, opts.closed ?? false);
}

/** A rounded box centred at (x, y, z). */
export function rbox(w: number, h: number, d: number, r: number, x = 0, y = 0, z = 0, seg?: number): BufferGeometry {
  // small radii are invisible at any distance the camera reaches: a plain box is enough
  const g =
    r <= 0.0025
      ? new BoxGeometry(w, h, d)
      : new RoundedBoxGeometry(w, h, d, seg ?? (r < 0.012 ? 2 : 3), Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  g.translate(x, y, z);
  return g;
}

/**
 * A spur gear (or a sprocket) along +z of thickness `width`: `teeth` trapezoidal teeth with
 * rounded flanks, pitch radius r, tooth depth `depth`. `internal` makes a ring gear (teeth
 * pointing in) with outer radius rOuter.
 */
export function gear(teeth: number, r: number, depth: number, width: number, opts: { internal?: boolean; rOuter?: number; bore?: number; bevel?: number } = {}): BufferGeometry {
  const shape = new Shape();
  const N = teeth * 8;
  const ro = r + depth * 0.5;
  const ri = r - depth * 0.5;
  for (let k = 0; k <= N; k++) {
    const a = (k / N) * Math.PI * 2;
    const ph = ((k % 8) + 0.5) / 8; // position within a tooth period
    // profile: tip plateau, flanks, root
    const tri = Math.abs(ph - 0.5) * 2; // 0 at tooth centre, 1 at the gap centre
    const t = tri < 0.35 ? 1 : tri < 0.65 ? 1 - (tri - 0.35) / 0.3 : 0;
    const rr = opts.internal ? ro - (ro - ri) * t : ri + (ro - ri) * t;
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (k === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  let geo: BufferGeometry;
  if (opts.internal) {
    // ring gear: outer circle with the toothed hole
    const outer = new Shape();
    const R = opts.rOuter ?? r + depth * 2.5;
    outer.absarc(0, 0, R, 0, Math.PI * 2, false);
    outer.holes.push(shape as unknown as import('three').Path);
    geo = new ExtrudeGeometry(outer, { depth: width, bevelEnabled: false, curveSegments: 48 });
  } else {
    if (opts.bore) {
      const hole = new Shape();
      hole.absarc(0, 0, opts.bore, 0, Math.PI * 2, true);
      shape.holes.push(hole as unknown as import('three').Path);
    }
    const bev = opts.bevel ?? Math.min(width * 0.12, depth * 0.25);
    geo = new ExtrudeGeometry(shape, { depth: width - 2 * bev, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev * 0.8, bevelSegments: 1, curveSegments: 12 });
    geo.translate(0, 0, bev);
  }
  geo.translate(0, 0, -width / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A bevel gear (ring, pinion, side or spider gear) along +z: a cone frustum whose teeth run
 * along its slant. `r0`/`r1`: pitch radii at the back and front faces, `len` its axial length.
 */
export function bevelGear(teeth: number, r0: number, r1: number, len: number, depth: number, opts: { bore?: number; seg?: number } = {}): BufferGeometry {
  const seg = teeth * 6;
  const rings = 2;
  const pos: number[] = [];
  const idx: number[] = [];
  const toothR = (a: number, r: number) => {
    const ph = ((a / (Math.PI * 2)) * teeth) % 1;
    const tri = Math.abs(ph - 0.5) * 2;
    const t = tri < 0.35 ? 1 : tri < 0.65 ? 1 - (tri - 0.35) / 0.3 : 0;
    const d = depth * (r / Math.max(r0, r1));
    return r - d * 0.5 + d * t;
  };
  // outer toothed surface
  for (let j = 0; j <= rings; j++) {
    const v = j / rings;
    const r = r0 + (r1 - r0) * v;
    const z = len * v;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const rr = toothR(a, r);
      pos.push(Math.cos(a) * rr, Math.sin(a) * rr, z);
    }
  }
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      const b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  // end faces (to the bore)
  const bore = opts.bore ?? Math.min(r0, r1) * 0.35;
  for (const [j, z, flip] of [
    [0, 0, false],
    [rings, len, true],
  ] as [number, number, boolean][]) {
    const base = pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * bore, Math.sin(a) * bore, z);
    }
    for (let i = 0; i < seg; i++) {
      const o = j * (seg + 1) + i;
      const n = base + i;
      if (flip) idx.push(o, o + 1, n, n, o + 1, n + 1);
      else idx.push(o, n, o + 1, n, n + 1, o + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A coil spring along +y from 0 to `len`: `turns` coils of wire radius `wire`, coil radius R. */
export function spring(R: number, wire: number, len: number, turns: number, seg = 10): BufferGeometry {
  const pts: Vector3[] = [];
  const N = Math.ceil(turns * 18);
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const a = t * turns * Math.PI * 2;
    // closed ends: the first and last half-coil rise slowly, so the spring sits flat on its seats
    const end = 0.5 / turns;
    const tt = t < end ? (t / end) * end * 0.35 : t > 1 - end ? 1 - ((1 - t) / end) * end * 0.35 : end * 0.35 + ((t - end) / (1 - 2 * end)) * (1 - 2 * end * 0.35);
    const y = wire + (len - 2 * wire) * tt;
    pts.push(new Vector3(Math.cos(a) * R, y, Math.sin(a) * R));
  }
  return tube(pts, wire, { segments: N * 2, radial: seg });
}

/** A torus around +z. */
export function torus(R: number, r: number, arc = Math.PI * 2, seg = 48, rseg = 12): BufferGeometry {
  return new TorusGeometry(R, r, rseg, seg, arc);
}

/** Merge geometries (dropping attributes they do not all share), then weld vertices. */
export function merge(list: BufferGeometry[], weld = false): BufferGeometry {
  const cleaned = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
    if (!n.getAttribute('normal')) n.computeVertexNormals();
    return n;
  });
  const m = mergeGeometries(cleaned, false)!;
  return weld ? mergeVertices(m, 1e-5) : m;
}

/**
 * A belt (or chain) path around pulleys in a plane: given circles (centre (u, v), radius,
 * and on which side the belt wraps), returns the closed loop of points (u, v) with the
 * tangent lines and arcs, plus its length. Pulleys are visited in order; `outside` false
 * means the belt wraps the pulley's back (an idler pressing on the belt's back).
 */
export interface Pulley {
  u: number;
  v: number;
  r: number;
  /** True: the belt's ribbed side wraps it (driven or driving); false: an idler on its back. */
  inside?: boolean;
}

export function beltLoop(pulleys: Pulley[], samples = 400): { pts: Vector2[]; length: number; at: (s: number) => { p: Vector2; t: Vector2 } } {
  // signed radius: + for clockwise wrap (inside), − for the back side
  const n = pulleys.length;
  const segs: { a: Vector2; b: Vector2 }[] = [];
  for (let i = 0; i < n; i++) {
    const P = pulleys[i];
    const Q = pulleys[(i + 1) % n];
    const r1 = (P.inside === false ? -1 : 1) * P.r;
    const r2 = (Q.inside === false ? -1 : 1) * Q.r;
    // external/internal tangent between two circles, on the right of the travel direction
    const dx = Q.u - P.u;
    const dy = Q.v - P.v;
    const d = Math.hypot(dx, dy);
    const ux = dx / d;
    const uy = dy / d;
    const c = (r1 - r2) / d;
    const h = Math.sqrt(Math.max(0, 1 - c * c));
    // normal on the right side (clockwise wrap)
    const nx = ux * c - -uy * h;
    const ny = uy * c - ux * h;
    segs.push({ a: new Vector2(P.u + nx * r1, P.v + ny * r1), b: new Vector2(Q.u + nx * r2, Q.v + ny * r2) });
  }
  // walk: tangent segment i, then the arc on pulley i+1 from the end of segment i to the start of segment i+1
  const pts: Vector2[] = [];
  const pieces: { kind: 'line' | 'arc'; a: Vector2; b: Vector2; c?: Vector2; r?: number; a0?: number; a1?: number; len: number }[] = [];
  for (let i = 0; i < n; i++) {
    const s = segs[i];
    pieces.push({ kind: 'line', a: s.a, b: s.b, len: s.a.distanceTo(s.b) });
    const Q = pulleys[(i + 1) % n];
    const next = segs[(i + 1) % n];
    const c = new Vector2(Q.u, Q.v);
    const a0 = Math.atan2(s.b.y - c.y, s.b.x - c.x);
    let a1 = Math.atan2(next.a.y - c.y, next.a.x - c.x);
    const cw = Q.inside !== false;
    // clockwise wrap goes the negative way
    if (cw) {
      while (a1 > a0) a1 -= Math.PI * 2;
    } else {
      while (a1 < a0) a1 += Math.PI * 2;
    }
    pieces.push({ kind: 'arc', a: s.b, b: next.a, c, r: Q.r, a0, a1, len: Math.abs(a1 - a0) * Q.r });
  }
  const length = pieces.reduce((t, p) => t + p.len, 0);
  const at = (sIn: number) => {
    let s = ((sIn % length) + length) % length;
    for (const p of pieces) {
      if (s <= p.len || p === pieces[pieces.length - 1]) {
        const u = p.len > 0 ? Math.min(1, s / p.len) : 0;
        if (p.kind === 'line') {
          const pt = new Vector2().lerpVectors(p.a, p.b, u);
          const t = new Vector2().subVectors(p.b, p.a).normalize();
          return { p: pt, t };
        }
        const ang = p.a0! + (p.a1! - p.a0!) * u;
        const pt = new Vector2(p.c!.x + Math.cos(ang) * p.r!, p.c!.y + Math.sin(ang) * p.r!);
        const dir = Math.sign(p.a1! - p.a0!);
        const t = new Vector2(-Math.sin(ang) * dir, Math.cos(ang) * dir);
        return { p: pt, t };
      }
      s -= p.len;
    }
    return { p: pieces[0].a.clone(), t: new Vector2(1, 0) };
  };
  for (let k = 0; k <= samples; k++) pts.push(at((k / samples) * length).p);
  return { pts, length, at };
}

/** A flat closed outline extruded along +z (or a profile for a cast part). */
export function extrude(outline: [number, number][], depth: number, opts: { bevel?: number; holes?: [number, number][][]; curveSegments?: number } = {}): BufferGeometry {
  const s = new Shape(outline.map(([x, y]) => new Vector2(x, y)));
  for (const h of opts.holes ?? []) s.holes.push(new Shape(h.map(([x, y]) => new Vector2(x, y))) as unknown as import('three').Path);
  const bev = opts.bevel ?? 0;
  const g = new ExtrudeGeometry(s, { depth: Math.max(1e-4, depth - 2 * bev), bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: opts.curveSegments ?? 12 });
  g.translate(0, 0, bev - depth / 2);
  g.computeVertexNormals();
  return g;
}

/**
 * Extrude an outline drawn in the (z, y) plane along +x, from x0 to x1. (The outline is
 * mirrored before the turn instead of after it, so faces keep their winding.)
 */
export function extrudeX(outline: [number, number][], x0: number, x1: number, opts: { bevel?: number; holes?: [number, number][][]; curveSegments?: number } = {}): BufferGeometry {
  const flip = (pts: [number, number][]) => pts.map(([z, y]) => [-z, y] as [number, number]);
  const g = extrude(flip(outline), Math.abs(x1 - x0), { ...opts, holes: opts.holes?.map(flip) });
  g.rotateY(Math.PI / 2);
  g.translate((x0 + x1) / 2, 0, 0);
  return g;
}

/** Points of a circle-ish outline (for extrudes), counter-clockwise. */
export function circlePts(r: number, n = 32, cx = 0, cy = 0, a0 = 0, a1 = Math.PI * 2): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / (a1 - a0 >= Math.PI * 2 - 1e-6 ? n : n - 1);
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

/** A rounded-rectangle outline. */
export function rrectPts(w: number, h: number, r: number, cx = 0, cy = 0, n = 6): [number, number][] {
  const out: [number, number][] = [];
  const corners: [number, number, number][] = [
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, Math.PI / 2],
    [-w / 2 + r, -h / 2 + r, Math.PI],
    [w / 2 - r, -h / 2 + r, (3 * Math.PI) / 2],
  ];
  for (const [x, y, a0] of corners)
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2);
      out.push([cx + x + Math.cos(a) * r, cy + y + Math.sin(a) * r]);
    }
  return out;
}
