#!/usr/bin/env node
// Bakes the S-1's outer body skin into src/scene/car/baked/body-<lod>.bin.
//
//   node scripts/bake-body.mjs            (npm run bake)
//
// The body is a signed distance field built the way a designer works from a blueprint: the
// side elevation, the plan and the front section of the lower body and of the glasshouse,
// each a 2D outline extruded across the third axis, intersected with small blend radii (so
// the edges are crisp but rounded), joined, then cut by the wheel arches and the underbody
// tunnel. Surface nets turn it into a mesh at each level of detail; every vertex is projected
// onto the surface and its normal is the field's gradient, so the paint reflects smoothly.
//
// What the paint, glass, lamps and panel gaps look like is decided per pixel in the body
// shader (src/scene/car/bodyShader.ts) from the same outlines, so window edges and shut
// lines stay sharp whatever the mesh resolution.
//
// Output (gzip): 'FOB1', u32 vertexCount, u32 indexCount, f32×6 bounds, i16×3 positions
// (quantised to the bounds), i16×2 octahedral normals, u32 indices.
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const out = join(import.meta.dirname, '..', 'src', 'scene', 'car', 'baked');
mkdirSync(out, { recursive: true });

// ───────────────────────────── outlines (metres) ─────────────────────────────
// x forward (nose +2.255, tail −2.465), y up, z to the right. Front axle +1.425, rear −1.425.

/** Closed polygon from a smooth curve through control points (Catmull–Rom, centripetal-ish). */
function smoothPoly(pts, per = 8) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}

/** Signed distance to a closed polygon (negative inside). */
function polySDF(poly) {
  const n = poly.length;
  const ax = new Float64Array(n);
  const ay = new Float64Array(n);
  const ex = new Float64Array(n);
  const ey = new Float64Array(n);
  const il = new Float64Array(n);
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    ax[i] = a[0];
    ay[i] = a[1];
    ex[i] = b[0] - a[0];
    ey[i] = b[1] - a[1];
    il[i] = 1 / Math.max(1e-12, ex[i] * ex[i] + ey[i] * ey[i]);
    minx = Math.min(minx, a[0]); maxx = Math.max(maxx, a[0]);
    miny = Math.min(miny, a[1]); maxy = Math.max(maxy, a[1]);
  }
  const f = (px, py) => {
    let d = Infinity;
    let s = 1;
    for (let i = 0; i < n; i++) {
      const wx = px - ax[i];
      const wy = py - ay[i];
      let t = (wx * ex[i] + wy * ey[i]) * il[i];
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const bx = wx - ex[i] * t;
      const by = wy - ey[i] * t;
      const dd = bx * bx + by * by;
      if (dd < d) d = dd;
      const c1 = py >= ay[i];
      const c2 = py < ay[i] + ey[i];
      const c3 = ex[i] * wy > ey[i] * wx;
      if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
    }
    return s * Math.sqrt(d);
  };
  f.bounds = { minx, maxx, miny, maxy };
  return f;
}

// Lower body, side elevation (x, y): bumper, hood, beltline, deck, tail, sills.
const SIDE_LOW = smoothPoly([
  [2.258, 0.47],
  [2.245, 0.6],
  [2.2, 0.715],
  [2.11, 0.79],
  [1.85, 0.836],
  [1.45, 0.888],
  [1.1, 0.93],
  [0.9, 0.952],
  [0.5, 0.968],
  [0.0, 0.985],
  [-0.8, 1.006],
  [-1.55, 1.03],
  [-1.95, 1.046],
  [-2.3, 1.058],
  [-2.415, 1.04],
  [-2.462, 0.95],
  [-2.472, 0.72],
  [-2.455, 0.47],
  [-2.4, 0.33],
  [-2.25, 0.25],
  [-1.85, 0.215],
  [-1.0, 0.175],
  [0.0, 0.17],
  [1.0, 0.175],
  [1.85, 0.205],
  [2.12, 0.245],
  [2.225, 0.32],
], 10);

// Plan (x, z): half the car, mirrored. Widest over the wheels, a gently tapered nose and tail.
function mirrorPlan(half) {
  // half: from nose to tail along +z side; mirror for −z
  const right = half;
  const left = half.slice().reverse().map(([x, z]) => [x, -z]);
  return [...right, ...left];
}
const PLAN_LOW = smoothPoly(
  mirrorPlan([
    [2.262, 0.0],
    [2.245, 0.42],
    [2.19, 0.7],
    [2.06, 0.85],
    [1.75, 0.912],
    [1.425, 0.922],
    [1.0, 0.915],
    [0.2, 0.905],
    [-0.6, 0.91],
    [-1.425, 0.922],
    [-1.9, 0.912],
    [-2.25, 0.86],
    [-2.42, 0.74],
    [-2.476, 0.42],
    [-2.48, 0.0],
  ]),
  8,
);

/** A front section from its right half, as (z, y) pairs from the top centre round to the bottom centre. */
function mirrorSection(half) {
  const right = half;
  const left = half.slice().reverse().map(([z, y]) => [-z, y]);
  return [...right, ...left];
}

// Front section of the lower body (z, y): sills tucked in, widest at the wheel centres, a
// rounded shoulder below the beltline.
const FRONT_LOW = smoothPoly(
  mirrorSection([
    [0.0, 1.12],
    [0.72, 1.1],
    [0.86, 1.03],
    [0.905, 0.9],
    [0.925, 0.62],
    [0.92, 0.42],
    [0.89, 0.25],
    [0.83, 0.17],
    [0.6, 0.15],
    [0.0, 0.15],
  ]),
  8,
);

// Glasshouse, side elevation: windscreen, roof, rear screen down to the deck.
const SIDE_CAB = smoothPoly([
  [0.96, 0.9],
  [0.935, 0.962],
  [0.62, 1.12],
  [0.25, 1.32],
  [0.05, 1.392],
  [-0.35, 1.418],
  [-0.8, 1.402],
  [-1.08, 1.355],
  [-1.42, 1.215],
  [-1.72, 1.075],
  [-1.82, 1.02],
  [-1.8, 0.9],
], 44);

// Glasshouse plan: narrower than the body, drawn in at the A-pillars and the C-pillars.
const PLAN_CAB = smoothPoly(
  mirrorPlan([
    [1.05, 0.0],
    [1.02, 0.6],
    [0.85, 0.79],
    [0.3, 0.815],
    [-0.6, 0.82],
    [-1.3, 0.8],
    [-1.7, 0.74],
    [-1.86, 0.55],
    [-1.88, 0.0],
  ]),
  36,
);

// Glasshouse section (z, y): tumblehome from the beltline to a crowned roof.
const FRONT_CAB = smoothPoly(
  mirrorSection([
    [0.0, 1.47],
    [0.42, 1.455],
    [0.62, 1.41],
    [0.712, 1.3],
    [0.8, 1.04],
    [0.818, 0.9],
    [0.6, 0.84],
    [0.0, 0.84],
  ]),
  36,
);

const sideCab = polySDF(SIDE_CAB);
const planCab = polySDF(PLAN_CAB);
const frontCab = polySDF(FRONT_CAB);

// ───────────────────────────── field ─────────────────────────────
const smax = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
};
const smin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const box = (px, py, pz, cx, cy, cz, hx, hy, hz) => {
  const qx = Math.abs(px - cx) - hx;
  const qy = Math.abs(py - cy) - hy;
  const qz = Math.abs(pz - cz) - hz;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0);
};
const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * A 1D curve through [t, value] points (Catmull–Rom); a point marked 'crease' makes a sharp
 * corner there (the shoulder line). Sampled into a table for speed.
 */
function curve(points) {
  const n = points.length;
  const t0 = points[0][0], t1 = points[n - 1][0];
  const N = 2048;
  const tab = new Float64Array(N + 1);
  const at = (i) => points[Math.max(0, Math.min(n - 1, i))];
  for (let s = 0; s <= N; s++) {
    const t = t0 + ((t1 - t0) * s) / N;
    let i = 0;
    while (i < n - 2 && points[i + 1][0] <= t) i++;
    const p1 = at(i), p2 = at(i + 1);
    const p0 = p1[2] === 'crease' ? p1 : at(i - 1);
    const p3 = p2[2] === 'crease' ? p2 : at(i + 2);
    const u = (t - p1[0]) / Math.max(1e-9, p2[0] - p1[0]);
    // tangents scaled for uneven spacing
    const m1 = p1[2] === 'crease' ? (p2[1] - p1[1]) : ((p2[1] - p0[1]) / Math.max(1e-9, p2[0] - p0[0])) * (p2[0] - p1[0]);
    const m2 = p2[2] === 'crease' ? (p2[1] - p1[1]) : ((p3[1] - p1[1]) / Math.max(1e-9, p3[0] - p1[0])) * (p2[0] - p1[0]);
    const u2 = u * u, u3 = u2 * u;
    tab[s] = (2 * u3 - 3 * u2 + 1) * p1[1] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2[1] + (u3 - u2) * m2;
  }
  return (t) => {
    const f = ((Math.min(t1, Math.max(t0, t)) - t0) / (t1 - t0)) * N;
    const i = Math.min(N - 1, Math.floor(f));
    const a = f - i;
    return tab[i] * (1 - a) + tab[i + 1] * a;
  };
}

// Lower body half-width by height: tucked rocker, a slight scoop low on the doors, widest at
// the wheel centres, a crisp shoulder crease, then the tumblehome into the beltline.
const W = curve([
  [0.12, 0.76],
  [0.17, 0.83],
  [0.22, 0.875],
  [0.28, 0.897],
  [0.34, 0.902],
  [0.43, 0.897],
  [0.55, 0.912],
  [0.66, 0.921],
  [0.77, 0.918],
  [0.865, 0.907, 'crease'],
  [0.93, 0.884],
  [1.0, 0.832],
  [1.06, 0.74],
  [1.12, 0.6],
]);
// The nose in side elevation (how far forward the body reaches at each height): an undercut
// lip, the bumper's face, then a raked top into the hood's leading edge.
const XN = curve([
  [0.12, 2.12],
  [0.18, 2.19],
  [0.24, 2.235],
  [0.32, 2.252],
  [0.46, 2.262],
  [0.6, 2.252],
  [0.69, 2.225],
  [0.75, 2.185],
  [0.8, 2.12],
  [0.86, 1.98],
  [1.12, 1.6],
]);
// The tail: an up-swept diffuser, a slightly forward-leaning rear face, the trunk lid's lip.
const XT = curve([
  [0.12, -2.2],
  [0.2, -2.3],
  [0.3, -2.405],
  [0.42, -2.455],
  [0.6, -2.47],
  [0.82, -2.476],
  [0.95, -2.47],
  [1.02, -2.45],
  [1.07, -2.415],
  [1.12, -2.3],
]);
// The top line: hood (rising to the cowl), beltline under the glasshouse, deck, ducktail lip.
const YTOP = curve([
  [-2.6, 1.0],
  [-2.44, 1.055],
  [-2.3, 1.066],
  [-1.95, 1.052],
  [-1.6, 1.036],
  [-0.8, 1.01],
  [0.0, 0.988],
  [0.5, 0.972],
  [0.9, 0.958],
  [1.0, 0.947],
  [1.3, 0.913],
  [1.6, 0.876],
  [1.9, 0.838],
  [2.11, 0.8],
  [2.22, 0.76],
  [2.35, 0.68],
]);

/** Rounded rectangle with a radius per side (front x>0, rear x<0) in 2D (exact SDF). */
function roundBox2(px, pz, hx, hz, rFront, rRear) {
  const r = px > 0 ? rFront : rRear;
  const qx = Math.abs(px) - hx + r;
  const qz = Math.abs(pz) - hz + r;
  return Math.min(Math.max(qx, qz), 0) + Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) - r;
}

const AXLES = [1.425, -1.425];
const WHEEL_Y = 0.318;
const ARCH_R = 0.372;

/** The fender "hips": a few centimetres of extra width over each wheel, faded out above the shoulder. */
function hip(x, y) {
  let h = 0;
  for (const [ax, amp] of [
    [1.425, 0.016],
    [-1.425, 0.022],
  ]) {
    const u = (x - ax) / 0.62;
    h += amp * Math.exp(-u * u * 2.2);
  }
  return h * sstep(0.28, 0.48, y) * (1 - sstep(0.8, 0.9, y));
}

function lowerBody(x, y, z) {
  const az = Math.abs(z);
  const w = W(y);
  const zz = az - hip(x, y);
  // the front and rear faces bow outward in plan
  const k = Math.min(1, zz / Math.max(0.3, w));
  const xn = XN(y) - 0.11 * k * k;
  const xt = XT(y) + 0.07 * k * k;
  const cx = (xn + xt) / 2;
  const hx = (xn - xt) / 2;
  // corner radii in plan: rounder toward the top
  const rF = 0.4 + 0.22 * sstep(0.55, 0.95, y);
  const rR = 0.34 + 0.16 * sstep(0.7, 1.05, y);
  const plan = roundBox2(x - cx, zz, hx, w, rF, rR);
  // the top, crowned across the car (the hood more than the deck), and the flat floor
  const crown = (x > 0.95 ? 0.032 : 0.02) * (az / 0.9) * (az / 0.9);
  const top = y - (YTOP(x) - crown);
  const bottom = 0.165 - y;
  let d = smax(plan, top, 0.075);
  d = smax(d, bottom, 0.04);
  return d;
}

export function body(x, y, z) {
  const az = Math.abs(z);
  const low = lowerBody(x, y, z);
  // glasshouse
  let cab = smax(sideCab(x, y), planCab(x, z), 0.09);
  cab = smax(cab, frontCab(z, y), 0.07);
  let d = smin(low, cab, 0.04);
  // wheel arches: cylinders around each wheel on the outer side, with a rolled lip
  for (const ax of AXLES) {
    const dx = x - ax;
    const dy = y - WHEEL_Y;
    const cyl = Math.hypot(dx, dy) - ARCH_R;
    const cap = 0.52 - az;
    const arch = Math.max(cyl, cap);
    // a rolled lip: a rounder blend than the grid's spacing, so the arch edge is clean
    d = smax(d, -arch, 0.05);
  }
  // underbody: the transmission and driveshaft tunnel, the rear subframe bay
  d = smax(d, -box(x, y, z, -0.1, 0.2, 0, 1.25, 0.17, 0.165), 0.03);
  d = smax(d, -box(x, y, z, -1.42, 0.2, 0, 0.36, 0.14, 0.5), 0.03);
  return d;
}

// ───────────────────────────── surface nets ─────────────────────────────
function mesh(h) {
  const x0 = -2.56, x1 = 2.34, y0 = 0.08, y1 = 1.52, z0 = -1.02, z1 = 1.02;
  const nx = Math.ceil((x1 - x0) / h) + 1;
  const ny = Math.ceil((y1 - y0) / h) + 1;
  const nz = Math.ceil((z1 - z0) / h) + 1;
  const F = new Float32Array(nx * ny * nz);
  const idx = (i, j, k) => (k * ny + j) * nx + i;
  // evaluate the right half and mirror (the field is symmetric in z)
  const kMid = (nz - 1) / 2;
  for (let k = 0; k < nz; k++) {
    const z = z0 + k * h;
    if (k < kMid - 0.5) continue;
    for (let j = 0; j < ny; j++) {
      const y = y0 + j * h;
      for (let i = 0; i < nx; i++) F[idx(i, j, k)] = body(x0 + i * h, y, z);
    }
  }
  for (let k = 0; k < nz; k++) {
    if (!(k < kMid - 0.5)) continue;
    const km = nz - 1 - k;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) F[idx(i, j, k)] = F[idx(i, j, km)];
  }
  // one vertex per cell that the surface crosses
  const cellV = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cidx = (i, j, k) => (k * (ny - 1) + j) * (nx - 1) + i;
  const pos = [];
  const corners = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const v = new Float64Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          v[c] = F[idx(i + corners[c][0], j + corners[c][1], k + corners[c][2])];
          if (v[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of edges) {
          if (v[a] < 0 === v[b] < 0) continue;
          const t = v[a] / (v[a] - v[b]);
          sx += corners[a][0] + t * (corners[b][0] - corners[a][0]);
          sy += corners[a][1] + t * (corners[b][1] - corners[a][1]);
          sz += corners[a][2] + t * (corners[b][2] - corners[a][2]);
          n++;
        }
        let px = x0 + (i + sx / n) * h;
        let py = y0 + (j + sy / n) * h;
        let pz = z0 + (k + sz / n) * h;
        // project onto the surface along the gradient (two Newton steps, kept inside the cell)
        for (let it = 0; it < 2; it++) {
          const e = h * 0.25;
          const f = body(px, py, pz);
          const gx = (body(px + e, py, pz) - body(px - e, py, pz)) / (2 * e);
          const gy = (body(px, py + e, pz) - body(px, py - e, pz)) / (2 * e);
          const gz = (body(px, py, pz + e) - body(px, py, pz - e)) / (2 * e);
          const g2 = gx * gx + gy * gy + gz * gz;
          if (g2 < 1e-8) break;
          const s = f / g2;
          const qx = px - gx * s, qy = py - gy * s, qz = pz - gz * s;
          const cx = x0 + i * h, cy = y0 + j * h, cz = z0 + k * h;
          const pad = h * 0.15;
          px = Math.min(cx + h + pad, Math.max(cx - pad, qx));
          py = Math.min(cy + h + pad, Math.max(cy - pad, qy));
          pz = Math.min(cz + h + pad, Math.max(cz - pad, qz));
        }
        cellV[cidx(i, j, k)] = pos.length / 3;
        pos.push(px, py, pz);
      }
  // one quad per grid edge the surface crosses
  const ind = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) ind.push(a, c, b, a, d, c);
    else ind.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = F[idx(i, j, k)] < 0, b = F[idx(i + 1, j, k)] < 0;
        if (a === b) continue;
        quad(cellV[cidx(i, j - 1, k - 1)], cellV[cidx(i, j, k - 1)], cellV[cidx(i, j, k)], cellV[cidx(i, j - 1, k)], !a);
      }
  for (let k = 1; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const a = F[idx(i, j, k)] < 0, b = F[idx(i, j + 1, k)] < 0;
        if (a === b) continue;
        quad(cellV[cidx(i - 1, j, k - 1)], cellV[cidx(i - 1, j, k)], cellV[cidx(i, j, k)], cellV[cidx(i, j, k - 1)], !a);
      }
  for (let k = 0; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const a = F[idx(i, j, k)] < 0, b = F[idx(i, j, k + 1)] < 0;
        if (a === b) continue;
        quad(cellV[cidx(i - 1, j - 1, k)], cellV[cidx(i, j - 1, k)], cellV[cidx(i, j, k)], cellV[cidx(i - 1, j, k)], !a);
      }
  // normals: the field's gradient
  const nrm = new Float32Array(pos.length);
  for (let p = 0; p < pos.length; p += 3) {
    const e = 0.004;
    const [px, py, pz] = [pos[p], pos[p + 1], pos[p + 2]];
    let gx = body(px + e, py, pz) - body(px - e, py, pz);
    let gy = body(px, py + e, pz) - body(px, py - e, pz);
    let gz = body(px, py, pz + e) - body(px, py, pz - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    nrm[p] = gx / l;
    nrm[p + 1] = gy / l;
    nrm[p + 2] = gz / l;
  }
  return { pos: Float32Array.from(pos), nrm, ind: Uint32Array.from(ind) };
}

function octEncode(x, y, z) {
  const l = Math.abs(x) + Math.abs(y) + Math.abs(z);
  let u = x / l, v = y / l;
  if (z < 0) {
    const ou = u;
    u = (1 - Math.abs(v)) * (ou >= 0 ? 1 : -1);
    v = (1 - Math.abs(ou)) * (v >= 0 ? 1 : -1);
  }
  return [Math.round(u * 32767), Math.round(v * 32767)];
}

function write(name, m) {
  const nv = m.pos.length / 3;
  const ni = m.ind.length;
  let b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++)
    for (let a = 0; a < 3; a++) {
      b[a] = Math.min(b[a], m.pos[i * 3 + a]);
      b[a + 3] = Math.max(b[a + 3], m.pos[i * 3 + a]);
    }
  const head = 4 + 4 + 4 + 24;
  const buf = Buffer.alloc(head + nv * 6 + nv * 4 + ni * 4);
  buf.write('FOB1', 0, 'ascii');
  buf.writeUInt32LE(nv, 4);
  buf.writeUInt32LE(ni, 8);
  for (let a = 0; a < 6; a++) buf.writeFloatLE(b[a], 12 + a * 4);
  let o = head;
  for (let i = 0; i < nv; i++)
    for (let a = 0; a < 3; a++) {
      const t = (m.pos[i * 3 + a] - b[a]) / (b[a + 3] - b[a]);
      buf.writeInt16LE(Math.round(t * 65534 - 32767), o);
      o += 2;
    }
  for (let i = 0; i < nv; i++) {
    const [u, v] = octEncode(m.nrm[i * 3], m.nrm[i * 3 + 1], m.nrm[i * 3 + 2]);
    buf.writeInt16LE(u, o);
    buf.writeInt16LE(v, o + 2);
    o += 4;
  }
  for (let i = 0; i < ni; i++) {
    buf.writeUInt32LE(m.ind[i], o);
    o += 4;
  }
  const gz = gzipSync(buf, { level: 9 });
  writeFileSync(join(out, `${name}.bin`), gz);
  console.log(`${name}: ${nv} vertices, ${ni / 3} triangles, ${(buf.length / 1e6).toFixed(2)} MB raw, ${(gz.length / 1e6).toFixed(2)} MB gzip`);
}

const lods = process.argv.includes('--quick') ? [['body-lo', 0.035]] : [['body-hi', 0.016], ['body-lo', 0.03]];
for (const [name, h] of lods) {
  const t = Date.now();
  const m = mesh(h);
  write(name, m);
  console.log(`  (${((Date.now() - t) / 1000).toFixed(1)} s at ${h * 100} cm)`);
}
