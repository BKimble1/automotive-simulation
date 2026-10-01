/**
 * The body's surface regions: which panel a point of the skin belongs to, where the glass, the
 * lamps, the grille and the trim are. Written twice, once here in TypeScript (to split the
 * baked skin into panel meshes) and once in GLSL (BODY_REGIONS_GLSL, to draw each region per
 * pixel, so shut lines and window edges are sharp whatever the mesh resolution). The two must
 * agree; both are short and line for line the same.
 *
 * Panels (ids):
 *   0 shell (roof, pillars, quarter panels, sills, rear panel)    1 hood      2 front bumper
 *   3 left front fender  4 right front fender   5 left front door   6 right front door
 *   7 left rear door     8 right rear door      9 trunk lid        10 rear bumper
 */

export const PANELS = [
  'shell',
  'hood',
  'bumperFront',
  'fenderL',
  'fenderR',
  'doorFL',
  'doorFR',
  'doorRL',
  'doorRR',
  'trunk',
  'bumperRear',
] as const;
export type PanelName = (typeof PANELS)[number];

const AX_F = 1.425;
const AX_R = -1.425;
const WY = 0.318;

/** Beltline height (the lower edge of the side glass), m. */
export function belt(x: number): number {
  return 0.975 + (0.93 - x) * 0.0247;
}

/** The front door's front shut line (x at height y). */
export function doorFront(y: number): number {
  return 0.985 - (y - 0.2) * 0.07;
}

/** The B-pillar line (between the doors). */
export function bLine(y: number): number {
  return -0.13 - (y - 1.03) * 0.22;
}

/** The rear door's rear edge above the arch dogleg. */
export function rearDoorBack(y: number): number {
  return -1.03 - (1.04 - y) * 0.18;
}

/** Signed distance to the side daylight opening (both windows), in side elevation. */
const DLO: [number, number][] = [
  [0.8, 1.006],
  [0.18, 1.312],
  [-0.3, 1.35],
  [-0.8, 1.334],
  [-1.17, 1.212],
  [-1.37, 1.072],
  [-1.3, 1.034],
  [0.8, 1.006],
];
export function dlo(x: number, y: number): number {
  let d = Infinity;
  let s = 1;
  for (let i = 0; i < DLO.length - 1; i++) {
    const [ax, ay] = DLO[i];
    const [bx, by] = DLO[i + 1];
    const ex = bx - ax, ey = by - ay;
    const wx = x - ax, wy = y - ay;
    const t = Math.min(1, Math.max(0, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    const qx = wx - ex * t, qy = wy - ey * t;
    d = Math.min(d, qx * qx + qy * qy);
    const c1 = y >= ay, c2 = y < by, c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d) + 0.0; // negative inside
}

/** Outside the front or rear wheel arch, with a margin (m). */
function outsideArch(x: number, y: number, ax: number, r: number): boolean {
  return Math.hypot(x - ax, y - WY) > r;
}

/** Hood front edge in plan. */
export function hoodFront(z: number): number {
  const u = z / 0.72;
  return 2.1 - 0.1 * u * u;
}

/**
 * The panel a point of the outer skin belongs to (see the table above). `ny` is the surface
 * normal's vertical component, used only to tell the top of the deck from the rear face.
 */
export function panelOf(x: number, y: number, z: number): number {
  const az = Math.abs(z);
  const right = z > 0;
  // hood: the top of the nose between the cowl and its front edge, inside the fender shut lines
  if (x > 0.955 && y > 0.74 && az < 0.715 && x < hoodFront(z)) return 1;
  // front bumper: ahead of the split line, which runs down from the headlamp into the arch
  if (x > 1.6 && x > 1.87 + (y - 0.46) * 0.633 && outsideArch(x, y, AX_F, 0.39)) return 2;
  // front fenders: from the front door to the bumper, below the hood shut line
  if (x > doorFront(y) && x > 0.9 && y < 1.0) return right ? 4 : 3;
  // trunk lid: the deck behind the rear screen, and the upper rear face
  if (x < -1.775 && az < 0.7 && y > 0.84 && (y > 0.985 || (x < -2.36 && az < 0.62))) return 9;
  // rear bumper: behind the split line, which runs down from the tail lamp into the arch
  if (y < 0.78 && x < -1.6 && x < -2.0 + (0.78 - y) * 1.35 && outsideArch(x, y, AX_R, 0.39)) return 10;
  // doors: side panels between the shut lines, with their window frames
  if (az > 0.55 && y > 0.215) {
    const dl = dlo(x, y);
    const inFrame = y < belt(x) + 0.002 || dl < 0.045;
    if (inFrame) {
      if (x < doorFront(y) && x > bLine(y)) return right ? 6 : 5;
      // the rear door: back to its rear edge, and round the arch below it
      const back = x > rearDoorBack(y) && outsideArch(x, y, AX_R, 0.425) && x > AX_R;
      // the window frame stops at the quarter-glass divider
      const glassBack = y > belt(x) ? x > -1.0 - (y - 1.04) * 0.1 : true;
      if (x <= bLine(y) && back && glassBack) return right ? 8 : 7;
    }
  }
  return 0;
}

/** Same as panelOf, as GLSL. */
export const BODY_REGIONS_GLSL = /* glsl */ `
const vec2 DLO0 = vec2(0.8, 1.006);
const vec2 DLO1 = vec2(0.18, 1.312);
const vec2 DLO2 = vec2(-0.3, 1.35);
const vec2 DLO3 = vec2(-0.8, 1.334);
const vec2 DLO4 = vec2(-1.17, 1.212);
const vec2 DLO5 = vec2(-1.37, 1.072);
const vec2 DLO6 = vec2(-1.3, 1.034);

float bBelt(float x) { return 0.975 + (0.93 - x) * 0.0247; }
float bDoorFront(float y) { return 0.985 - (y - 0.2) * 0.07; }
float bBLine(float y) { return -0.13 - (y - 1.03) * 0.22; }
float bRearDoorBack(float y) { return -1.03 - (1.04 - y) * 0.18; }
float bHoodFront(float z) { float u = z / 0.72; return 2.1 - 0.1 * u * u; }

void dloEdge(vec2 p, vec2 a, vec2 b, inout float d, inout float s) {
  vec2 e = b - a; vec2 w = p - a;
  float t = clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
  vec2 q = w - e * t;
  d = min(d, dot(q, q));
  bool c1 = p.y >= a.y; bool c2 = p.y < b.y; bool c3 = e.x * w.y > e.y * w.x;
  if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
}
float bDlo(vec2 p) {
  float d = 1e9; float s = 1.0;
  dloEdge(p, DLO0, DLO1, d, s); dloEdge(p, DLO1, DLO2, d, s); dloEdge(p, DLO2, DLO3, d, s);
  dloEdge(p, DLO3, DLO4, d, s); dloEdge(p, DLO4, DLO5, d, s); dloEdge(p, DLO5, DLO6, d, s);
  dloEdge(p, DLO6, DLO0, d, s);
  return s * sqrt(d);
}
bool bOutsideArch(float x, float y, float ax, float r) { return length(vec2(x - ax, y - 0.318)) > r; }

int bPanelOf(vec3 p) {
  float x = p.x; float y = p.y; float az = abs(p.z); bool right = p.z > 0.0;
  if (x > 0.955 && y > 0.74 && az < 0.715 && x < bHoodFront(p.z)) return 1;
  if (x > 1.6 && x > 1.87 + (y - 0.46) * 0.633 && bOutsideArch(x, y, 1.425, 0.39)) return 2;
  if (x > bDoorFront(y) && x > 0.9 && y < 1.0) return right ? 4 : 3;
  if (x < -1.775 && az < 0.7 && y > 0.84 && (y > 0.985 || (x < -2.36 && az < 0.62))) return 9;
  if (y < 0.78 && x < -1.6 && x < -2.0 + (0.78 - y) * 1.35 && bOutsideArch(x, y, -1.425, 0.39)) return 10;
  if (az > 0.55 && y > 0.215) {
    float dl = bDlo(vec2(x, y));
    bool inFrame = y < bBelt(x) + 0.002 || dl < 0.045;
    if (inFrame) {
      if (x < bDoorFront(y) && x > bBLine(y)) return right ? 6 : 5;
      bool back = x > bRearDoorBack(y) && bOutsideArch(x, y, -1.425, 0.425) && x > -1.425;
      bool glassBack = y > bBelt(x) ? x > -1.0 - (y - 1.04) * 0.1 : true;
      if (x <= bBLine(y) && back && glassBack) return right ? 8 : 7;
    }
  }
  return 0;
}
`;
