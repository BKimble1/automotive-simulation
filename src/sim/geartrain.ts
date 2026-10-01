/**
 * The eight-speed automatic's geartrain as a mechanism, not a list of ratios: four simple
 * planetary gearsets, two brakes (A, B) and three multi-plate clutches (C, D, E), connected
 * by eight shafts. Every member speed comes from the gearsets' kinematic constraints (Willis'
 * equation, S·ωs + R·ωr = (S + R)·ωc, one per set) and the applied shift elements, so the
 * drawn rotations, the held members, the highlighted elements and the ratio all agree.
 *
 * Architecture (the widely published four-gearset, five-element layout of modern longitudinal
 * eight-speeds, such as the ZF 8HP; the S-1's tooth counts are its own, chosen to satisfy the
 * assembly conditions, so its ratios differ slightly from any production gearbox):
 *
 *   shaft      members on it
 *   input      turbine shaft = carrier 2
 *   sun12      sun 1 = sun 2 (one common sun)          brake A holds it
 *   ring1      ring 1                                   brake B holds it
 *   carrier1   carrier 1 = ring 4
 *   ring2      ring 2 = sun 3
 *   ring3      ring 3 = sun 4                           clutch C joins it to the input
 *                                                       clutch E joins it to ring2 (locks set 3)
 *   carrier3   carrier 3                                clutch D joins it to the output
 *   output     output shaft = carrier 4
 *
 * Three elements are applied in each gear; a single shift releases one and applies one. During
 * a shift the two elements the gears share stay applied, the releasing and applying elements
 * slip, and the input speed moves from the old ratio to the new one (the inertia phase): the
 * shafts' speeds then follow from the two shared elements with the input and output speeds,
 * and the applying element's slip falls to exactly zero as the new ratio is reached.
 *
 * Signs: speeds are about the gearbox axis, positive in the engine's direction of rotation.
 */

export type Shaft = 'input' | 'sun12' | 'ring1' | 'carrier1' | 'ring2' | 'ring3' | 'carrier3' | 'output';
export const SHAFTS: readonly Shaft[] = ['input', 'sun12', 'ring1', 'carrier1', 'ring2', 'ring3', 'carrier3', 'output'];
const IDX: Record<Shaft, number> = Object.fromEntries(SHAFTS.map((s, i) => [s, i])) as Record<Shaft, number>;

export interface GearsetDef {
  id: 1 | 2 | 3 | 4;
  sun: Shaft;
  ring: Shaft;
  carrier: Shaft;
  /** Tooth counts: sun, ring, planet (ring = sun + 2 × planet). */
  S: number;
  R: number;
  P: number;
  planets: number;
}

/** The S-1's gearsets (design). Assembly: R − S even, (S + R) divisible by the planet count. */
export const GEARSETS: readonly GearsetDef[] = [
  { id: 1, sun: 'sun12', ring: 'ring1', carrier: 'carrier1', S: 40, R: 80, P: 20, planets: 4 },
  { id: 2, sun: 'sun12', ring: 'ring2', carrier: 'input', S: 40, R: 80, P: 20, planets: 4 },
  { id: 3, sun: 'ring2', ring: 'ring3', carrier: 'carrier3', S: 62, R: 100, P: 19, planets: 3 },
  { id: 4, sun: 'ring3', ring: 'carrier1', carrier: 'output', S: 24, R: 88, P: 32, planets: 4 },
];

export type Element = 'A' | 'B' | 'C' | 'D' | 'E';
export const ELEMENTS: readonly Element[] = ['A', 'B', 'C', 'D', 'E'];

export interface ElementDef {
  kind: 'brake' | 'clutch';
  /** A brake holds `a` to the case; a clutch joins `a` and `b`. */
  a: Shaft;
  b?: Shaft;
  label: string;
}

export const ELEMENT_DEFS: Record<Element, ElementDef> = {
  A: { kind: 'brake', a: 'sun12', label: 'Brake A holds the common sun of sets 1 and 2' },
  B: { kind: 'brake', a: 'ring1', label: 'Brake B holds ring 1' },
  C: { kind: 'clutch', a: 'input', b: 'ring3', label: 'Clutch C joins the input to sun 4' },
  D: { kind: 'clutch', a: 'carrier3', b: 'output', label: 'Clutch D joins carrier 3 to the output' },
  E: { kind: 'clutch', a: 'ring2', b: 'ring3', label: 'Clutch E locks set 3 (sun 3 to ring 3)' },
};

/** Applied elements per gear (P and N hold A and B, so the gearbox is ready for 1st and R). */
export const SHIFT_TABLE: Record<string, readonly Element[]> = {
  P: ['A', 'B'],
  N: ['A', 'B'],
  R: ['A', 'B', 'D'],
  '1': ['A', 'B', 'C'],
  '2': ['A', 'B', 'E'],
  '3': ['B', 'C', 'E'],
  '4': ['B', 'D', 'E'],
  '5': ['B', 'C', 'D'],
  '6': ['C', 'D', 'E'],
  '7': ['A', 'C', 'D'],
  '8': ['A', 'D', 'E'],
};

export const gearKey = (gear: number, selector: string): string => (gear === -1 ? 'R' : gear === 0 ? (selector === 'P' ? 'P' : 'N') : String(gear));

// ─────────────────────────── the linear solve ───────────────────────────

/** Solve A·x = b (square, partial pivoting). Returns null if singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Speeds of every shaft as a linear function of the input and output speeds:
 * ω = a·ωin + b·ωout. With three applied elements the output follows from the input (b = 0);
 * with two (a shift, neutral, park) both are needed.
 */
interface Response {
  a: number[];
  b: number[];
  /** Whether the output speed is needed (fewer than three elements applied). */
  usesOutput: boolean;
}

const cache = new Map<string, Response>();

function constraintRows(engaged: readonly Element[]): number[][] {
  const rows: number[][] = [];
  for (const g of GEARSETS) {
    const r = new Array(8).fill(0);
    r[IDX[g.sun]] += g.S;
    r[IDX[g.ring]] += g.R;
    r[IDX[g.carrier]] -= g.S + g.R;
    rows.push(r);
  }
  for (const e of engaged) {
    const d = ELEMENT_DEFS[e];
    const r = new Array(8).fill(0);
    r[IDX[d.a]] = 1;
    if (d.b) r[IDX[d.b]] = -1;
    rows.push(r);
  }
  return rows;
}

function response(engaged: readonly Element[]): Response {
  const key = [...engaged].sort().join('');
  const hit = cache.get(key);
  if (hit) return hit;
  const rows = constraintRows(engaged);
  const inRow = new Array(8).fill(0);
  inRow[IDX.input] = 1;
  rows.push(inRow);
  const usesOutput = rows.length < 8;
  if (usesOutput) {
    const outRow = new Array(8).fill(0);
    outRow[IDX.output] = 1;
    rows.push(outRow);
  }
  const rhsA = rows.map((_, i) => (i === 4 + engaged.length ? 1 : 0));
  const rhsB = rows.map((_, i) => (usesOutput && i === rows.length - 1 ? 1 : 0));
  const a = solve(rows, rhsA);
  const b = solve(rows, rhsB);
  if (!a || !b) throw new Error(`geartrain: elements ${key} do not determine the shafts`);
  const r: Response = { a, b, usesOutput };
  cache.set(key, r);
  return r;
}

export interface GeartrainSpeeds {
  /** Shaft speeds, in SHAFTS order. */
  shaft: number[];
  /** Each planet's spin about its own pin, relative to its carrier, per gearset. */
  planet: number[];
  /** Slip speed across each element (0 when it holds). */
  slip: Record<Element, number>;
}

/** Speeds with these elements applied, from the input speed and (when needed) the output speed. */
export function geartrainSpeeds(engaged: readonly Element[], wIn: number, wOut: number, out?: GeartrainSpeeds): GeartrainSpeeds {
  const r = response(engaged);
  const o = out ?? { shaft: new Array(8).fill(0), planet: new Array(4).fill(0), slip: { A: 0, B: 0, C: 0, D: 0, E: 0 } };
  for (let i = 0; i < 8; i++) o.shaft[i] = r.a[i] * wIn + (r.usesOutput ? r.b[i] * wOut : 0);
  GEARSETS.forEach((g, k) => {
    o.planet[k] = ((o.shaft[IDX[g.ring]] - o.shaft[IDX[g.carrier]]) * g.R) / g.P;
  });
  for (const e of ELEMENTS) {
    const d = ELEMENT_DEFS[e];
    o.slip[e] = o.shaft[IDX[d.a]] - (d.b ? o.shaft[IDX[d.b]] : 0);
  }
  return o;
}

/** The ratio (input ÷ output speed) a set of three applied elements gives. */
export function elementsRatio(engaged: readonly Element[]): number {
  const r = response(engaged);
  if (r.usesOutput) return NaN;
  return 1 / r.a[IDX.output];
}

/** Gear ratios from the tooth counts: 1st … 8th and reverse (derived). */
export const DERIVED_RATIOS = {
  forward: ['1', '2', '3', '4', '5', '6', '7', '8'].map((g) => elementsRatio(SHIFT_TABLE[g])),
  reverse: elementsRatio(SHIFT_TABLE.R),
};

/** The elements applied at a moment: all of the gear's when steady, the shared ones in a shift. */
export function appliedElements(gear: number, gearTarget: number, shift: number, selector: string): { engaged: Element[]; applying: Element | null; releasing: Element | null } {
  const a = SHIFT_TABLE[gearKey(gear, selector)] ?? [];
  if (shift >= 1 || gear === gearTarget) return { engaged: [...a], applying: null, releasing: null };
  const b = SHIFT_TABLE[gearKey(gearTarget, selector)] ?? [];
  return {
    engaged: ELEMENTS.filter((e) => a.includes(e) && b.includes(e)),
    applying: b.find((e) => !a.includes(e)) ?? null,
    releasing: a.find((e) => !b.includes(e)) ?? null,
  };
}

export const SHAFT_INDEX = IDX;

/**
 * How the gearbox view names and colours the eight shafts (Okabe–Ito colours, each also named,
 * so colour is never the only key). Members on one shaft turn together and share its colour.
 */
export const SHAFT_KEY: { shaft: Shaft; label: string; color: string; parts: string[]; held?: Element }[] = [
  { shaft: 'input', label: 'Input · carrier 2', color: '#E69F00', parts: ['input-shaft', 'gearset-2-carrier'] },
  { shaft: 'sun12', label: 'Common sun 1·2', color: '#009E73', parts: ['gearset-1-sun'], held: 'A' },
  { shaft: 'ring1', label: 'Ring 1', color: '#F0E442', parts: ['gearset-1-ring'], held: 'B' },
  { shaft: 'carrier1', label: 'Carrier 1 = ring 4', color: '#0072B2', parts: ['gearset-1-carrier', 'gearset-4-ring'] },
  { shaft: 'ring2', label: 'Ring 2 = sun 3', color: '#D55E00', parts: ['gearset-2-ring', 'gearset-3-sun'] },
  { shaft: 'ring3', label: 'Ring 3 = sun 4', color: '#CC79A7', parts: ['gearset-3-ring', 'gearset-4-sun'] },
  { shaft: 'carrier3', label: 'Carrier 3', color: '#C9CED6', parts: ['gearset-3-carrier'] },
  { shaft: 'output', label: 'Output · carrier 4', color: '#56B4E9', parts: ['output-shaft', 'gearset-4-carrier'] },
];
