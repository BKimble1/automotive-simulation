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
import { at, lathe, merge, rbox, rod, tube } from '../geo/shapes';
import type { PartNode, Rig } from './rig';

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

export interface CabinParts {
  airbags: { node: PartNode; kind: 'driver' | 'passenger' | 'curtain' | 'side'; origin: Vector3 }[];
  belts: PartNode[];
  seats: PartNode[];
  structure: Record<'mild' | 'high' | 'ultra' | 'crash', PartNode>;
  root: Group;
}

function seat(x: number, z: number, w = 0.52): BufferGeometry[] {
  const g: BufferGeometry[] = [];
  // cushion, bolsters, backrest (reclined), head restraint posts
  g.push(rbox(0.5, 0.1, w, 0.04, x, 0.36, z));
  for (const s of [-1, 1]) g.push(rbox(0.46, 0.07, 0.07, 0.03, x, 0.42, z + s * (w / 2 - 0.035)));
  const back = rbox(0.12, 0.62, w, 0.05, 0, 0.31, 0);
  back.rotateZ(0.32);
  back.translate(x - 0.27, 0.36, z);
  g.push(back);
  for (const s of [-1, 1]) {
    const b = rbox(0.1, 0.5, 0.07, 0.03, 0, 0.27, 0);
    b.rotateZ(0.32);
    b.translate(x - 0.25, 0.38, z + s * (w / 2 - 0.035));
    g.push(b);
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
  seats.push(rig.part(root, 'seat-driver', 'seat', CB, [['leather', merge(seat(-0.02, -0.37))]]));
  seats.push(rig.part(root, 'seat-passenger', 'seat', CB, [['leather', merge(seat(-0.02, 0.37))]]));
  seats.push(rig.part(root, 'seat-rear', 'seat', CB, [['leather', merge([...seat(-0.92, -0.38, 0.5), ...seat(-0.92, 0.38, 0.5), rbox(0.4, 0.08, 0.3, 0.03, -0.92, 0.36, 0)])]]));
  // head restraints (separate: a safety part)
  const hr: BufferGeometry[] = [];
  for (const [x, z] of [
    [-0.02, -0.37],
    [-0.02, 0.37],
    [-0.92, -0.38],
    [-0.92, 0.38],
  ])
    hr.push(rbox(0.09, 0.15, 0.26, 0.04, x - 0.47, 1.12, z));
  rig.part(root, 'head-restraints', 'head-restraint', 'safety', [['leather', merge(hr)]]);
  // floor, carpet, tunnel console
  rig.part(root, 'cabin-floor', 'cabin-floor', CB, [['fabric', merge([rbox(2.2, 0.03, 1.5, 0.01, -0.35, 0.26, 0), rbox(1.6, 0.18, 0.3, 0.06, -0.1, 0.33, 0)])]]);
  rig.part(root, 'centre-console', 'centre-console', CB, [['trim', merge([rbox(0.7, 0.16, 0.22, 0.04, 0.12, 0.5, 0), rbox(0.3, 0.06, 0.24, 0.03, -0.12, 0.6, 0)])]]);
  rig.part(root, 'gear-selector', 'gear-selector', 'controls', [['polymerGloss', rbox(0.06, 0.06, 0.05, 0.02, 0.26, 0.62, 0)], ['chrome', rbox(0.02, 0.01, 0.06, 0.004, 0.26, 0.655, 0)]]);
  // dashboard: a long upper pad, the instrument hood, the centre stack
  const dash: BufferGeometry[] = [];
  dash.push(rbox(0.32, 0.2, 1.5, 0.06, 0.7, 0.86, 0));
  dash.push(rbox(0.2, 0.1, 1.46, 0.04, 0.58, 0.72, 0));
  dash.push(rbox(0.16, 0.08, 0.32, 0.03, 0.6, 0.98, -0.37));
  rig.part(root, 'dashboard', 'dashboard', CB, [['trim', merge(dash), '#1b1d21']]);
  rig.part(root, 'instrument-cluster', 'instrument-cluster', 'control', [['screen', rbox(0.01, 0.1, 0.28, 0.004, 0.535, 0.94, -0.37)]]);
  rig.part(root, 'centre-display', 'centre-display', 'control', [['screen', rbox(0.012, 0.15, 0.27, 0.006, 0.6, 1.0, 0.0)]]);
  rig.part(root, 'vents', 'air-vent', 'hvac', [['polymer', merge([-0.6, -0.12, 0.12, 0.6].map((z) => rbox(0.012, 0.04, 0.11, 0.008, 0.535, 0.84, z)))]]);
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
  return { airbags, belts, seats, structure, root };
}
