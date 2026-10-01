/**
 * The engine: a 2.5 L inline-four with twin overhead camshafts and four valves per cylinder,
 * built from its dimensions (spec/vehicle.ts) so the moving parts can be derived from the
 * engine model (sim/engine.ts) and always agree:
 *
 *   - the crank throws are where sim/engine.ts says (1 and 4 together, 2 and 3 opposite);
 *   - each cam lobe's outline is generated from the same valve-lift function the valves follow,
 *     so a lobe's nose meets the bucket exactly when that valve is fully open;
 *   - the timing chain and the accessory belt run on paths computed around their sprockets and
 *     pulleys, and their speeds follow the crank.
 *
 * Layout (vehicle coordinates): crank axis along x at y = ENGINE.crankY; cylinder 1 at the
 * front (x = ENGINE.xCyl1); intake on the left (−z), exhaust on the right (+z). The block is
 * built as a real solid with open bores and an open-deck water jacket, the head as slices with
 * the ports cut through them, so a section plane (the cutaway) shows what is inside.
 */
import { BufferGeometry, Group, InstancedMesh, Matrix4, Object3D, Quaternion, Vector2, Vector3 } from 'three';
import { ENGINE, VALVES } from '../../spec/vehicle';
import { CRANK_R, ROD_L, BORE, CYL_OFFSET_DEG, intakeLift, exhaustLift, wrap720 } from '../../sim/engine';
import { alongAxis, beltLoop, circlePts, extrude, extrudeX, gear, lathe, merge, rbox, rod, rrectPts, spring, tube, type Pulley } from '../geo/shapes';
import type { PartNode, Rig } from './rig';

const DEG = Math.PI / 180;
export const CRANK_Y = ENGINE.crankY;
const SPACING = ENGINE.boreSpacingMm / 1000;
/** x of each cylinder's axis (1 at the front). */
export const XC = [0, 1, 2, 3].map((i) => ENGINE.xCyl1 - i * SPACING);
export const DECK_Y = CRANK_Y + CRANK_R + ROD_L + 0.032;
const BLOCK_FRONT = XC[0] + 0.07;
const BLOCK_REAR = XC[3] - 0.07;
const HEAD_TOP = DECK_Y + 0.105;
/** Valve geometry: seat centres (z), inclination from vertical, length. */
const VALVE_TILT = 20 * DEG;
const SEAT_Y = DECK_Y + 0.0135;
const SEAT_Z_IN = -0.019;
const SEAT_Z_EX = 0.019;
const VALVE_LEN = 0.098;
const VALVE_DX = 0.0175;
const CAM_BASE = 0.0165;
const BUCKET = 0.0065;
/** Direction of a valve's axis (up and outward), in (z, y). */
export const VDIR_IN = new Vector2(-Math.sin(VALVE_TILT), Math.cos(VALVE_TILT));
export const VDIR_EX = new Vector2(Math.sin(VALVE_TILT), Math.cos(VALVE_TILT));
const tipOf = (seatZ: number, d: Vector2) => new Vector2(seatZ + d.x * VALVE_LEN, SEAT_Y + d.y * VALVE_LEN);
const camOf = (seatZ: number, d: Vector2) => tipOf(seatZ, d).add(d.clone().multiplyScalar(BUCKET + CAM_BASE));
export const CAM_IN = camOf(SEAT_Z_IN, VDIR_IN);
export const CAM_EX = camOf(SEAT_Z_EX, VDIR_EX);
export const MAX_LIFT_IN = VALVES.intakeLiftMm / 1000;
export const MAX_LIFT_EX = VALVES.exhaustLiftMm / 1000;
/** Front accessory drive plane, and the timing drive plane. */
export const BELT_X = BLOCK_FRONT + 0.075;
export const CHAIN_X = BLOCK_FRONT + 0.016;
export const FLEX_X = BLOCK_REAR - 0.012;

/** Pulleys of the accessory drive in (u = −z, v = y), in the order the belt meets them. */
export const ACCESSORY: (Pulley & { id: string; ratio?: number })[] = [
  { id: 'crank', u: 0, v: CRANK_Y, r: 0.085 },
  { id: 'tensioner', u: -0.115, v: CRANK_Y + 0.15, r: 0.033, inside: false },
  { id: 'alternator', u: -0.19, v: CRANK_Y + 0.27, r: 0.031 },
  { id: 'waterpump', u: 0.0, v: CRANK_Y + 0.215, r: 0.055 },
  { id: 'idler', u: 0.085, v: CRANK_Y + 0.125, r: 0.035, inside: false },
  { id: 'compressor', u: 0.19, v: CRANK_Y + 0.0, r: 0.06 },
];

/** Timing drive: crank sprocket, exhaust cam sprocket, intake cam sprocket (u = −z, v = y). */
export const TIMING: (Pulley & { id: string })[] = [
  { id: 'crank', u: 0, v: CRANK_Y, r: 0.0225 },
  { id: 'exhaust', u: -CAM_EX.x, v: CAM_EX.y, r: 0.045 },
  { id: 'intake', u: -CAM_IN.x, v: CAM_IN.y, r: 0.045 },
];

export interface EngineParts {
  crank: PartNode[];
  pistons: PartNode[];
  rods: PartNode[];
  camIn: PartNode;
  camEx: PartNode;
  valves: { node: PartNode; spring: PartNode; cyl: number; intake: boolean; dir: Vector3; seat: Vector3 }[];
  pulleys: { node: PartNode; ratio: number }[];
  chain: { mesh: InstancedMesh; loop: ReturnType<typeof beltLoop>; pitch: number };
  belt: ReturnType<typeof beltLoop>;
  flexplate: PartNode;
  starterPinion: PartNode;
  /** Where the spark plug tips and injector nozzles are (for sparks, sprays and flames). */
  plugTips: Vector3[];
  injectorTips: Vector3[];
  /** Exhaust and intake port mouths per cylinder (for the gas flows). */
  ports: { intake: Vector3; exhaust: Vector3; intakeOuter: Vector3; exhaustOuter: Vector3 }[];
  root: Group;
}

/** The lobe outline of a cam for one valve of cylinder i (in the cam's own frame, (z, y) plane). */
function lobeOutline(cyl: number, intake: boolean, liftMax: number): [number, number][] {
  // follower direction, measured clockwise (seen from the front) from straight up
  const d = intake ? VDIR_IN : VDIR_EX;
  const beta = Math.atan2(-(-d.x), -d.y); // direction from cam centre to valve: (−dz, −dy)
  const out: [number, number][] = [];
  const N = 120;
  for (let k = 0; k < N; k++) {
    const g = (k / N) * Math.PI * 2;
    // the cam has turned ψ = β − γ when this local angle faces the follower; crank θ = 2ψ
    const thetaDeg = (2 * (beta - g)) / DEG;
    const phase = wrap720(thetaDeg - CYL_OFFSET_DEG[cyl]);
    const lift = (intake ? intakeLift(phase) : exhaustLift(phase)) * liftMax;
    const r = CAM_BASE + lift;
    // local angle g clockwise from up (seen from the front): (y, z) = (cos g, −sin g)
    out.push([-Math.sin(g) * r, Math.cos(g) * r]);
  }
  return out;
}

export function buildEngine(rig: Rig, parent: Object3D): EngineParts {
  const root = new Group();
  root.name = 'engine-root';
  parent.add(root);
  const A = 'engine';

  // ───────────────────────── block ─────────────────────────
  {
    // upper block: outer wall around an open-deck water jacket
    const yTop = DECK_Y;
    const yMid = CRANK_Y + 0.05;
    const hUp = yTop - yMid;
    const outer = rrectPts(BLOCK_FRONT - BLOCK_REAR, 0.224, 0.018, (BLOCK_FRONT + BLOCK_REAR) / 2, 0, 5);
    const jacket = rrectPts(BLOCK_FRONT - BLOCK_REAR - 0.03, 0.138, 0.03, (BLOCK_FRONT + BLOCK_REAR) / 2, 0, 5).reverse();
    const upperWall = extrude(outer, hUp, { holes: [jacket] });
    // cylinder wall pack: the siamesed bores
    const packOutline = rrectPts(XC[0] - XC[3] + 2 * 0.0505, 0.101, 0.045, (XC[0] + XC[3]) / 2, 0, 8);
    const bores = XC.map((x) => circlePts(BORE / 2, 40, x, 0).reverse());
    const pack = extrude(packOutline, hUp - 0.006, { holes: bores, curveSegments: 24 });
    // these are extruded along +z in their (x, z-as-y) plane: stand them up (y up)
    for (const g of [upperWall, pack]) {
      g.rotateX(Math.PI / 2);
    }
    upperWall.translate(0, yMid + hUp / 2, 0);
    pack.translate(0, yMid + (hUp - 0.006) / 2, 0);
    // lower block (crankcase) with the crank's cavity, main bearing bulkheads, ribs
    const yBot = CRANK_Y - 0.085;
    const lowOuter = rrectPts(BLOCK_FRONT - BLOCK_REAR, 0.3, 0.02, (BLOCK_FRONT + BLOCK_REAR) / 2, 0, 5);
    const cavity = rrectPts(BLOCK_FRONT - BLOCK_REAR - 0.024, 0.25, 0.02, (BLOCK_FRONT + BLOCK_REAR) / 2, 0, 5).reverse();
    const lower = extrude(lowOuter, yMid - yBot, { holes: [cavity] });
    lower.rotateX(Math.PI / 2);
    lower.translate(0, (yMid + yBot) / 2, 0);
    // shoulder between the wider crankcase and the upper block
    const shoulder = rbox(BLOCK_FRONT - BLOCK_REAR, 0.018, 0.3, 0.006, (BLOCK_FRONT + BLOCK_REAR) / 2, yMid + 0.009, 0);
    const bulk: BufferGeometry[] = [];
    for (let k = 0; k < 5; k++) {
      const x = XC[0] + SPACING / 2 - k * SPACING;
      // bulkhead with a cradle for the main bearing
      const outline: [number, number][] = [
        [-0.125, yMid],
        [-0.125, CRANK_Y],
        ...circlePts(0.034, 16, 0, CRANK_Y, Math.PI, 0).map(([a, b]) => [a, b] as [number, number]),
        [0.125, CRANK_Y],
        [0.125, yMid],
      ];
      bulk.push(extrudeX(outline, x - 0.009, x + 0.009));
      // main bearing cap below the crank
      bulk.push(
        extrudeX(
          [[-0.06, CRANK_Y], ...circlePts(0.034, 16, 0, CRANK_Y, Math.PI, Math.PI * 2).reverse(), [0.06, CRANK_Y], [0.05, CRANK_Y - 0.05], [-0.05, CRANK_Y - 0.05]],
          x - 0.009,
          x + 0.009,
        ),
      );
    }
    // casting ribs on the sides
    for (const z of [-0.112, 0.112])
      for (let k = 0; k < 5; k++) bulk.push(rbox(0.008, hUp * 0.85, 0.006, 0.002, XC[0] + SPACING / 2 - k * SPACING, yMid + hUp * 0.45, z + Math.sign(z) * 0.003));
    rig.part(root, 'engine-block', 'engine-block', A, [['castAl', merge([upperWall, pack, lower, shoulder, ...bulk])]]);
  }

  // ───────────────────────── cylinder head ─────────────────────────
  const plugTips: Vector3[] = [];
  const injectorTips: Vector3[] = [];
  const ports: EngineParts['ports'] = [];
  {
    const slices: BufferGeometry[] = [];
    const W = 0.122;
    const y0 = DECK_Y;
    const yT = HEAD_TOP - 0.03;
    // the section of one cylinder's slice, as separate pieces of material (z, y)
    const portPieces = (): [number, number][][] => [
      // lower intake-side wedge, under the intake port
      [
        [-W, y0],
        [-0.04, y0],
        [-0.034, y0 + 0.0095],
        [-W, y0 + 0.048],
      ],
      // intake side above the port, up to the plug well
      [
        [-0.004, y0 + 0.0135],
        [-W, y0 + 0.091],
        [-W, yT],
        [-0.0115, yT],
        [-0.0115, y0 + 0.027],
        [-0.0055, y0 + 0.021],
        [-0.0055, y0 + 0.0135],
      ],
      // exhaust side above its port
      [
        [0.0055, y0 + 0.0135],
        [0.0055, y0 + 0.021],
        [0.0115, y0 + 0.027],
        [0.0115, yT],
        [W, yT],
        [W, y0 + 0.071],
        [0.004, y0 + 0.0135],
      ],
      // lower exhaust-side wedge
      [
        [0.034, y0 + 0.0095],
        [0.04, y0],
        [W, y0],
        [W, y0 + 0.035],
      ],
    ];
    const solidPiece: [number, number][] = [
      [-W, y0],
      [W, y0],
      [W, yT],
      [-W, yT],
    ];
    const addSlice = (pieces: [number, number][][], x0: number, x1: number) => {
      for (const p of pieces) slices.push(extrudeX(p, x0, x1));
    };
    // front end wall, then for each cylinder: a bridge, the ported slice, a bridge
    addSlice([solidPiece], XC[0] + 0.049, BLOCK_FRONT);
    for (let i = 0; i < 4; i++) {
      const xc = XC[i];
      addSlice(portPieces(), xc - 0.036, xc + 0.036);
      if (i < 3) addSlice([solidPiece], XC[i + 1] + 0.036, xc - 0.036);
      else addSlice([solidPiece], BLOCK_REAR, xc - 0.036);
      if (i === 0) addSlice([solidPiece], xc + 0.036, xc + 0.049);
      plugTips.push(new Vector3(xc, y0 + 0.012, 0));
      // injector: on the intake side, aimed into the chamber
      injectorTips.push(new Vector3(xc, y0 + 0.016, -0.036));
      ports.push({
        intake: new Vector3(xc, SEAT_Y + 0.002, SEAT_Z_IN),
        exhaust: new Vector3(xc, SEAT_Y + 0.002, SEAT_Z_EX),
        intakeOuter: new Vector3(xc, y0 + 0.07, -W),
        exhaustOuter: new Vector3(xc, y0 + 0.053, W),
      });
    }
    // cam bearing towers on top of the head
    for (let k = 0; k < 5; k++) {
      const x = XC[0] + 0.049 - k * SPACING;
      for (const c of [CAM_IN, CAM_EX]) slices.push(rbox(0.016, c.y - yT + 0.012, 0.05, 0.004, x, (c.y + yT) / 2 - 0.004, c.x));
    }
    rig.part(root, 'cylinder-head', 'cylinder-head', A, [['castAl', merge(slices)]]);
    // head gasket: a thin steel layer
    const gasket = extrude(rrectPts(BLOCK_FRONT - BLOCK_REAR, 0.226, 0.016, (BLOCK_FRONT + BLOCK_REAR) / 2, 0, 4), 0.0016, {
      holes: XC.map((x) => circlePts(BORE / 2 + 0.001, 32, x, 0).reverse()),
      curveSegments: 16,
    });
    gasket.rotateX(Math.PI / 2);
    gasket.translate(0, DECK_Y + 0.0006, 0);
    rig.part(root, 'head-gasket', 'head-gasket', A, [['steel', gasket]]);
    // cam cover
    const coverOutline = rrectPts(BLOCK_FRONT - BLOCK_REAR + 0.01, 0.23, 0.05, (BLOCK_FRONT + BLOCK_REAR) / 2, 0, 8);
    const cover = extrude(coverOutline, 0.06, { bevel: 0.012 });
    cover.rotateX(Math.PI / 2);
    cover.translate(0, yT + 0.03, 0);
    const ribs: BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) ribs.push(rbox(0.05, 0.006, 0.17, 0.003, XC[i], yT + 0.062, 0));
    rig.part(root, 'cam-cover', 'cam-cover', A, [['polymer', merge([cover, ...ribs])]]);
  }

  // ───────────────────────── crankshaft ─────────────────────────
  const crank: PartNode[] = [];
  {
    const geos: BufferGeometry[] = [];
    const piv = new Vector3(0, CRANK_Y, 0);
    // main journals
    for (let k = 0; k < 5; k++) {
      const x = XC[0] + SPACING / 2 - k * SPACING;
      geos.push(at(alongAxis(lathe([[0.0, -0.011], [0.031, -0.011], [0.031, 0.011], [0.0, 0.011]], 'y', 32), 'x'), x, CRANK_Y, 0));
    }
    // snout and rear flange
    geos.push(at(lathe([[0, 0], [0.022, 0], [0.022, 0.11], [0, 0.11]], 'x', 24), XC[0] + SPACING / 2, CRANK_Y, 0));
    geos.push(at(lathe([[0, 0], [0.045, 0], [0.045, 0.014], [0, 0.014]], 'x', 32), BLOCK_REAR - 0.004, CRANK_Y, 0));
    for (let i = 0; i < 4; i++) {
      const th = (CYL_OFFSET_DEG[i] % 360) * DEG; // throw angle from up, clockwise seen from the front
      const ty = Math.cos(th) * CRANK_R;
      const tz = -Math.sin(th) * CRANK_R;
      // crank pin
      geos.push(at(alongAxis(lathe([[0, -0.012], [0.026, -0.012], [0.026, 0.012], [0, 0.012]], 'y', 28), 'x'), XC[i], CRANK_Y + ty, tz));
      // two webs with counterweights: an outline in the throw's frame, extruded along x
      for (const side of [-1, 1]) {
        const x = XC[i] + side * 0.0195;
        const web: [number, number][] = [];
        // around the pin end (radius 0.034 at the throw), down the sides, round the counterweight
        for (let k = 0; k <= 12; k++) {
          const a = Math.PI * (k / 12);
          web.push([Math.cos(a) * 0.034, CRANK_R + Math.sin(a) * 0.034]);
        }
        for (let k = 0; k <= 24; k++) {
          const a = Math.PI + (Math.PI * k) / 24;
          web.push([Math.cos(a) * 0.074, Math.sin(a) * 0.068 - 0.004]);
        }
        // the outline is in the throw's frame (v toward the throw): extrude, then turn the throw
        // from straight up to its angle (clockwise seen from the front)
        const g = extrudeX(web, x - 0.0075, x + 0.0075, { bevel: 0.002 });
        g.translate(-x, 0, 0);
        g.rotateX(-th);
        g.translate(x, CRANK_Y, 0);
        geos.push(g);
      }
    }
    // the crank sprocket (timing chain)
    const sprocket = gear(18, TIMING[0].r, 0.006, 0.012);
    sprocket.rotateY(Math.PI / 2);
    sprocket.translate(CHAIN_X, CRANK_Y, 0);
    geos.push(sprocket);
    crank.push(rig.part(root, 'crankshaft', 'crankshaft', A, [['machined', merge(geos)]], { pivot: piv }));
    // harmonic balancer and crank pulley
    const damp = lathe(
      [
        [0.0, 0],
        [0.03, 0],
        [0.03, 0.012],
        [0.07, 0.014],
        [0.085, 0.016],
        [0.085, 0.04],
        [0.07, 0.042],
        [0.03, 0.044],
        [0, 0.044],
      ],
      'x',
      48,
    );
    damp.translate(BELT_X - 0.02, CRANK_Y, 0);
    const holes: BufferGeometry[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      holes.push(rbox(0.012, 0.018, 0.018, 0.005, BELT_X + 0.025, CRANK_Y + Math.cos(a) * 0.05, Math.sin(a) * 0.05));
    }
    crank.push(rig.part(root, 'harmonic-balancer', 'harmonic-balancer', A, [['iron', damp], ['polymer', merge(holes)]], { pivot: piv }));
  }

  // flexplate with its starter ring gear (bolted to the crank's rear flange)
  const flexplate = rig.part(
    root,
    'flexplate',
    'flexplate',
    'transmission',
    [
      ['steel', at(alongAxis(lathe([[0, -0.0015], [0.14, -0.0015], [0.14, 0.0015], [0, 0.0015]], 'y', 64), 'x'), FLEX_X, CRANK_Y, 0)],
      ['machined', (() => { const g = gear(132, 0.148, 0.006, 0.012); g.rotateY(Math.PI / 2); g.translate(FLEX_X, CRANK_Y, 0); return g; })()],
    ],
    { pivot: new Vector3(0, CRANK_Y, 0) },
  );

  // ───────────────────────── pistons, pins, rods ─────────────────────────
  const pistons: PartNode[] = [];
  const rods: PartNode[] = [];
  for (let i = 0; i < 4; i++) {
    const xc = XC[i];
    const pinY = CRANK_Y + CRANK_R + ROD_L; // wrist pin at TDC
    const r = BORE / 2 - 0.0004;
    const crownY = DECK_Y - 0.0005;
    // piston: lathe profile along y, from the skirt's bottom to the crown (with a shallow bowl)
    const prof: [number, number][] = [
      [0.0, crownY - 0.052],
      [r - 0.004, crownY - 0.052],
      [r - 0.0015, crownY - 0.03],
      [r - 0.0006, crownY - 0.018],
      [r - 0.0012, crownY - 0.017],
      [r - 0.0012, crownY - 0.0155],
      [r, crownY - 0.0145],
      [r, crownY - 0.0115],
      [r - 0.0012, crownY - 0.0105],
      [r - 0.0012, crownY - 0.009],
      [r, crownY - 0.008],
      [r, crownY - 0.005],
      [r - 0.0012, crownY - 0.0045],
      [r - 0.0012, crownY - 0.0035],
      [r, crownY - 0.0025],
      [r - 0.001, crownY],
      [0.028, crownY],
      [0.016, crownY - 0.0035],
      [0.0, crownY - 0.004],
    ];
    const pist = lathe(prof, 'y', 40);
    pist.translate(xc, 0, 0);
    const pin = at(alongAxis(lathe([[0.006, -0.03], [0.0115, -0.03], [0.0115, 0.03], [0.006, 0.03]], 'y', 24), 'x'), xc, pinY, 0);
    const node = rig.part(root, `piston-${i + 1}`, 'piston', A, [['aluminium', pist], ['machined', pin]], { pivot: new Vector3(xc, pinY, 0) });
    pistons.push(node);
    // connecting rod (I-beam): drawn hanging straight down from the pin, rotated by the mechanism
    const bigY = pinY - ROD_L;
    const beam: [number, number][] = [
      [-0.008, pinY - 0.012],
      [-0.0115, pinY - 0.04],
      [-0.017, bigY + 0.04],
      [0.017, bigY + 0.04],
      [0.0115, pinY - 0.04],
      [0.008, pinY - 0.012],
    ];
    const rodBody = extrudeX(beam, xc - 0.01, xc + 0.01, { bevel: 0.002 });
    const small = extrudeX(circlePts(0.0165, 24, 0, pinY), xc - 0.01, xc + 0.01, { holes: [circlePts(0.0118, 24, 0, pinY)], bevel: 0.0015 });
    const big = extrudeX(circlePts(0.036, 32, 0, bigY), xc - 0.011, xc + 0.011, { holes: [circlePts(0.0262, 32, 0, bigY)], bevel: 0.002 });
    const parts = [rodBody, small, big];
    const bolts = [-1, 1].map((s) => rod(new Vector3(xc, bigY - 0.03, s * 0.03), new Vector3(xc, bigY + 0.012, s * 0.03), 0.004, 10));
    rods.push(rig.part(root, `rod-${i + 1}`, 'connecting-rod', A, [['steel', merge(parts)], ['machined', merge(bolts)]], { pivot: new Vector3(xc, pinY, 0) }));
  }

  // ───────────────────────── camshafts and valves ─────────────────────────
  const camNode = (intake: boolean): PartNode => {
    const c = intake ? CAM_IN : CAM_EX;
    const geos: BufferGeometry[] = [];
    geos.push(at(alongAxis(lathe([[0, 0], [0.012, 0], [0.012, BLOCK_FRONT - BLOCK_REAR + 0.02], [0, BLOCK_FRONT - BLOCK_REAR + 0.02]], 'y', 20), 'x'), BLOCK_REAR, c.y, c.x));
    for (let k = 0; k < 5; k++) geos.push(at(alongAxis(lathe([[0, -0.008], [0.0135, -0.008], [0.0135, 0.008], [0, 0.008]], 'y', 24), 'x'), XC[0] + 0.049 - k * SPACING, c.y, c.x));
    for (let i = 0; i < 4; i++)
      for (const s of [-1, 1]) {
        const x = XC[i] + s * VALVE_DX;
        const lobe = extrudeX(lobeOutline(i, intake, intake ? MAX_LIFT_IN : MAX_LIFT_EX), x - 0.007, x + 0.007, { bevel: 0.0008 });
        lobe.translate(0, c.y, c.x);
        geos.push(lobe);
      }
    // sprocket with its variable valve timing (cam phaser) hub
    const spr = gear(36, 0.045, 0.006, 0.012);
    spr.rotateY(Math.PI / 2);
    spr.translate(CHAIN_X, c.y, c.x);
    const phaser = at(alongAxis(lathe([[0, 0], [0.034, 0], [0.036, 0.004], [0.036, 0.022], [0.03, 0.026], [0, 0.026]], 'y', 32), 'x'), CHAIN_X + 0.006, c.y, c.x);
    return rig.part(
      root,
      intake ? 'camshaft-intake' : 'camshaft-exhaust',
      'camshaft',
      A,
      [
        ['machined', merge(geos)],
        ['steel', spr],
        ['castAl', phaser],
      ],
      { pivot: new Vector3(0, c.y, c.x) },
    );
  };
  const camIn = camNode(true);
  const camEx = camNode(false);
  rig.part(root, 'vvt-solenoid', 'vvt-actuator', A, [['polymer', rbox(0.03, 0.03, 0.05, 0.008, BLOCK_FRONT - 0.01, HEAD_TOP - 0.01, -0.13)], ['castAl', rbox(0.02, 0.02, 0.02, 0.004, BLOCK_FRONT - 0.01, HEAD_TOP - 0.01, -0.1)]]);

  const valves: EngineParts['valves'] = [];
  for (let i = 0; i < 4; i++)
    for (const intake of [true, false])
      for (const s of [-1, 1]) {
        const x = XC[i] + s * VALVE_DX;
        const d2 = intake ? VDIR_IN : VDIR_EX;
        const seatZ = intake ? SEAT_Z_IN : SEAT_Z_EX;
        const dir = new Vector3(0, d2.y, d2.x);
        const seat = new Vector3(x, SEAT_Y, seatZ);
        const headR = (intake ? VALVES.intakeHeadMm : VALVES.exhaustHeadMm) / 2000;
        // valve built along +y from the seat face, then tilted onto its axis
        const v = lathe(
          [
            [0, -0.0015],
            [headR, -0.0015],
            [headR, 0.0005],
            [headR - 0.004, 0.002],
            [0.004, 0.012],
            [0.003, 0.02],
            [0.003, VALVE_LEN],
            [0, VALVE_LEN],
          ],
          'y',
          24,
        );
        const bucket = lathe([[0, VALVE_LEN - 0.002], [0.0145, VALVE_LEN - 0.002], [0.0145, VALVE_LEN + BUCKET], [0, VALVE_LEN + BUCKET]], 'y', 24);
        const retainer = lathe([[0.003, VALVE_LEN - 0.012], [0.0115, VALVE_LEN - 0.01], [0.0115, VALVE_LEN - 0.007], [0.003, VALVE_LEN - 0.007]], 'y', 20);
        const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
        const m = new Matrix4().compose(seat, q, new Vector3(1, 1, 1));
        for (const g of [v, bucket, retainer]) g.applyMatrix4(m);
        const name = `valve-${intake ? 'in' : 'ex'}-${i + 1}${s < 0 ? 'b' : 'a'}`;
        const node = rig.part(root, name, intake ? 'intake-valve' : 'exhaust-valve', A, [['steel', v], ['machined', merge([bucket, retainer])]], { pivot: seat.clone() });
        // spring: from its seat on the head to the retainer; scaled along the axis as the valve opens
        // spring: from its seat on the head to the retainer, built along its own axis so it can
        // be compressed (scaled) along it as the valve opens
        const springLen = VALVE_LEN - 0.012 - 0.052;
        const sp = spring(0.0105, 0.0016, springLen, 5.5);
        const springBase = seat.clone().addScaledVector(dir, 0.052);
        const sNode = rig.part(root, `${name}-spring`, 'valve-spring', A, [['steel', sp]], { pivot: springBase.clone(), quat: q.clone(), local: true });
        valves.push({ node, spring: sNode, cyl: i, intake, dir, seat });
      }

  // ───────────────────────── timing chain ─────────────────────────
  const chainLoop = beltLoop(TIMING.map(({ u, v, r }) => ({ u, v, r: r + 0.004 })), 400);
  const pitch = 0.008;
  const nLinks = Math.round(chainLoop.length / pitch);
  const linkGeo = merge([rbox(0.0028, 0.0035, 0.0105, 0, -0.0045, 0, 0), rbox(0.0028, 0.0035, 0.0105, 0, 0.0045, 0, 0), alongAxis(lathe([[0, -0.006], [0.0018, -0.006], [0.0018, 0.006], [0, 0.006]], 'y', 6), 'x')]);
  const linkPair = rig.mat(A, 'steel');
  const chainMesh = new InstancedMesh(linkGeo, linkPair.opaque, nLinks);
  chainMesh.name = 'timing-chain:steel';
  chainMesh.userData.pair = linkPair;
  chainMesh.castShadow = false;
  chainMesh.frustumCulled = false;
  const chainGroup = new Group();
  chainGroup.name = 'timing-chain';
  chainGroup.add(chainMesh);
  root.add(chainGroup);
  rig.adopt(chainGroup, 'timing-chain', 'timing-chain', A, [chainMesh], [linkPair]);
  {
    // guides and the tensioner (on the slack side)
    const guide = (side: number) => {
      const pts: Vector3[] = [];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        const v = CRANK_Y + 0.05 + t * (CAM_IN.y - CRANK_Y - 0.1);
        const u = side * (0.034 + 0.012 * Math.sin(t * Math.PI) + t * 0.01);
        pts.push(new Vector3(CHAIN_X, v, -u));
      }
      return tube(pts, 0.006, { radial: 8 });
    };
    rig.part(root, 'chain-guides', 'timing-chain-guides', A, [['polymer', merge([guide(1), guide(-1)])]]);
    rig.part(root, 'chain-tensioner', 'timing-chain-tensioner', A, [['castAl', rbox(0.02, 0.05, 0.022, 0.005, CHAIN_X + 0.008, CRANK_Y + 0.17, 0.06)]]);
  }

  // ───────────────────────── covers and the oil pan ─────────────────────────
  {
    const tc = extrudeX(rrectPts(0.26, HEAD_TOP - CRANK_Y + 0.12, 0.05, 0, (HEAD_TOP + CRANK_Y - 0.12) / 2, 8), BLOCK_FRONT + 0.013, BLOCK_FRONT + 0.035, { bevel: 0.006 });
    rig.part(root, 'timing-cover', 'timing-cover', A, [['castAl', tc]]);
    // oil pan: a deep sump at the front, shallow at the back
    const pan: BufferGeometry[] = [];
    pan.push(rbox(BLOCK_FRONT - BLOCK_REAR, 0.04, 0.29, 0.012, (BLOCK_FRONT + BLOCK_REAR) / 2, CRANK_Y - 0.105, 0));
    pan.push(rbox(0.22, 0.09, 0.25, 0.025, BLOCK_FRONT - 0.13, CRANK_Y - 0.15, 0));
    for (let k = 0; k < 6; k++) pan.push(rbox(0.004, 0.06, 0.24, 0.002, BLOCK_FRONT - 0.03 - k * 0.04, CRANK_Y - 0.16, 0));
    rig.part(root, 'oil-pan', 'oil-pan', 'lubrication', [['castAl', merge(pan)]]);
    // oil pump (chain-driven, in the sump) and its pickup
    rig.part(root, 'oil-pump', 'oil-pump', 'lubrication', [['castAl', rbox(0.06, 0.05, 0.1, 0.01, BLOCK_FRONT - 0.06, CRANK_Y - 0.075, 0.03)]]);
    rig.part(root, 'oil-pickup', 'oil-pickup', 'lubrication', [
      ['steel', tube([new Vector3(BLOCK_FRONT - 0.07, CRANK_Y - 0.1, 0.03), new Vector3(BLOCK_FRONT - 0.1, CRANK_Y - 0.15, 0.0), new Vector3(BLOCK_FRONT - 0.13, CRANK_Y - 0.175, 0)], 0.008)],
      ['steel', at(alongAxis(lathe([[0, 0], [0.035, 0], [0.035, 0.012], [0, 0.012]], 'y', 24), 'y'), BLOCK_FRONT - 0.14, CRANK_Y - 0.19, 0)],
    ]);
    rig.part(root, 'oil-filter', 'oil-filter', 'lubrication', [
      ['filter', at(alongAxis(lathe([[0, 0], [0.038, 0], [0.04, 0.01], [0.04, 0.09], [0.036, 0.1], [0, 0.1]], 'y', 32), 'z'), 1.3, CRANK_Y + 0.02, 0.15)],
      ['castAl', rbox(0.08, 0.06, 0.03, 0.01, 1.3, CRANK_Y + 0.02, 0.135)],
    ]);
  }

  // ───────────────────────── spark plugs, coils, injectors, fuel rail ─────────────────────────
  {
    const plugs: BufferGeometry[] = [];
    const plugCer: BufferGeometry[] = [];
    const coils: BufferGeometry[] = [];
    const injectors: BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const xc = XC[i];
      plugs.push(at(lathe([[0, 0.0], [0.0055, 0.0], [0.0055, 0.018], [0.009, 0.019], [0.009, 0.03], [0, 0.03]], 'y', 16), xc, DECK_Y + 0.012, 0));
      plugCer.push(at(lathe([[0, 0], [0.0055, 0], [0.0055, 0.06], [0, 0.06]], 'y', 16), xc, DECK_Y + 0.042, 0));
      coils.push(at(lathe([[0, 0], [0.011, 0], [0.011, 0.075], [0, 0.075]], 'y', 16), xc, DECK_Y + 0.055, 0));
      coils.push(rbox(0.05, 0.03, 0.05, 0.008, xc, HEAD_TOP + 0.005, 0));
      // injector: from outside the head on the intake side into the chamber
      const tip = injectorTips[i];
      const outer = new Vector3(xc, HEAD_TOP - 0.035, -0.105);
      injectors.push(rod(tip, outer, 0.0055, 14));
      injectors.push(rod(outer, outer.clone().add(new Vector3(0, 0.015, -0.012)), 0.009, 14));
    }
    rig.part(root, 'spark-plugs', 'spark-plug', 'ignition', [['machined', merge(plugs)], ['airbag', merge(plugCer)]]);
    rig.part(root, 'ignition-coils', 'ignition-coil', 'ignition', [['polymerGloss', merge(coils)]]);
    rig.part(root, 'fuel-injectors', 'fuel-injector', 'injection', [['machined', merge(injectors)]]);
    const railY = HEAD_TOP - 0.018;
    rig.part(root, 'fuel-rail', 'fuel-rail', 'injection', [['steel', rod(new Vector3(BLOCK_FRONT, railY, -0.122), new Vector3(BLOCK_REAR + 0.01, railY, -0.122), 0.011, 18)]]);
    rig.part(root, 'hp-fuel-pump', 'high-pressure-pump', 'injection', [['castAl', at(alongAxis(lathe([[0, 0], [0.028, 0], [0.028, 0.06], [0.02, 0.07], [0, 0.07]], 'y', 24), 'y'), BLOCK_REAR + 0.03, HEAD_TOP - 0.005, 0.07)]]);
  }

  // ───────────────────────── accessory drive ─────────────────────────
  const loop = beltLoop(ACCESSORY, 500);
  const pulleys: EngineParts['pulleys'] = [];
  {
    const beltPts = loop.pts.map((p) => new Vector3(BELT_X, p.y, -p.x));
    const beltGeo = tube(beltPts, 0.004, { segments: 500, radial: 6, closed: true });
    beltGeo.scale(1, 1, 1);
    rig.part(root, 'accessory-belt', 'accessory-belt', 'electrical', [['rubber', beltGeo]]);
    for (const p of ACCESSORY) {
      if (p.id === 'crank') continue;
      const c = new Vector3(BELT_X, p.v, -p.u);
      const w = 0.026;
      const prof: [number, number][] = [
        [0, -w / 2],
        [p.r + 0.003, -w / 2],
        [p.r, -w / 2 + 0.003],
        [p.r, w / 2 - 0.003],
        [p.r + 0.003, w / 2],
        [0, w / 2],
      ];
      const g = lathe(prof, 'x', 40);
      g.translate(c.x, c.y, c.z);
      // spokes/holes so the rotation reads
      const marks: BufferGeometry[] = [];
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        marks.push(rbox(0.004, p.r * 0.35, p.r * 0.18, 0.002, c.x + w / 2 + 0.001, c.y + Math.cos(a) * p.r * 0.55, c.z + Math.sin(a) * p.r * 0.55));
      }
      const comp = p.id === 'waterpump' ? 'water-pump' : p.id === 'alternator' ? 'alternator' : p.id === 'compressor' ? 'ac-compressor' : p.id === 'idler' ? 'idler-pulley' : 'belt-tensioner';
      const assembly = p.id === 'waterpump' ? 'cooling' : p.id === 'compressor' ? 'hvac' : 'electrical';
      const node = rig.part(root, `pulley-${p.id}`, comp, assembly, [['steel', g], ['polymer', merge(marks)]], { pivot: c });
      // pulleys on the belt's back turn the other way
      pulleys.push({ node, ratio: (p.inside === false ? -1 : 1) * (ACCESSORY[0].r / p.r) });
    }
    // the machines behind their pulleys
    const alt = ACCESSORY.find((p) => p.id === 'alternator')!;
    const altC = new Vector3(BELT_X - 0.02, alt.v, -alt.u);
    const altGeo = at(alongAxis(lathe([[0, 0], [0.06, 0], [0.068, 0.01], [0.068, 0.1], [0.06, 0.115], [0, 0.115]], 'y', 32), 'x'), altC.x - 0.13, altC.y, altC.z);
    const altFins: BufferGeometry[] = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      altFins.push(rbox(0.1, 0.004, 0.012, 0.001, altC.x - 0.075, altC.y + Math.cos(a) * 0.066, altC.z + Math.sin(a) * 0.066));
    }
    rig.part(root, 'alternator', 'alternator', 'electrical', [['castAl', merge([altGeo, ...altFins])], ['copper', rbox(0.03, 0.02, 0.02, 0.004, altC.x - 0.14, altC.y + 0.05, altC.z + 0.02)]]);
    const wp = ACCESSORY.find((p) => p.id === 'waterpump')!;
    rig.part(root, 'water-pump', 'water-pump', 'cooling', [['castAl', at(alongAxis(lathe([[0, 0], [0.055, 0], [0.055, 0.04], [0.035, 0.05], [0, 0.05]], 'y', 32), 'x'), BLOCK_FRONT + 0.012, wp.v, -wp.u)]]);
    const ac = ACCESSORY.find((p) => p.id === 'compressor')!;
    rig.part(root, 'ac-compressor', 'ac-compressor', 'hvac', [['castAl', at(alongAxis(lathe([[0, 0], [0.06, 0], [0.065, 0.01], [0.065, 0.16], [0.05, 0.18], [0, 0.18]], 'y', 32), 'x'), BELT_X - 0.2, ac.v, -ac.u)]]);
  }

  // ───────────────────────── starter ─────────────────────────
  const starterPinion = (() => {
    // the starter's axis sits one pinion radius outside the ring gear, low on the left
    // (angle clockwise from straight up, seen from the front: 145° is low on the car's left)
    const dirA = (145 * Math.PI) / 180;
    const rr = 0.148 + 0.012 + 0.003;
    const sx = FLEX_X - 0.02;
    const sy = CRANK_Y + Math.cos(dirA) * rr;
    const sz = -Math.sin(dirA) * rr;
    rig.part(root, 'starter', 'starter-motor', 'electrical', [
      ['steel', at(alongAxis(lathe([[0, 0], [0.04, 0], [0.042, 0.01], [0.042, 0.13], [0.03, 0.14], [0, 0.14]], 'y', 28), 'x'), sx - 0.15, sy, sz)],
      ['steel', at(alongAxis(lathe([[0, 0], [0.022, 0], [0.022, 0.1], [0, 0.1]], 'y', 20), 'x'), sx - 0.13, sy - 0.05, sz - 0.03)],
      ['copper', rbox(0.02, 0.02, 0.02, 0.004, sx - 0.08, sy - 0.075, sz - 0.04)],
    ]);
    const pin = gear(10, 0.012, 0.005, 0.016);
    pin.rotateY(Math.PI / 2);
    pin.translate(FLEX_X - 0.005, sy, sz);
    return rig.part(root, 'starter-pinion', 'starter-motor', 'electrical', [['machined', pin]], { pivot: new Vector3(FLEX_X - 0.005, sy, sz) });
  })();

  // ───────────────────────── intake ─────────────────────────
  {
    const runners: BufferGeometry[] = [];
    const plenumZ = -0.27;
    const plenumY = DECK_Y - 0.01;
    for (let i = 0; i < 4; i++) {
      const p = ports[i];
      runners.push(
        tube(
          [
            new Vector3(p.intakeOuter.x, p.intakeOuter.y, p.intakeOuter.z - 0.002),
            new Vector3(p.intakeOuter.x, p.intakeOuter.y + 0.01, -0.17),
            new Vector3(p.intakeOuter.x, plenumY + 0.06, -0.24),
            new Vector3(p.intakeOuter.x, plenumY + 0.02, plenumZ),
          ],
          0.019,
          { radial: 14, segments: 24 },
        ),
      );
    }
    const plenum = rbox(BLOCK_FRONT - BLOCK_REAR + 0.02, 0.08, 0.1, 0.035, (BLOCK_FRONT + BLOCK_REAR) / 2 - 0.01, plenumY - 0.01, plenumZ - 0.02);
    rig.part(root, 'intake-manifold', 'intake-manifold', 'intake', [['polymer', merge([plenum, ...runners])]]);
    // throttle body at the plenum's front, then the duct to the air filter box
    const tbC = new Vector3(BLOCK_FRONT + 0.02, plenumY - 0.01, plenumZ - 0.02);
    rig.part(root, 'throttle-body', 'throttle-body', 'intake', [
      ['castAl', at(alongAxis(lathe([[0.032, 0], [0.04, 0], [0.04, 0.05], [0.032, 0.05]], 'y', 28), 'x'), tbC.x, tbC.y, tbC.z)],
      ['polymer', rbox(0.04, 0.05, 0.03, 0.006, tbC.x + 0.025, tbC.y + 0.03, tbC.z - 0.04)],
    ]);
    rig.part(root, 'throttle-plate', 'throttle-body', 'intake', [['machined', at(alongAxis(lathe([[0, -0.0008], [0.031, -0.0008], [0.031, 0.0008], [0, 0.0008]], 'y', 28), 'x'), tbC.x + 0.025, tbC.y, tbC.z)]], { pivot: new Vector3(tbC.x + 0.025, tbC.y, tbC.z) });
    const airbox = new Vector3(1.86, 0.66, -0.47);
    rig.part(root, 'air-duct', 'air-intake-duct', 'intake', [
      ['rubber', tube([tbC.clone().add(new Vector3(0.05, 0, 0)), new Vector3(1.72, plenumY + 0.03, -0.3), new Vector3(1.8, 0.68, -0.4), airbox.clone().add(new Vector3(-0.04, 0, 0.06))], 0.034, { radial: 16 })],
    ]);
    rig.part(root, 'maf-sensor', 'maf-sensor', 'intake', [['polymer', at(alongAxis(lathe([[0.035, 0], [0.04, 0], [0.04, 0.06], [0.035, 0.06]], 'y', 24), 'x'), 1.74, plenumY + 0.035, -0.33)], ['polymerGloss', rbox(0.03, 0.03, 0.025, 0.005, 1.77, plenumY + 0.075, -0.33)]]);
    rig.part(root, 'air-filter-box', 'air-filter', 'intake', [['polymer', rbox(0.26, 0.15, 0.24, 0.03, airbox.x, airbox.y, airbox.z)], ['polymer', tube([airbox.clone().add(new Vector3(0.12, 0.02, 0)), new Vector3(2.05, 0.68, -0.44), new Vector3(2.12, 0.62, -0.35)], 0.04, { radial: 14 })]]);
    rig.part(root, 'map-sensor', 'map-sensor', 'intake', [['polymerGloss', rbox(0.03, 0.02, 0.03, 0.005, (BLOCK_FRONT + BLOCK_REAR) / 2, plenumY + 0.035, plenumZ - 0.02)]]);
  }

  // ───────────────────────── sensors ─────────────────────────
  rig.part(root, 'crank-sensor', 'crank-position-sensor', 'control', [['polymerGloss', rod(new Vector3(FLEX_X + 0.02, CRANK_Y - 0.06, 0.15), new Vector3(FLEX_X + 0.02, CRANK_Y - 0.06, 0.11), 0.009, 12)]]);
  rig.part(root, 'cam-sensor', 'cam-position-sensor', 'control', [['polymerGloss', rod(new Vector3(BLOCK_FRONT + 0.0, HEAD_TOP - 0.015, 0.12), new Vector3(BLOCK_FRONT - 0.03, HEAD_TOP - 0.015, 0.09), 0.009, 12)]]);
  rig.part(root, 'knock-sensor', 'knock-sensor', 'control', [['polymerGloss', at(alongAxis(lathe([[0, 0], [0.014, 0], [0.014, 0.012], [0, 0.012]], 'y', 16), 'z'), XC[1] - 0.05, CRANK_Y + 0.12, -0.112 - 0.012)]]);

  // ───────────────────────── mounts ─────────────────────────
  {
    const mounts: BufferGeometry[] = [];
    const rubber: BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const x = XC[1] - 0.03;
      mounts.push(rbox(0.07, 0.025, 0.06, 0.006, x, CRANK_Y + 0.02, s * 0.165));
      rubber.push(at(alongAxis(lathe([[0, 0], [0.035, 0], [0.032, 0.05], [0, 0.05]], 'y', 20), 'y'), x, CRANK_Y - 0.05, s * 0.2));
      mounts.push(rbox(0.09, 0.012, 0.09, 0.004, x, CRANK_Y - 0.056, s * 0.2));
    }
    rig.part(root, 'engine-mounts', 'engine-mount', A, [['steel', merge(mounts)], ['rubber', merge(rubber)]]);
  }

  // thermostat housing and the coolant temperature sensor (front left of the head)
  rig.part(root, 'thermostat-housing', 'thermostat', 'cooling', [['castAl', at(alongAxis(lathe([[0, 0], [0.032, 0], [0.032, 0.05], [0.022, 0.06], [0, 0.06]], 'y', 24), 'z'), BLOCK_FRONT - 0.02, DECK_Y + 0.04, -0.125 - 0.05)]]);
  rig.part(root, 'coolant-temp-sensor', 'coolant-temperature-sensor', 'control', [['polymerGloss', rod(new Vector3(BLOCK_FRONT - 0.07, HEAD_TOP - 0.01, -0.12), new Vector3(BLOCK_FRONT - 0.07, HEAD_TOP + 0.02, -0.13), 0.007, 10)]]);

  return {
    crank,
    pistons,
    rods,
    camIn,
    camEx,
    valves,
    pulleys,
    chain: { mesh: chainMesh, loop: chainLoop, pitch },
    belt: loop,
    flexplate,
    starterPinion,
    plugTips,
    injectorTips,
    ports,
    root,
  };
}

function at(g: BufferGeometry, x: number, y: number, z: number): BufferGeometry {
  g.translate(x, y, z);
  return g;
}

/** Place the timing chain's links along its loop for a crank angle (rad). */
export function placeChain(ch: EngineParts['chain'], crankAngle: number) {
  const s0 = crankAngle * TIMING[0].r;
  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const one = new Vector3(1, 1, 1);
  const n = ch.mesh.count;
  for (let k = 0; k < n; k++) {
    const { p: p2, t } = ch.loop.at(k * ch.pitch + s0 * 1);
    // the loop is clockwise in (u, v); the crank turns clockwise: links travel forward along it
    p.set(CHAIN_X, p2.y, -p2.x);
    // link along the tangent in the (y, z) plane: local y → tangent
    q.setFromUnitVectors(_up, _t.set(0, t.y, -t.x).normalize());
    m.compose(p, q, one);
    ch.mesh.setMatrixAt(k, m);
  }
  ch.mesh.instanceMatrix.needsUpdate = true;
}
const _up = new Vector3(0, 0, 1);
const _t = new Vector3();
