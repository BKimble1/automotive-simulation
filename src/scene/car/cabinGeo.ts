/**
 * The cabin and occupant safety: seats, dashboard, instrument cluster and centre display,
 * console and selector, floor; seat belts with their retractors and pretensioners, airbags
 * (folded in their modules, and their deployed shapes for the safety lesson), crash sensors
 * and the airbag control module, head restraints. And the body's load-carrying structure (the
 * unibody's rails, pillars, sills, crossmembers and crash boxes), coloured by steel grade in
 * the structure lesson.
 */
import { BufferGeometry, Group, Object3D, Vector3 } from 'three';
import { BODY } from '../../spec/vehicle';
import { alongAxis, at, extrude, lathe, merge, rbox, rod, torus, tube } from '../geo/shapes';
import type { PartNode, Rig } from './rig';

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

export interface CabinParts {
  airbags: { node: PartNode; kind: 'driver' | 'passenger' | 'curtain' | 'side'; origin: Vector3 }[];
  belts: PartNode[];
  seats: PartNode[];
  startButton: PartNode;
  structure: Record<'mild' | 'high' | 'ultra' | 'crash', PartNode>;
  root: Group;
}

/** A side profile (x, y) extruded across z, centred on z (soft edges from a small bevel). */
function slab(profile: [number, number][], depth: number, z: number, bevel = 0.012): BufferGeometry {
  const g = extrude(profile, depth, { bevel, curveSegments: 6 });
  g.translate(0, 0, z);
  return g;
}

/** A profile in a seat back's frame (u forward, v up), reclined about the hinge (hx, hy). */
function recline(pts: [number, number][], a: number, hx: number, hy: number): [number, number][] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return pts.map(([u, v]) => [hx + u * c - v * s, hy + u * s + v * c]);
}

const BACK: [number, number][] = [[-0.06, 0.0], [0.05, 0.02], [0.075, 0.16], [0.05, 0.34], [0.045, 0.52], [0.015, 0.6], [-0.045, 0.6], [-0.07, 0.32], [-0.07, 0.05]];
const BACK_BOLSTER: [number, number][] = [[-0.07, 0.0], [0.1, 0.02], [0.115, 0.2], [0.085, 0.42], [0.055, 0.54], [-0.06, 0.55], [-0.08, 0.3]];
const RECLINE = 0.3;

/** A front seat: cushion and backrest, each with side bolsters, on its rails. */
function seat(x: number, z: number, w = 0.52): BufferGeometry[] {
  const g: BufferGeometry[] = [];
  const cushion: [number, number][] = [[x - 0.24, 0.32], [x + 0.22, 0.32], [x + 0.27, 0.36], [x + 0.27, 0.405], [x + 0.22, 0.44], [x - 0.05, 0.425], [x - 0.22, 0.405], [x - 0.25, 0.37]];
  const cBolster: [number, number][] = [[x - 0.24, 0.32], [x + 0.2, 0.32], [x + 0.26, 0.37], [x + 0.22, 0.47], [x - 0.1, 0.485], [x - 0.24, 0.455]];
  g.push(slab(cushion, w - 0.15, z));
  for (const s of [-1, 1]) g.push(slab(cBolster, 0.08, z + s * (w / 2 - 0.04)));
  const hx = x - 0.235;
  const hy = 0.4;
  g.push(slab(recline(BACK, RECLINE, hx, hy), w - 0.16, z));
  for (const s of [-1, 1]) g.push(slab(recline(BACK_BOLSTER, RECLINE, hx, hy), 0.085, z + s * (w / 2 - 0.042)));
  return g;
}

/** The head restraint above a seat back (and its two posts). */
function headRestraint(x: number, z: number): BufferGeometry[] {
  const hx = x - 0.235;
  const pad: [number, number][] = [[-0.045, 0.0], [0.045, 0.012], [0.06, 0.1], [0.035, 0.165], [-0.04, 0.16], [-0.06, 0.07]];
  const g = [slab(recline(pad.map(([u, v]) => [u, v + 0.66]), RECLINE, hx, 0.4), 0.25, z, 0.02)];
  for (const s of [-1, 1]) {
    const [p0, p1] = recline([[-0.005, 0.58], [-0.005, 0.68]], RECLINE, hx, 0.4);
    g.push(rod(V(p0[0], p0[1], z + s * 0.07), V(p1[0], p1[1], z + s * 0.07), 0.006, 6));
  }
  return g;
}

export function buildCabin(rig: Rig, parent: Object3D): CabinParts {
  const root = new Group();
  root.name = 'cabin-root';
  parent.add(root);
  const CB = 'cabin';
  const seats: PartNode[] = [];
  // front seats (driver on the left) and the rear bench
  const rails = (x: number, z: number) => [-1, 1].map((s) => rbox(0.46, 0.025, 0.035, 0.006, x, 0.285, z + s * 0.17));
  seats.push(rig.part(root, 'seat-driver', 'seat', CB, [['leather', merge(seat(-0.02, -0.37))], ['steel', merge(rails(-0.02, -0.37)), '#2c2f34']]));
  seats.push(rig.part(root, 'seat-passenger', 'seat', CB, [['leather', merge(seat(-0.02, 0.37))], ['steel', merge(rails(-0.02, 0.37)), '#2c2f34']]));
  // the rear bench: two contoured places and a flatter middle
  const bench: [number, number][] = [[-1.16, 0.3], [-0.68, 0.3], [-0.64, 0.35], [-0.66, 0.41], [-0.72, 0.43], [-1.12, 0.41], [-1.17, 0.37]];
  const rearBack: [number, number][] = recline(BACK, 0.36, -1.12, 0.4);
  seats.push(rig.part(root, 'seat-rear', 'seat', CB, [['leather', merge([slab(bench, 1.34, 0), slab(rearBack, 1.3, 0), ...[-1, 1].map((s) => slab(recline(BACK_BOLSTER, 0.36, -1.12, 0.4), 0.07, s * 0.62))])]]));
  // head restraints (separate: a safety part)
  const hr: BufferGeometry[] = [];
  for (const z of [-0.37, 0.37]) hr.push(...headRestraint(-0.02, z));
  for (const z of [-0.4, 0.4]) {
    const pad: [number, number][] = [[-0.04, 0.6], [0.04, 0.61], [0.05, 0.7], [-0.04, 0.72], [-0.05, 0.65]];
    hr.push(slab(recline(pad, 0.36, -1.12, 0.4), 0.24, z, 0.018));
  }
  rig.part(root, 'head-restraints', 'head-restraint', 'safety', [['leather', merge(hr)]]);
  // floor, carpet, tunnel console
  rig.part(root, 'cabin-floor', 'cabin-floor', CB, [['fabric', merge([rbox(2.2, 0.03, 1.5, 0.01, -0.35, 0.26, 0), rbox(1.6, 0.18, 0.3, 0.06, -0.1, 0.33, 0)])]]);
  rig.part(root, 'centre-console', 'centre-console', CB, [['trim', merge([rbox(0.7, 0.16, 0.22, 0.04, 0.12, 0.5, 0), rbox(0.3, 0.06, 0.24, 0.03, -0.12, 0.6, 0)])]]);
  rig.part(root, 'gear-selector', 'gear-selector', 'controls', [['polymerGloss', rbox(0.06, 0.06, 0.05, 0.02, 0.26, 0.62, 0)], ['chrome', rbox(0.02, 0.01, 0.06, 0.004, 0.26, 0.655, 0)]]);
  // dashboard: a soft upper pad across the car (one side profile, extruded), the instrument
  // binnacle over the cluster, the centre stack down to the console
  const dashProfile: [number, number][] = [[0.94, 0.9], [0.9, 0.945], [0.7, 0.96], [0.62, 0.95], [0.575, 0.925], [0.553, 0.88], [0.552, 0.8], [0.575, 0.73], [0.64, 0.665], [0.625, 0.6], [0.7, 0.53], [0.92, 0.52], [0.96, 0.72]];
  const binnacle: [number, number][] = [[0.68, 0.955], [0.62, 1.02], [0.54, 1.025], [0.515, 1.005], [0.545, 0.975], [0.6, 0.95]];
  rig.part(root, 'dashboard', 'dashboard', CB, [
    ['trim', merge([slab(dashProfile, 1.46, 0, 0.012), slab(binnacle, 0.34, -0.37, 0.012)]), '#1b1d21'],
    ['trim', merge([rbox(0.08, 0.3, 0.26, 0.02, 0.6, 0.66, 0), rbox(0.02, 0.06, 0.5, 0.008, 0.56, 0.76, 0.42)]), '#2a2d32'],
    ['chrome', merge([rbox(0.004, 0.006, 1.2, 0.002, 0.54, 0.805, 0.08)])],
  ]);
  rig.part(root, 'instrument-cluster', 'instrument-cluster', 'control', [['screen', rbox(0.01, 0.09, 0.28, 0.004, 0.556, 0.93, -0.37)]]);
  rig.part(root, 'centre-display', 'centre-display', 'control', [['screen', rbox(0.012, 0.15, 0.27, 0.006, 0.6, 1.02, 0.0)], ['polymer', rbox(0.03, 0.06, 0.06, 0.008, 0.62, 0.95, 0)]]);
  rig.part(root, 'vents', 'air-vent', 'hvac', [['polymer', merge([-0.6, -0.12, 0.12, 0.6].map((z) => rbox(0.012, 0.045, 0.12, 0.008, 0.542, 0.85, z)))]]);
  // the start button, on the dash to the left of the steering column, facing the driver: a
  // chrome bezel, a cap that moves in when pressed, and a power symbol that lights with the
  // ignition
  const btnAt = V(0.54, 0.86, -0.62);
  const bezel = alongAxis(lathe([[0.012, 0], [0.024, 0], [0.025, 0.006], [0.02, 0.009], [0.012, 0.009]], 'y', 32), 'x');
  bezel.rotateY(Math.PI);
  rig.part(root, 'start-bezel', 'start-button', 'controls', [['chrome', at(bezel, btnAt.x + 0.004, btnAt.y, btnAt.z)]]);
  const cap = alongAxis(lathe([[0, 0], [0.0175, 0], [0.0175, 0.009], [0.015, 0.012], [0, 0.0125]], 'y', 32), 'x');
  cap.rotateY(Math.PI);
  const ring = torus(0.0075, 0.0011, Math.PI * 1.6, 24, 6);
  ring.rotateZ(Math.PI / 2 + Math.PI * 0.2);
  ring.rotateY(Math.PI / 2);
  const bar = rbox(0.0015, 0.008, 0.0022, 0, 0, 0.004, 0);
  const symbol = merge([ring, bar]);
  symbol.translate(-0.0128, 0, 0);
  const startButton = rig.part(root, 'start-button', 'start-button', 'controls', [['polymerGloss', cap], ['led', symbol]], { pivot: btnAt.clone(), local: true });

  // door trims (inside each door, so the door's inner face reads when it opens)
  rig.part(root, 'door-trims', 'door-trim', CB, [['trim', merge([-1, 1].flatMap((s) => [rbox(0.95, 0.5, 0.04, 0.03, 0.45, 0.72, s * 0.79), rbox(0.8, 0.5, 0.04, 0.03, -0.62, 0.72, s * 0.79)])), '#24262a']]);

  // ───────────────────────── safety ─────────────────────────
  const S = 'safety';
  const airbags: CabinParts['airbags'] = [];
  const driverOrigin = V(0.42, 0.96, -0.37);
  // deployed shapes, scaled from zero by the mechanism (a slow, restrained visualisation)
  const db = at(lathe([[0, -0.1], [0.2, -0.08], [0.27, 0.0], [0.22, 0.12], [0.0, 0.16]], 'y', 32), 0, 0, 0);
  db.rotateZ(Math.PI / 2 + 0.42); // the bag inflates along the column toward the driver
  airbags.push({ node: rig.part(root, 'airbag-driver', 'front-airbag', S, [['airbag', db]], { pivot: driverOrigin.clone(), local: true }), kind: 'driver', origin: driverOrigin });
  const passOrigin = V(0.66, 0.9, 0.37);
  const pb = rbox(0.42, 0.38, 0.5, 0.17, 0, 0, 0);
  pb.translate(-0.22, 0.04, 0);
  airbags.push({ node: rig.part(root, 'airbag-passenger', 'front-airbag', S, [['airbag', pb]], { pivot: passOrigin.clone(), local: true }), kind: 'passenger', origin: passOrigin });
  for (const s of [-1, 1]) {
    const o = V(-0.45, 1.33, s * 0.74);
    const cg = rbox(1.6, 0.4, 0.06, 0.03, 0, -0.2, 0);
    airbags.push({ node: rig.part(root, `airbag-curtain-${s < 0 ? 'left' : 'right'}`, 'curtain-airbag', S, [['airbag', cg]], { pivot: o.clone(), local: true }), kind: 'curtain', origin: o });
    const so = V(-0.18, 0.72, s * 0.6);
    const sg = rbox(0.28, 0.32, 0.1, 0.05, 0.08, 0.05, 0);
    airbags.push({ node: rig.part(root, `airbag-side-${s < 0 ? 'left' : 'right'}`, 'side-airbag', S, [['airbag', sg]], { pivot: so.clone(), local: true }), kind: 'side', origin: so });
  }
  // folded modules (always present): steering-wheel hub, dash top, roof rails, seat sides
  rig.part(root, 'airbag-modules', 'front-airbag', S, [['polymer', merge([rbox(0.12, 0.05, 0.3, 0.02, 0.7, 0.96, 0.37), ...[-1, 1].map((s) => rbox(1.3, 0.04, 0.03, 0.01, -0.45, 1.33, s * 0.74))])]]);
  // seat belts: webbing from the B-pillar retractor over the shoulder to the buckle
  const belts: PartNode[] = [];
  for (const s of [-1, 1]) {
    const web = [V(-0.2, 1.22, s * 0.7), V(-0.15, 1.02, s * 0.55), V(0.02, 0.72, s * 0.32), V(0.02, 0.52, s * 0.12)];
    const lap = [V(0.02, 0.52, s * 0.12), V(0.08, 0.5, s * 0.4), V(-0.02, 0.42, s * 0.63)];
    belts.push(rig.part(root, `seat-belt-${s < 0 ? 'driver' : 'passenger'}`, 'seat-belt', S, [['belt', merge([tube(web, 0.012, { radial: 4 }), tube(lap, 0.012, { radial: 4 })])]]));
  }
  rig.part(root, 'belt-retractors', 'belt-pretensioner', S, [['steel', merge([-1, 1].map((s) => rbox(0.06, 0.1, 0.05, 0.01, -0.2, 0.52, s * 0.72))), '#3a3d43']]);
  rig.part(root, 'airbag-control-module', 'airbag-control-module', 'control', [['castAl', rbox(0.12, 0.04, 0.1, 0.008, 0.2, 0.28, 0.0)]]);
  rig.part(root, 'crash-sensors', 'impact-sensor', S, [['polymerGloss', merge([V(2.05, 0.6, -0.5), V(2.05, 0.6, 0.5), V(-0.15, 0.9, -0.86), V(-0.15, 0.9, 0.86)].map((p) => rbox(0.04, 0.04, 0.03, 0.008, p.x, p.y, p.z)))]]);

  // ───────────────────────── structure (unibody) ─────────────────────────
  const beam = (pts: Vector3[], r: number) => tube(pts, r, { radial: 4, segments: Math.max(8, pts.length * 6), tension: 0.1 });
  const mild: BufferGeometry[] = [];
  const high: BufferGeometry[] = [];
  const ultra: BufferGeometry[] = [];
  const crash: BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    // front rails: from the crash boxes back under the floor
    high.push(beam([V(2.0, 0.45, s * 0.46), V(1.4, 0.44, s * 0.46), V(1.0, 0.36, s * 0.42), V(0.7, 0.2, s * 0.4), V(-0.4, 0.2, s * 0.42)], 0.035));
    crash.push(rod(V(2.0, 0.45, s * 0.46), V(2.2, 0.45, s * 0.48), 0.045, 4));
    // upper load path: shock tower to A-pillar
    high.push(beam([V(1.9, 0.68, s * 0.7), V(1.4, 0.78, s * 0.68), V(0.95, 0.84, s * 0.72)], 0.03));
    // A-pillar, roof rail, C-pillar
    ultra.push(beam([V(0.92, 0.92, s * 0.74), V(0.55, 1.12, s * 0.7), V(0.15, 1.33, s * 0.62), V(-0.6, 1.37, s * 0.6), V(-1.05, 1.33, s * 0.6), V(-1.6, 1.04, s * 0.66)], 0.026));
    // B-pillar
    ultra.push(beam([V(-0.16, 0.22, s * 0.8), V(-0.17, 0.7, s * 0.8), V(-0.2, 1.32, s * 0.62)], 0.034));
    // sill (rocker)
    ultra.push(beam([V(1.05, 0.23, s * 0.79), V(-1.15, 0.23, s * 0.79)], 0.042));
    // rear rails
    mild.push(beam([V(-1.1, 0.24, s * 0.5), V(-1.7, 0.42, s * 0.5), V(-2.35, 0.48, s * 0.5)], 0.03));
    crash.push(rod(V(-2.35, 0.48, s * 0.5), V(-2.45, 0.48, s * 0.5), 0.04, 4));
    // door intrusion beams
    ultra.push(rod(V(0.8, 0.6, s * 0.8), V(-0.1, 0.55, s * 0.8), 0.016, 6), rod(V(-0.25, 0.58, s * 0.8), V(-1.05, 0.58, s * 0.8), 0.016, 6));
  }
  // bumper beams, crossmembers, firewall top, roof bows
  high.push(beam([V(2.2, 0.45, -0.62), V(2.25, 0.45, 0), V(2.2, 0.45, 0.62)], 0.035));
  high.push(beam([V(-2.45, 0.48, -0.6), V(-2.48, 0.48, 0), V(-2.45, 0.48, 0.6)], 0.035));
  for (const x of [0.75, -0.2, -0.75]) mild.push(rod(V(x, 0.22, -0.84), V(x, 0.22, 0.84), 0.025, 4));
  ultra.push(rod(V(0.93, 0.9, -0.74), V(0.93, 0.9, 0.74), 0.03, 4));
  mild.push(rod(V(0.95, 0.4, -0.7), V(0.95, 0.4, 0.7), 0.02, 4));
  for (const x of [0.15, -0.2, -1.05]) mild.push(rod(V(x, 1.36, -0.6), V(x, 1.36, 0.6), 0.018, 4));
  high.push(beam([V(0.0, 0.25, 0.0), V(0.9, 0.42, 0.0)], 0.06));
  const structure = {
    mild: rig.part(root, 'structure-mild', 'body-structure', 'structure', [['structure', merge(mild)]]),
    high: rig.part(root, 'structure-high', 'body-structure', 'structure', [['structureHi', merge(high)]]),
    ultra: rig.part(root, 'structure-ultra', 'safety-cell', 'structure', [['structureUhss', merge(ultra)]]),
    crash: rig.part(root, 'structure-crash', 'crumple-zone', 'structure', [['structure', merge(crash), '#c0c6cf']]),
  };
  void BODY;
  return { airbags, belts, seats, structure, root, startButton };
}
