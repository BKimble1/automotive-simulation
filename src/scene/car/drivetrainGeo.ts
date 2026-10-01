/**
 * The transmission and the driveline: torque converter (cover, impeller, turbine, stator and
 * lock-up clutch, each with its blades), the eight-speed's four planetary gearsets and five
 * shift elements, its pump, valve body and controller, the output shaft and flange, the
 * driveshaft with its joints and centre bearing, the differential (hypoid pinion, ring gear,
 * carrier, spider and side gears) and the half shafts with their constant-velocity joints.
 *
 * Rotation conventions are those of sim/drivetrain.ts: shafts along x turn like the crank
 * (clockwise seen from the front: node rotation −angle about x); the ring gear, carrier, half
 * shafts and wheels turn about −z when the car moves forward. The ring gear meshes on the
 * pinion's left (−z) side, which is what makes forward drive come out forward.
 */
import { BufferGeometry, Group, Object3D, Quaternion, Vector3 } from 'three';
import { BODY, GEARBOX, WHEEL_Y } from '../../spec/vehicle';
import { GEARSETS as SETS } from '../../sim/geartrain';
import { alongAxis, bevelGear, extrudeX, gear, lathe, merge, rbox, rod } from '../geo/shapes';
import { CRANK_Y, FLEX_X } from './engineGeo';
import type { PartNode, Rig } from './rig';

export const TRANS = {
  front: FLEX_X - 0.01,
  convX: FLEX_X - 0.06,
  bellEnd: 0.95,
  caseEnd: 0.5,
  tailEnd: 0.43,
  axisY: CRANK_Y,
};
/**
 * The geartrain as drawn: the four gearsets of sim/geartrain.ts at their places along the axis
 * (their ring gears' outer radii), with the tooth counts of the model, so each mesh is the one the
 * model turns. The five shift elements sit where they act: the brakes at the front, against the
 * case; clutch E between sets 2 and 3, C and D between sets 3 and 4.
 *
 * Drawn simplification (stated in docs/ENGINEERING.md): the drums and shafts that join members
 * of different gearsets (carrier 1 to ring 4, ring 2 to sun 3, ring 3 to sun 4…) are not drawn;
 * members that are joined turn together and share a colour in the gearbox view.
 */
export const GEARSETS = [
  { x: 0.885, r: 0.082 },
  { x: 0.83, r: 0.082 },
  { x: 0.735, r: 0.08 },
  { x: 0.632, r: 0.082 },
];
/** Shift element positions: A and B are brakes (held to the case), C, D, E clutches. */
export const ELEMENT_POS: Record<'A' | 'B' | 'C' | 'D' | 'E', { x: number; rIn: number; rOut: number }> = {
  A: { x: 0.936, rIn: 0.04, rOut: 0.064 },
  B: { x: 0.92, rIn: 0.086, rOut: 0.112 },
  E: { x: 0.783, rIn: 0.05, rOut: 0.07 },
  C: { x: 0.69, rIn: 0.024, rOut: 0.04 },
  D: { x: 0.676, rIn: 0.052, rOut: 0.074 },
};
export const DIFF_C = new Vector3(BODY.xRear, WHEEL_Y + 0.012, 0);
export const RING_R = 0.105;
export const PINION_R = RING_R / GEARBOX.finalDrive;
/** The pinion's axis sits below the ring gear's centre (hypoid offset). */
export const PINION_Y = DIFF_C.y - 0.028;
export const PINION_TIP_X = DIFF_C.x + 0.03;
export const DRIVESHAFT = { a: new Vector3(TRANS.tailEnd - 0.02, CRANK_Y, 0), b: new Vector3(DIFF_C.x + 0.2, PINION_Y, 0) };

export interface DrivetrainParts {
  coverImpeller: PartNode[];
  turbine: PartNode[];
  stator: PartNode;
  lockup: PartNode;
  inputShaft: PartNode;
  /** Each gearset's members (set 1 and 2 share one sun: set 2's sun node is set 1's). */
  gearsets: { sun: PartNode; carrier: PartNode; ring: PartNode; planets: PartNode[]; planetPos: Vector3[]; x: number }[];
  elements: Record<'A' | 'B' | 'C' | 'D' | 'E', PartNode>;
  output: PartNode[];
  driveshaft: PartNode;
  pinion: PartNode;
  carrier: PartNode;
  ring: PartNode;
  spiders: PartNode[];
  sideGears: PartNode[];
  root: Group;
}

export function buildDrivetrain(rig: Rig, parent: Object3D): DrivetrainParts {
  const root = new Group();
  root.name = 'drivetrain-root';
  parent.add(root);
  const T = 'transmission';
  const ax = new Vector3(0, TRANS.axisY, 0);

  // ───────────────────────── case ─────────────────────────
  {
    const bell = lathe(
      [
        [0.215, TRANS.front],
        [0.222, TRANS.front - 0.012],
        [0.205, TRANS.front - 0.07],
        [0.16, TRANS.bellEnd + 0.01],
        [0.15, TRANS.bellEnd],
        [0.142, TRANS.bellEnd - 0.08],
        [0.13, 0.7],
        [0.112, TRANS.caseEnd + 0.04],
        [0.098, TRANS.caseEnd],
        [0.07, TRANS.caseEnd - 0.01],
        [0.062, TRANS.tailEnd + 0.005],
        [0.05, TRANS.tailEnd],
      ].map(([r, x]) => [r, -x] as [number, number]),
      'y',
      56,
    );
    // lathe ran along −y with our x values negated: turn it onto +x
    bell.rotateZ(Math.PI / 2);
    bell.translate(0, TRANS.axisY, 0);
    const ribs: BufferGeometry[] = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2;
      ribs.push(rod(new Vector3(TRANS.front - 0.02, TRANS.axisY + Math.cos(a) * 0.205, Math.sin(a) * 0.205), new Vector3(TRANS.bellEnd + 0.02, TRANS.axisY + Math.cos(a) * 0.15, Math.sin(a) * 0.15), 0.006, 6));
    }
    rig.part(root, 'transmission-case', 'transmission-case', T, [['castAl', merge([bell, ...ribs])]]);
    rig.part(root, 'transmission-pan', 'transmission-pan', T, [['steel', rbox(0.4, 0.05, 0.2, 0.012, 0.74, TRANS.axisY - 0.15, 0)]]);
    rig.part(root, 'valve-body', 'valve-body', T, [
      ['castAl', rbox(0.34, 0.035, 0.17, 0.006, 0.74, TRANS.axisY - 0.115, 0)],
      ['polymerGloss', merge([0, 1, 2, 3, 4].map((k) => at(alongAxis(lathe([[0, 0], [0.009, 0], [0.009, 0.04], [0, 0.04]], 'y', 12), 'z'), 0.6 + k * 0.06, TRANS.axisY - 0.122, 0.07)))],
    ]);
    rig.part(root, 'tcm', 'transmission-control-module', 'control', [['castAl', rbox(0.14, 0.02, 0.12, 0.006, 0.62, TRANS.axisY - 0.135, -0.03)], ['polymer', rbox(0.04, 0.018, 0.03, 0.004, 0.55, TRANS.axisY - 0.13, -0.08)]]);
    rig.part(root, 'trans-mount', 'transmission-mount', T, [['steel', rbox(0.06, 0.03, 0.5, 0.01, TRANS.caseEnd + 0.01, TRANS.axisY - 0.13, 0)], ['rubber', rbox(0.06, 0.04, 0.08, 0.012, TRANS.caseEnd + 0.01, TRANS.axisY - 0.09, 0)]]);
    rig.part(root, 'trans-pump', 'transmission-pump', T, [['castAl', at(alongAxis(lathe([[0.03, 0], [0.12, 0], [0.12, 0.025], [0.03, 0.025]], 'y', 40), 'x'), TRANS.bellEnd + 0.005, TRANS.axisY, 0)]]);
  }

  // ───────────────────────── torque converter ─────────────────────────
  const cx = TRANS.convX;
  const coverImpeller: PartNode[] = [];
  const turbine: PartNode[] = [];
  let stator: PartNode;
  let lockup: PartNode;
  {
    // front cover (engine side) and the impeller shell (rear), welded together at the rim
    const cover = lathe(
      [
        [0.0, cx + 0.05],
        [0.11, cx + 0.05],
        [0.128, cx + 0.044],
        [0.132, cx + 0.03],
        [0.132, cx + 0.0],
      ].map(([r, x]) => [r, -x] as [number, number]),
      'y',
      64,
    );
    cover.rotateZ(Math.PI / 2);
    const shell = lathe(
      [
        [0.132, cx],
        [0.13, cx - 0.018],
        [0.115, cx - 0.036],
        [0.09, cx - 0.044],
        [0.06, cx - 0.042],
        [0.045, cx - 0.032],
        [0.03, cx - 0.032],
        [0.03, cx - 0.07],
      ].map(([r, x]) => [r, -x] as [number, number]),
      'y',
      64,
    );
    shell.rotateZ(Math.PI / 2);
    const lugs: BufferGeometry[] = [];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      lugs.push(rbox(0.012, 0.022, 0.022, 0.004, cx + 0.056, Math.cos(a) * 0.11, Math.sin(a) * 0.11));
    }
    const geoCover = merge([cover, shell, ...lugs]);
    geoCover.translate(0, TRANS.axisY, 0);
    // impeller blades: radial plates inside the shell
    const impBlades: BufferGeometry[] = [];
    const turbBlades: BufferGeometry[] = [];
    const statBlades: BufferGeometry[] = [];
    const n = 28;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const g = extrudeX(
        [
          [-0.0008, 0.058],
          [0.0008, 0.058],
          [0.0008, 0.125],
          [-0.0008, 0.125],
        ],
        cx - 0.038,
        cx - 0.004,
      );
      g.rotateX(a);
      impBlades.push(g);
      const t = extrudeX(
        [
          [-0.0008, 0.058],
          [0.0008, 0.058],
          [0.0008, 0.124],
          [-0.0008, 0.124],
        ],
        cx + 0.003,
        cx + 0.034,
      );
      t.rotateX(a + 0.06);
      turbBlades.push(t);
    }
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const s = extrudeX(
        [
          [-0.004, 0.04],
          [0.004, 0.04],
          [0.004, 0.064],
          [-0.004, 0.064],
        ],
        cx - 0.014,
        cx + 0.01,
      );
      s.rotateX(a);
      statBlades.push(s);
    }
    const impB = merge(impBlades);
    impB.translate(0, TRANS.axisY, 0);
    coverImpeller.push(rig.part(root, 'converter-impeller', 'torque-converter-impeller', T, [['steel', geoCover], ['machined', impB]], { pivot: ax.clone() }));
    // turbine: its shell faces the impeller, its hub drives the input shaft
    const tShell = lathe(
      [
        [0.03, cx + 0.042],
        [0.06, cx + 0.04],
        [0.09, cx + 0.042],
        [0.112, cx + 0.034],
        [0.125, cx + 0.018],
        [0.127, cx + 0.004],
      ].map(([r, x]) => [r, -x] as [number, number]),
      'y',
      64,
    );
    tShell.rotateZ(Math.PI / 2);
    tShell.translate(0, TRANS.axisY, 0);
    const tB = merge(turbBlades);
    tB.translate(0, TRANS.axisY, 0);
    turbine.push(rig.part(root, 'converter-turbine', 'torque-converter-turbine', T, [['aluminium', tShell], ['machined', tB]], { pivot: ax.clone() }));
    const sB = merge([...statBlades, at(alongAxis(lathe([[0.022, -0.012], [0.042, -0.012], [0.042, 0.012], [0.022, 0.012]], 'y', 32), 'x'), cx - 0.002, 0, 0)]);
    sB.translate(0, TRANS.axisY, 0);
    stator = rig.part(root, 'converter-stator', 'torque-converter-stator', T, [['castAl', sB]], { pivot: ax.clone() });
    const lu = at(alongAxis(lathe([[0.06, 0], [0.122, 0], [0.122, 0.004], [0.06, 0.004]], 'y', 56), 'x'), cx + 0.043, TRANS.axisY, 0);
    const lining = at(alongAxis(lathe([[0.09, 0], [0.12, 0], [0.12, 0.002], [0.09, 0.002]], 'y', 56), 'x'), cx + 0.047, TRANS.axisY, 0);
    lockup = rig.part(root, 'lockup-clutch', 'lockup-clutch', T, [['steel', lu], ['pad', lining]], { pivot: ax.clone() });
  }

  // ───────────────────────── input shaft, gearsets, shift elements, output ─────────────────────────
  // the input shaft: from the turbine through the common sun and sun 3 to clutch C (carrier 2 and
  // clutch C's inner plates are on it); the output shaft starts behind set 4's carrier
  const inputEnd = ELEMENT_POS.C.x - 0.014;
  const inputShaft = rig.part(root, 'input-shaft', 'transmission-input-shaft', T, [['machined', at(alongAxis(lathe([[0, 0], [0.014, 0], [0.014, cx - 0.02 - inputEnd], [0, cx - 0.02 - inputEnd]], 'y', 20), 'x'), inputEnd, TRANS.axisY, 0)]], { pivot: ax.clone() });
  const gearsets: DrivetrainParts['gearsets'] = [];
  // tooth phase of a gear at a direction θ (shape plane): 0 at a tooth's centre, 0.5 at a gap's
  // (shapes.ts gear(): tooth j is centred at 2π(j + 0.4375)/teeth before the offset δ)
  const phase = (theta: number, teeth: number, delta: number) => {
    const u = ((theta - delta) * teeth) / (2 * Math.PI) - 0.4375;
    return u - Math.floor(u);
  };
  const offsetFor = (theta: number, teeth: number, want: number) => theta - (2 * Math.PI * (want + 0.4375)) / teeth;
  let commonSun: PartNode | null = null;
  GEARSETS.forEach((gs, k) => {
    const def = SETS[k];
    const S = def.S;
    const P = def.P;
    const R = def.R;
    const N = def.planets;
    const mod = ((gs.r - 0.012) * 2) / (R + 2);
    const rs = (S * mod) / 2;
    const rp = (P * mod) / 2;
    const rr = (R * mod) / 2;
    const w = 0.026;
    const pr = rs + rp;
    // planets at shape angles ψ; the sun's teeth set the planets' phases, and the ring is phased
    // to the first planet (the assembly condition (S + R)/N whole makes every planet fit)
    const psi = (p: number) => Math.PI / 2 - (p / N) * Math.PI * 2;
    const dSun = 0;
    const dPlanet = (p: number) => offsetFor(psi(p) + Math.PI, P, (0.5 - phase(psi(p), S, dSun) + 1) % 1);
    const dRing = offsetFor(psi(0), R, (0.5 - phase(psi(0), P, dPlanet(0)) + 1) % 1);
    const ring = gear(R, rr, mod * 1.2, w, { internal: true, rOuter: gs.r });
    ring.rotateZ(dRing);
    ring.rotateY(Math.PI / 2);
    ring.translate(gs.x, TRANS.axisY, 0);
    const ringNode = rig.part(root, `gearset-${k + 1}-ring`, 'planetary-gearset', T, [['machined', ring]], { pivot: ax.clone() });
    // sets 1 and 2 share one sun (sim/geartrain.ts): one long gear through both sets
    let sunNode: PartNode;
    if (k === 1 && commonSun) sunNode = commonSun;
    else {
      const len = k === 0 ? GEARSETS[0].x - GEARSETS[1].x + w : w;
      const sun = gear(S, rs, mod * 1.2, len, { bore: Math.min(rs * 0.55, 0.016) });
      sun.rotateZ(dSun);
      sun.rotateY(Math.PI / 2);
      sun.translate(k === 0 ? (GEARSETS[0].x + GEARSETS[1].x) / 2 : gs.x, TRANS.axisY, 0);
      sunNode = rig.part(root, `gearset-${k + 1}-sun`, 'planetary-gearset', T, [['steel', sun]], { pivot: ax.clone() });
      if (k === 0) commonSun = sunNode;
    }
    const plate = (x: number) => at(alongAxis(lathe([[Math.min(0.018, rs * 0.8), -0.002], [pr + rp * 0.7, -0.002], [pr + rp * 0.7, 0.002], [Math.min(0.018, rs * 0.8), 0.002]], 'y', 40), 'x'), x, TRANS.axisY, 0);
    const pins: BufferGeometry[] = [];
    for (let p = 0; p < N; p++) {
      const a = (p / N) * Math.PI * 2;
      pins.push(rod(new Vector3(gs.x - w / 2 - 0.004, TRANS.axisY + Math.cos(a) * pr, -Math.sin(a) * pr), new Vector3(gs.x + w / 2 + 0.004, TRANS.axisY + Math.cos(a) * pr, -Math.sin(a) * pr), Math.min(0.006, rp * 0.3), 10));
    }
    const carrierNode = rig.part(root, `gearset-${k + 1}-carrier`, 'planetary-gearset', T, [['castAl', merge([plate(gs.x - w / 2 - 0.004), plate(gs.x + w / 2 + 0.004)])], ['machined', merge(pins)]], { pivot: ax.clone() });
    const planets: PartNode[] = [];
    const planetPos: Vector3[] = [];
    for (let p = 0; p < N; p++) {
      const a = (p / N) * Math.PI * 2;
      const c = new Vector3(gs.x, TRANS.axisY + Math.cos(a) * pr, -Math.sin(a) * pr);
      // a planet is a child of its carrier: its geometry in the carrier's frame (origin on the axis)
      const pg = gear(P, rp, mod * 1.2, w * 0.92, { bore: Math.min(0.006, rp * 0.3) });
      pg.rotateZ(dPlanet(p));
      pg.rotateY(Math.PI / 2);
      pg.translate(c.x - ax.x, c.y - ax.y, c.z - ax.z);
      planets.push(rig.part(carrierNode.object, `gearset-${k + 1}-planet-${p + 1}`, 'planetary-gearset', T, [['machined', pg]], { pivot: c.clone().sub(ax) }));
      planetPos.push(c);
    }
    gearsets.push({ sun: sunNode, carrier: carrierNode, ring: ringNode, planets, planetPos, x: gs.x });
  });
  const elements = {} as DrivetrainParts['elements'];
  for (const [id, e] of Object.entries(ELEMENT_POS) as ['A' | 'B' | 'C' | 'D' | 'E', (typeof ELEMENT_POS)['A']][]) {
    const discs: BufferGeometry[] = [];
    const steels: BufferGeometry[] = [];
    for (let k = 0; k < 6; k++) {
      const x = e.x - 0.012 + k * 0.0045;
      const g = at(alongAxis(lathe([[e.rIn, 0], [e.rOut, 0], [e.rOut, 0.0018], [e.rIn, 0.0018]], 'y', 48), 'x'), x, TRANS.axisY, 0);
      (k % 2 ? steels : discs).push(g);
    }
    const piston = at(alongAxis(lathe([[e.rIn, 0], [e.rOut + 0.004, 0], [e.rOut + 0.004, 0.006], [e.rIn, 0.006]], 'y', 48), 'x'), e.x + 0.016, TRANS.axisY, 0);
    elements[id] = rig.part(root, `shift-element-${id}`, 'shift-element', T, [['pad', merge(discs), undefined, `element-${id}`], ['steel', merge([...steels, piston]), undefined, `element-${id}`]], { pivot: ax.clone() });
  }
  const output: PartNode[] = [];
  output.push(
    rig.part(
      root,
      'output-shaft',
      'transmission-output-shaft',
      T,
      [
        ['machined', at(alongAxis(lathe([[0, 0], [0.02, 0], [0.02, GEARSETS[3].x - 0.018 - TRANS.tailEnd + 0.02], [0, GEARSETS[3].x - 0.018 - TRANS.tailEnd + 0.02]], 'y', 20), 'x'), TRANS.tailEnd - 0.02, TRANS.axisY, 0)],
        ['steel', at(alongAxis(lathe([[0.0, 0], [0.055, 0], [0.055, 0.012], [0.025, 0.02], [0.0, 0.02]], 'y', 32), 'x'), TRANS.tailEnd - 0.035, TRANS.axisY, 0)],
      ],
      { pivot: ax.clone() },
    ),
  );

  // ───────────────────────── driveshaft ─────────────────────────
  const D = 'driveline';
  const { a: dsA, b: dsB } = DRIVESHAFT;
  // built along +x from 0 (the gearbox end) to its length, then turned so +x points along the
  // shaft toward the differential; it spins about that axis
  const len = dsA.distanceTo(dsB);
  const rubber: BufferGeometry[] = [];
  const steel: BufferGeometry[] = [];
  rubber.push(alongAxis(lathe([[0.0, 0.0], [0.065, 0.0], [0.065, 0.028], [0.0, 0.028]], 'y', 32), 'x'));
  steel.push(alongAxis(lathe([[0, 0.028], [0.038, 0.028], [0.038, len - 0.09], [0, len - 0.09]], 'y', 28), 'x'));
  const ujX = len - 0.06;
  steel.push(rbox(0.05, 0.03, 0.07, 0.008, ujX - 0.012, 0, 0));
  steel.push(rod(new Vector3(ujX, -0.03, 0), new Vector3(ujX, 0.03, 0), 0.008, 10));
  steel.push(rod(new Vector3(ujX, 0, -0.03), new Vector3(ujX, 0, 0.03), 0.008, 10));
  steel.push(rbox(0.05, 0.07, 0.03, 0.008, ujX + 0.016, 0, 0));
  steel.push(alongAxis(lathe([[0, 0], [0.05, 0], [0.05, 0.02], [0, 0.02]], 'y', 28), 'x').translate(len - 0.03, 0, 0));
  steel.push(rbox(0.03, 0.006, 0.02, 0.002, len * 0.4, 0.039, 0));
  const dsDir = new Vector3().subVectors(dsB, dsA).normalize();
  const dsQ = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), dsDir);
  const driveshaft = rig.part(root, 'driveshaft', 'driveshaft', D, [['rubber', merge(rubber)], ['steel', merge(steel)]], { pivot: dsA.clone(), quat: dsQ, local: true });
  rig.part(root, 'center-bearing', 'driveshaft-center-bearing', D, [
    ['rubber', at(alongAxis(lathe([[0.04, -0.02], [0.07, -0.02], [0.07, 0.02], [0.04, 0.02]], 'y', 28), 'x'), (dsA.x + dsB.x) / 2, (dsA.y + dsB.y) / 2, 0)],
    ['steel', rbox(0.04, 0.02, 0.24, 0.006, (dsA.x + dsB.x) / 2, (dsA.y + dsB.y) / 2 + 0.08, 0)],
  ]);

  // ───────────────────────── differential ─────────────────────────
  const dc = DIFF_C;
  const housing: BufferGeometry[] = [];
  housing.push(at(alongAxis(lathe([[0, -0.07], [0.12, -0.07], [0.135, -0.04], [0.14, 0.0], [0.135, 0.05], [0.11, 0.075], [0, 0.075]], 'y', 48), 'z'), dc.x, dc.y, 0));
  housing.push(at(alongAxis(lathe([[0.03, 0], [0.07, 0], [0.065, 0.13], [0.04, 0.16], [0.03, 0.16]], 'y', 32), 'x'), dc.x + 0.06, PINION_Y, 0));
  // the axle tubes' stubs, left (pointing −z) and right (+z)
  housing.push(at(alongAxis(lathe([[0.03, 0], [0.06, 0], [0.05, 0.07], [0.04, 0.09], [0.03, 0.09]], 'y', 28), 'z'), dc.x, dc.y, 0.07));
  housing.push(at(alongAxis(lathe([[0.03, -0.09], [0.04, -0.09], [0.05, -0.07], [0.06, 0], [0.03, 0]], 'y', 28), 'z'), dc.x, dc.y, -0.07));
  rig.part(root, 'diff-housing', 'differential-housing', D, [['iron', merge(housing)]]);
  const cover = lathe([[0, 0], [0.13, 0], [0.12, 0.02], [0.08, 0.035], [0, 0.04]], 'y', 48);
  cover.rotateZ(Math.PI / 2); // +y → −x: the cover bulges rearward
  rig.part(root, 'diff-cover', 'differential-housing', D, [['castAl', at(cover, dc.x - 0.07, dc.y, 0)]]);
  // pinion (13 teeth) pointing rearward at the ring gear, below its centre
  const pin = bevelGear(13, PINION_R * 1.25, PINION_R * 0.8, 0.045, 0.008);
  pin.rotateY(-Math.PI / 2); // +z → −x
  pin.translate(PINION_TIP_X + 0.045, PINION_Y, 0);
  const pinShaft = at(alongAxis(lathe([[0, 0], [0.018, 0], [0.018, 0.17], [0, 0.17]], 'y', 20), 'x'), PINION_TIP_X + 0.04, PINION_Y, 0);
  const pinFlange = at(alongAxis(lathe([[0, 0], [0.05, 0], [0.05, 0.015], [0, 0.015]], 'y', 32), 'x'), PINION_TIP_X + 0.19, PINION_Y, 0);
  const pinion = rig.part(root, 'pinion', 'pinion-gear', D, [['machined', merge([pin, pinShaft])], ['steel', pinFlange]], { pivot: new Vector3(0, PINION_Y, 0) });
  // ring gear (41 teeth), on the pinion's left (−z), its teeth facing +z
  const ringG = bevelGear(41, RING_R * 0.92, RING_R * 1.08, 0.03, 0.012, { bore: 0.06 });
  ringG.translate(dc.x, dc.y, -0.055);
  const ring = rig.part(root, 'ring-gear', 'ring-gear', D, [['machined', ringG]], { pivot: dc.clone() });
  // carrier (case), with the cross pin, carrying the spider gears
  const carrierGeo = merge([
    at(alongAxis(lathe([[0.05, -0.05], [0.07, -0.04], [0.075, 0.0], [0.07, 0.04], [0.05, 0.05]], 'y', 40), 'z'), dc.x, dc.y, 0),
    rod(new Vector3(dc.x, dc.y - 0.055, 0), new Vector3(dc.x, dc.y + 0.055, 0), 0.008, 12),
  ]);
  const carrier = rig.part(root, 'diff-carrier', 'differential-carrier', D, [['castAl', carrierGeo]], { pivot: dc.clone() });
  const spiders: PartNode[] = [];
  for (const s of [-1, 1]) {
    const sg = bevelGear(11, 0.028, 0.02, 0.018, 0.006, { bore: 0.008 });
    // axis along ±y, its small end toward the centre; geometry in the carrier's frame
    sg.rotateX(s > 0 ? Math.PI / 2 : -Math.PI / 2);
    const c = new Vector3(dc.x, dc.y + s * 0.045, 0);
    sg.translate(0, s * 0.045, 0);
    spiders.push(rig.part(carrier.object, `spider-gear-${s > 0 ? 'top' : 'bottom'}`, 'spider-gear', D, [['machined', sg]], { pivot: c.clone().sub(dc) }));
  }
  const sideGears: PartNode[] = [];
  for (const s of [-1, 1]) {
    // side gears face the centre: the left one spans z −0.058 … −0.04, the right one 0.04 … 0.058
    const sg = bevelGear(18, 0.034, 0.024, 0.018, 0.007, { bore: 0.012 });
    if (s > 0) sg.rotateY(Math.PI);
    sg.translate(dc.x, dc.y, s * 0.058);
    sideGears.push(rig.part(root, `side-gear-${s < 0 ? 'left' : 'right'}`, 'side-gear', D, [['machined', sg]], { pivot: new Vector3(dc.x, dc.y, 0) }));
  }
  rig.part(root, 'diff-mounts', 'differential-housing', D, [['rubber', merge([-1, 1].map((s) => at(alongAxis(lathe([[0, 0], [0.03, 0], [0.03, 0.04], [0, 0.04]], 'y', 16), 'z'), dc.x - 0.11, dc.y + 0.08, s * 0.1 - 0.02)))]]);

  return { coverImpeller, turbine, stator, lockup, inputShaft, gearsets, elements, output, driveshaft, pinion, carrier, ring, spiders, sideGears, root };
}

function at(g: BufferGeometry, x: number, y: number, z: number): BufferGeometry {
  g.translate(x, y, z);
  return g;
}
