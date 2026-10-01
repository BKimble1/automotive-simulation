/**
 * The whole car, assembled: one scene graph for the entire visit (no scene swaps, no remounts).
 *
 *   car                 placed on the studio floor (the rolling road moves under it)
 *     sprung            the body and everything mounted to it; heave, pitch and roll
 *       body panels     each on its hinge (hood, doors, trunk) or mount point
 *       engine, transmission, driveline (differential), systems, cabin, structure
 *       subframes, steering rack and column, anti-roll bars
 *     corners ×4        unsprung: upright, hub, brakes, wheel and tyre (travel, steer, spin)
 *     links             arms, tie rods, dampers, springs, half shafts (posed between the two)
 *
 * Explode channels (driven by the scene channels; each part may answer several):
 *   open        the hood, doors and trunk open on their hinges
 *   explode     the whole car comes apart in order: body up, panels out, powertrain, wheels
 *   engine      the engine taken apart (head and covers up, sump down, front drive forward)
 *   converter   the torque converter separates into cover/impeller, stator, turbine
 *   brake       a front corner's caliper and pads come off the disc
 */
import { Group, Quaternion, Vector3, type BufferGeometry } from 'three';
import { buildBody, type BodyPanel } from './body';
import { buildEngine, type EngineParts } from './engineGeo';
import { buildDrivetrain, type DrivetrainParts } from './drivetrainGeo';
import { buildChassis, type ChassisParts } from './chassisGeo';
import { buildSystems, type SystemsParts } from './systemsGeo';
import { buildCabin, type CabinParts } from './cabinGeo';
import { Rig, type PartNode } from './rig';

export interface Car {
  root: Group;
  sprung: Group;
  rig: Rig;
  body: { root: Group; panels: BodyPanel[]; nodes: Record<string, PartNode> };
  engine: EngineParts;
  drivetrain: DrivetrainParts;
  chassis: ChassisParts;
  systems: SystemsParts;
  cabin: CabinParts;
}

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const Q = (ax: Vector3, a: number) => new Quaternion().setFromAxisAngle(ax.normalize(), a);

/** Panel hinges and how each panel opens and explodes. */
const PANEL_SPEC: Record<string, { hinge: Vector3; open?: Quaternion; explode: Vector3; explodeQ?: Quaternion; delay: number; comp: string }> = {
  shell: { hinge: V(0, 0, 0), explode: V(0, 1.15, 0), delay: 0, comp: 'body-shell' },
  hood: { hinge: V(0.97, 0.955, 0), open: Q(V(0, 0, 1), 0.85), explode: V(0.35, 1.75, 0), explodeQ: Q(V(0, 0, 1), 0.12), delay: 0.12, comp: 'hood' },
  bumperFront: { hinge: V(2.1, 0.5, 0), explode: V(0.75, 1.15, 0), delay: 0.2, comp: 'front-bumper' },
  fenderL: { hinge: V(1.5, 0.6, -0.85), explode: V(0.2, 1.15, -0.55), delay: 0.24, comp: 'front-fender' },
  fenderR: { hinge: V(1.5, 0.6, 0.85), explode: V(0.2, 1.15, 0.55), delay: 0.24, comp: 'front-fender' },
  doorFL: { hinge: V(0.97, 0.6, -0.86), open: Q(V(0, 1, 0), -1.1), explode: V(0.0, 1.15, -0.75), delay: 0.16, comp: 'door' },
  doorFR: { hinge: V(0.97, 0.6, 0.86), open: Q(V(0, 1, 0), 1.1), explode: V(0.0, 1.15, 0.75), delay: 0.16, comp: 'door' },
  doorRL: { hinge: V(-0.14, 0.6, -0.86), open: Q(V(0, 1, 0), -1.05), explode: V(-0.1, 1.15, -0.75), delay: 0.2, comp: 'door' },
  doorRR: { hinge: V(-0.14, 0.6, 0.86), open: Q(V(0, 1, 0), 1.05), explode: V(-0.1, 1.15, 0.75), delay: 0.2, comp: 'door' },
  trunk: { hinge: V(-1.77, 1.04, 0), open: Q(V(0, 0, 1), -1.05), explode: V(-0.35, 1.7, 0), explodeQ: Q(V(0, 0, 1), -0.1), delay: 0.12, comp: 'trunk-lid' },
  bumperRear: { hinge: V(-2.3, 0.5, 0), explode: V(-0.75, 1.15, 0), delay: 0.2, comp: 'rear-bumper' },
};

/**
 * Which assemblies each section plane cuts: the engine's (the cylinder-1 cutaway), the
 * transmission's (through its axis), the differential's (behind its centre).
 */
const CUT_GROUPS: Record<string, string> = {
  engine: 'engine',
  lubrication: 'engine',
  ignition: 'engine',
  injection: 'engine',
  transmission: 'transmission',
  driveline: 'diff',
};

/**
 * Parts drawn whole inside a cutaway, as on a sectioned display engine: the plane cuts the
 * housings (block, head, covers, cases, carrier), and the moving parts inside stay whole.
 */
const WHOLE = /^(piston-|rod-|valve-|spark-plugs|fuel-injectors|ignition-coils|gearset-\d+-(sun|planet)|input-shaft|output-shaft|ring-gear|pinion|spider-gear|side-gear|half-shaft|driveshaft|center-bearing|diff-mounts)/;

export function buildCar(bodyGeo: BufferGeometry): Car {
  const rig = new Rig();
  rig.clipOf = (group, part) => (part && WHOLE.test(part) ? null : (CUT_GROUPS[group] ?? (group.startsWith('element-') ? 'transmission' : null)));
  const root = new Group();
  root.name = 'car';
  const sprung = new Group();
  sprung.name = 'sprung';
  root.add(sprung);
  rig.adopt(sprung, 'sprung', 'body-shell', 'body', [], []);

  // ── body panels on their hinges
  const body = buildBody(bodyGeo);
  const nodes: Record<string, PartNode> = {};
  const bodyRoot = new Group();
  bodyRoot.name = 'body-root';
  sprung.add(bodyRoot);
  for (const p of body.panels) {
    const spec = PANEL_SPEC[p.name];
    const pivot = new Group();
    pivot.name = `panel-${p.name}`;
    pivot.position.copy(spec.hinge);
    p.group.position.copy(spec.hinge).negate();
    pivot.add(p.group);
    bodyRoot.add(pivot);
    const node = rig.adopt(pivot, `panel-${p.name}`, spec.comp, 'body', [p.paint, p.glass], []);
    if (spec.open) rig.explode(node, 'open', new Vector3(), { q: spec.open });
    rig.explode(node, 'explode', spec.explode, { q: spec.explodeQ, delay: spec.delay });
    nodes[p.name] = node;
  }

  // ── powertrain, systems, cabin (all body-mounted)
  const engine = buildEngine(rig, sprung);
  const drivetrain = buildDrivetrain(rig, sprung);
  const systems = buildSystems(rig, sprung);
  const cabin = buildCabin(rig, sprung);
  const chassis = buildChassis(rig, root, sprung);

  // ── the full exploded view: in order, with the body lifting first and the powertrain last
  const ex = (name: string, off: Vector3, delay: number) => {
    const n = rig.parts.get(name);
    if (n) rig.explode(n, 'explode', off, { delay });
  };
  for (const n of rig.parts.values()) {
    if (n.assembly === 'cabin' || n.assembly === 'safety' || n.assembly === 'hvac' || n.name === 'head-restraints') {
      // the interior lifts with the body (it is fixed to the floor of the body)
      if (!n.explodes.some((e) => e.group === 'explode')) rig.explode(n, 'explode', V(0, 1.15, 0), { delay: 0 });
    }
  }
  for (const n of ['wiring-harness', 'battery-cables', 'fuse-box', 'bcm', 'wipers', 'instrument-cluster', 'centre-display', 'obd-port', 'airbag-control-module', 'structure-mild', 'structure-high', 'structure-ultra', 'structure-crash', 'brake-pedal', 'pedal-box', 'throttle-pedal', 'steering-column', 'steering-wheel', 'gear-selector'])
    ex(n, V(0, 1.15, 0), 0);
  // powertrain: engine forward and up, transmission back
  for (const n of rig.parts.values()) {
    if (n.assembly === 'engine' || n.assembly === 'intake' || n.assembly === 'lubrication' || n.assembly === 'ignition' || n.assembly === 'injection') ex(n.name, V(0.55, 0.32, 0), 0.45);
    if (n.assembly === 'transmission' && n.name !== 'flexplate') ex(n.name, V(-0.2, 0.12, 0), 0.5);
  }
  for (const n of ['alternator', 'starter', 'starter-pinion', 'accessory-belt', 'pulley-alternator', 'pulley-tensioner', 'pulley-idler', 'pulley-waterpump', 'pulley-compressor', 'water-pump', 'ac-compressor', 'thermostat-housing', 'coolant-temp-sensor', 'crank-sensor', 'cam-sensor', 'knock-sensor', 'exhaust-manifold', 'flexplate']) ex(n, V(0.55, 0.32, 0), 0.45);
  for (const n of ['radiator', 'condenser', 'fan-shroud', 'cooling-fan-left', 'cooling-fan-right', 'fan-motor-left', 'fan-motor-right', 'radiator-hoses', 'expansion-tank']) ex(n, V(0.85, 0.1, 0), 0.35);
  for (const n of ['catalytic-converter', 'heat-shield-cat', 'exhaust-pipes', 'resonator', 'muffler', 'tailpipes', 'exhaust-hangers', 'oxygen-sensors']) ex(n, V(0, -0.0, 0.0), 0);
  ex('fuel-tank', V(0, 0.0, 0), 0);
  ex('battery', V(0.1, 1.45, 0.25), 0.3);
  ex('ecm', V(0.1, 1.45, 0.25), 0.3);
  ex('abs-modulator', V(0.2, 1.3, 0.35), 0.3);
  ex('brake-booster', V(0.1, 1.3, -0.2), 0.3);
  ex('master-cylinder', V(0.1, 1.3, -0.2), 0.3);
  ex('brake-reservoir', V(0.1, 1.3, -0.2), 0.3);
  // wheels and brakes out to the sides
  chassis.corners.forEach((c, i) => {
    const s = i % 2 === 0 ? -1 : 1;
    for (const n of rig.parts.values()) {
      if (n.object === c.group) rig.explode(n, 'explode', V(0, 0, s * 0.55), { delay: 0.55 });
    }
  });
  for (const l of chassis.links) rig.explode(l.node, 'explode', V(0, 0, (l.b.z < 0 ? -1 : 1) * 0.28), { delay: 0.55 });

  // ── the engine taken apart
  const eng = (name: string, off: Vector3, delay: number) => {
    const n = rig.parts.get(name);
    if (n) rig.explode(n, 'engine', off, { delay });
  };
  eng('cam-cover', V(0, 0.42, 0), 0);
  eng('ignition-coils', V(0, 0.55, 0), 0);
  eng('cylinder-head', V(0, 0.26, 0), 0.12);
  eng('head-gasket', V(0, 0.13, 0), 0.12);
  eng('camshaft-intake', V(0, 0.36, 0), 0.12);
  eng('camshaft-exhaust', V(0, 0.36, 0), 0.12);
  eng('vvt-solenoid', V(0, 0.36, 0), 0.12);
  eng('spark-plugs', V(0, 0.29, 0), 0.12);
  eng('fuel-injectors', V(0, 0.26, -0.06), 0.12);
  eng('fuel-rail', V(0, 0.26, -0.1), 0.12);
  eng('hp-fuel-pump', V(0, 0.36, 0), 0.12);
  for (const v of engine.valves) {
    rig.explode(v.node, 'engine', V(0, 0.26, 0), { delay: 0.12 });
    rig.explode(v.spring, 'engine', V(0, 0.26, 0), { delay: 0.12 });
  }
  eng('intake-manifold', V(0, 0.08, -0.32), 0.05);
  eng('throttle-body', V(0, 0.08, -0.32), 0.05);
  eng('throttle-plate', V(0, 0.08, -0.32), 0.05);
  eng('map-sensor', V(0, 0.08, -0.32), 0.05);
  eng('exhaust-manifold', V(0, 0.0, 0.3), 0.05);
  eng('oil-pan', V(0, -0.24, 0), 0.2);
  eng('oil-pump', V(0, -0.16, 0), 0.2);
  eng('oil-pickup', V(0, -0.2, 0), 0.2);
  eng('timing-cover', V(0.22, 0, 0), 0.05);
  eng('timing-chain', V(0.12, 0.0, 0), 0.25);
  eng('chain-guides', V(0.12, 0.0, 0), 0.25);
  eng('chain-tensioner', V(0.12, 0.0, 0), 0.25);
  eng('harmonic-balancer', V(0.3, 0, 0), 0.1);
  for (const n of ['accessory-belt', 'pulley-alternator', 'pulley-tensioner', 'pulley-idler', 'pulley-waterpump', 'pulley-compressor']) eng(n, V(0.36, 0, 0), 0.0);
  for (let i = 0; i < 4; i++) {
    eng(`piston-${i + 1}`, V(0, 0.16, 0), 0.32);
    eng(`rod-${i + 1}`, V(0, 0.16, 0), 0.32);
  }
  eng('crankshaft', V(0, -0.14, 0), 0.4);
  eng('engine-block', V(0, 0, 0), 0);

  // ── the torque converter separated along its axis
  const cv = (name: string, off: Vector3) => {
    const n = rig.parts.get(name);
    if (n) rig.explode(n, 'converter', off, {});
  };
  cv('converter-impeller', V(-0.06, 0, 0));
  cv('converter-turbine', V(0.07, 0, 0));
  cv('lockup-clutch', V(0.11, 0, 0));
  cv('converter-stator', V(0.0, 0, 0));

  // ── a front corner's brake taken apart (the left front)
  const bk = (name: string, off: Vector3) => {
    const n = rig.parts.get(name);
    if (n) rig.explode(n, 'brake', off, {});
  };
  bk('caliper-FL', V(-0.0, 0.0, -0.16));
  bk('brake-pad-FL-out', V(0, 0, -0.1));
  bk('brake-pad-FL-in', V(0, 0, 0.06));

  return { root, sprung, rig, body: { root: bodyRoot, panels: body.panels, nodes }, engine, drivetrain, chassis, systems, cabin };
}
