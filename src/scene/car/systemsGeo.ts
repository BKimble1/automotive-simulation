/**
 * The systems around the powertrain: cooling (radiator, condenser, electric fans, hoses,
 * expansion tank, heater core), exhaust (manifold, oxygen sensors, catalytic converter,
 * resonator, muffler, tailpipes), fuel (tank with its pump, the line to the engine), brake
 * hydraulics (pedal, booster, master cylinder and reservoir, ABS modulator, lines), the 12 V
 * system and its controllers (battery, fuse and relay box, engine and body control modules,
 * the harness trunk, the diagnostic connector, wipers), and the air conditioning.
 *
 * Every path that a lesson draws a flow along (coolant, oil, air, fuel, exhaust, brake fluid,
 * current, network signals) is defined here once, next to the parts it runs through, and
 * returned so the flows (src/scene/viz/flows.ts) follow the geometry exactly.
 */
import { BufferGeometry, Group, Object3D, Vector3 } from 'three';
import { BODY } from '../../spec/vehicle';
import { alongAxis, at, extrude, lathe, merge, rbox, rod, tube } from '../geo/shapes';
import { BELT_X, CRANK_Y, DECK_Y, XC, ACCESSORY } from './engineGeo';
import { DIFF_C, TRANS } from './drivetrainGeo';
import type { Rig } from './rig';

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

export interface FlowPaths {
  /** Each is a list of points (a smooth curve is fitted through them). */
  [id: string]: Vector3[];
}

export interface SystemsParts {
  fans: { node: import('./rig').PartNode; centre: Vector3 }[];
  pedal: import('./rig').PartNode;
  throttlePedal: import('./rig').PartNode;
  flows: FlowPaths;
  /** Network nodes (controllers) by id, for the CAN overview. */
  ecus: Record<string, Vector3>;
  root: Group;
}

export function buildSystems(rig: Rig, parent: Object3D): SystemsParts {
  const root = new Group();
  root.name = 'systems-root';
  parent.add(root);
  const flows: FlowPaths = {};
  const ecus: Record<string, Vector3> = {};

  // ───────────────────────── cooling ─────────────────────────
  const C = 'cooling';
  const radX = 1.98;
  const radY0 = 0.28;
  const radY1 = 0.66;
  const radZ = 0.36;
  {
    const core: BufferGeometry[] = [];
    core.push(rbox(0.032, radY1 - radY0, 2 * radZ, 0.004, radX, (radY0 + radY1) / 2, 0));
    // fins: fine horizontal lines on both faces
    for (let k = 0; k < 28; k++) {
      const y = radY0 + 0.012 + (k * (radY1 - radY0 - 0.024)) / 27;
      core.push(rbox(0.034, 0.002, 2 * radZ - 0.02, 0.0005, radX, y, 0));
    }
    const tanks = [rbox(0.05, radY1 - radY0 + 0.02, 0.05, 0.01, radX, (radY0 + radY1) / 2, -radZ - 0.02), rbox(0.05, radY1 - radY0 + 0.02, 0.05, 0.01, radX, (radY0 + radY1) / 2, radZ + 0.02)];
    rig.part(root, 'radiator', 'radiator', C, [['radiator', merge(core)], ['polymer', merge(tanks)]]);
    // condenser (air conditioning) in front of it
    rig.part(root, 'condenser', 'ac-condenser', 'hvac', [['radiator', rbox(0.018, radY1 - radY0 - 0.04, 2 * radZ - 0.04, 0.003, radX + 0.04, (radY0 + radY1) / 2, 0), '#4a4d53']]);
  }
  const fans: SystemsParts['fans'] = [];
  {
    rig.part(root, 'fan-shroud', 'cooling-fan', C, [['polymer', rbox(0.05, radY1 - radY0, 2 * radZ, 0.02, radX - 0.06, (radY0 + radY1) / 2, 0)]]);
    for (const zc of [-0.18, 0.18]) {
      const c = V(radX - 0.09, (radY0 + radY1) / 2, zc);
      const blades: BufferGeometry[] = [];
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const g = extrude(
          [
            [0.03, -0.012],
            [0.15, -0.03],
            [0.155, 0.02],
            [0.03, 0.014],
          ],
          0.004,
        );
        g.rotateZ(a);
        g.rotateX(0.0);
        blades.push(g);
      }
      const bl = merge(blades);
      bl.rotateY(Math.PI / 2);
      bl.translate(c.x, c.y, c.z);
      const hub = at(alongAxis(lathe([[0, 0], [0.035, 0], [0.035, 0.04], [0, 0.04]], 'y', 24), 'x'), c.x - 0.03, c.y, c.z);
      const node = rig.part(root, `cooling-fan-${zc < 0 ? 'left' : 'right'}`, 'cooling-fan', C, [['polymer', merge([bl, hub])]], { pivot: c.clone() });
      fans.push({ node, centre: c });
      rig.part(root, `fan-motor-${zc < 0 ? 'left' : 'right'}`, 'cooling-fan', C, [['steel', at(alongAxis(lathe([[0, 0], [0.04, 0], [0.04, 0.05], [0, 0.05]], 'y', 20), 'x'), c.x - 0.08, c.y, c.z)]]);
    }
    // hoses: upper (thermostat → radiator top), lower (radiator bottom → water pump)
    const thermo = V(XC[0] + 0.05, DECK_Y + 0.04, -0.175);
    const wp = ACCESSORY.find((p) => p.id === 'waterpump')!;
    const wpIn = V(BELT_X - 0.07, wp.v - 0.04, -wp.u + 0.06);
    const upperHose = [thermo, V(1.7, DECK_Y + 0.07, -0.26), V(1.85, radY1 - 0.04, -0.3), V(radX - 0.02, radY1 - 0.04, -radZ - 0.03)];
    const lowerHose = [V(radX - 0.02, radY0 + 0.05, radZ + 0.03), V(1.85, radY0 + 0.04, 0.25), V(1.72, CRANK_Y + 0.08, 0.12), wpIn];
    rig.part(root, 'radiator-hoses', 'coolant-hose', C, [['hose', merge([tube(upperHose, 0.019, { radial: 12 }), tube(lowerHose, 0.019, { radial: 12 })])]]);
    rig.part(root, 'expansion-tank', 'expansion-tank', C, [['polymer', rbox(0.15, 0.13, 0.11, 0.03, 1.72, 0.72, 0.52), '#d9dad6'], ['fluidCoolant', rbox(0.13, 0.06, 0.09, 0.02, 1.72, 0.69, 0.52)]]);
    const heaterIn = V(0.82, 0.68, -0.14);
    const heaterOut = V(0.82, 0.66, -0.06);
    const heaterHoses = [
      [V(XC[3] - 0.02, DECK_Y + 0.03, -0.12), V(1.0, 0.72, -0.18), V(0.9, 0.7, -0.16), heaterIn],
      [heaterOut, V(0.92, 0.66, -0.04), V(1.06, 0.6, 0.06), V(XC[2], CRANK_Y + 0.12, 0.115)],
    ];
    rig.part(root, 'heater-hoses', 'coolant-hose', C, [['hose', merge(heaterHoses.map((h) => tube(h, 0.011, { radial: 10 })))]]);
    rig.part(root, 'heater-core', 'heater-core', 'hvac', [['radiator', rbox(0.04, 0.16, 0.2, 0.006, 0.78, 0.67, -0.1), '#7a5236']]);
    // coolant circuits (for the flows): the small loop inside the engine while the thermostat is
    // closed, and the big loop through the radiator once it opens
    flows.coolantEngine = [wpIn, V(XC[0] + 0.05, CRANK_Y + 0.12, 0.09), V(XC[1], CRANK_Y + 0.17, 0.09), V(XC[3], CRANK_Y + 0.17, 0.09), V(XC[3], DECK_Y + 0.03, 0.06), V(XC[1], DECK_Y + 0.035, 0.03), V(XC[0], DECK_Y + 0.04, -0.06), thermo];
    flows.coolantBypass = [thermo, V(XC[0] + 0.08, DECK_Y - 0.02, -0.13), V(BELT_X - 0.06, wp.v + 0.02, -0.04), wpIn];
    flows.coolantRadiator = [thermo, ...upperHose.slice(1), V(radX - 0.005, radY1 - 0.06, -0.25), V(radX - 0.005, radY0 + 0.12, 0.0), V(radX - 0.005, radY0 + 0.06, 0.25), ...lowerHose];
    flows.coolantHeater = [...heaterHoses[0], V(0.79, 0.74, -0.12), V(0.79, 0.6, -0.08), ...heaterHoses[1]];
    // the radiator's air: through the grille, the condenser, the radiator and out past the fans
    flows.radiatorAir = [V(2.35, 0.47, 0.0), V(radX + 0.08, 0.47, 0.0), V(radX - 0.12, 0.46, 0.0), V(1.7, 0.36, 0.0), V(1.4, 0.2, 0.0)];
  }

  // ───────────────────────── lubrication paths ─────────────────────────
  {
    const sump = V(XC[0] - 0.04, CRANK_Y - 0.17, 0.0);
    const pump = V(XC[0] + 0.03, CRANK_Y - 0.075, 0.03);
    const filter = V(1.3, CRANK_Y + 0.02, 0.15);
    const gallery = [V(1.5, CRANK_Y + 0.04, 0.1), V(1.15, CRANK_Y + 0.04, 0.1)];
    flows.oilMain = [sump, V(XC[0] - 0.02, CRANK_Y - 0.13, 0.0), pump, V(XC[0] - 0.04, CRANK_Y - 0.03, 0.12), filter, ...gallery];
    flows.oilMains = [V(XC[0] + 0.049, CRANK_Y + 0.04, 0.1), V(XC[0] + 0.049, CRANK_Y + 0.0, 0.035), V(XC[0] + 0.049, CRANK_Y - 0.035, 0.0)];
    flows.oilHead = [V(1.22, CRANK_Y + 0.04, 0.1), V(1.2, DECK_Y - 0.04, 0.1), V(1.2, DECK_Y + 0.06, 0.07), V(1.45, DECK_Y + 0.1, 0.06), V(1.55, DECK_Y + 0.1, 0.0), V(1.55, DECK_Y + 0.1, -0.06), V(1.25, DECK_Y + 0.1, -0.06)];
    flows.oilReturn = [V(1.3, DECK_Y + 0.05, 0.11), V(1.3, CRANK_Y + 0.1, 0.13), V(1.3, CRANK_Y - 0.08, 0.12), V(XC[0] - 0.06, CRANK_Y - 0.15, 0.04)];
  }

  // ───────────────────────── exhaust ─────────────────────────
  {
    const E = 'exhaust';
    const prim: BufferGeometry[] = [];
    const collector = V(XC[3] + 0.02, CRANK_Y + 0.07, 0.24);
    for (let i = 0; i < 4; i++) {
      const xc = XC[i];
      prim.push(tube([V(xc, DECK_Y + 0.053, 0.122), V(xc, DECK_Y + 0.05, 0.17), V(xc - 0.02 * (i - 1.5), CRANK_Y + 0.16, 0.22), collector], 0.017, { radial: 12 }));
    }
    rig.part(root, 'exhaust-manifold', 'exhaust-manifold', E, [['muffler', merge(prim), '#5b5048']]);
    const cat0 = V(XC[3] - 0.05, CRANK_Y - 0.0, 0.24);
    const cat1 = V(0.82, 0.24, 0.2);
    rig.part(root, 'catalytic-converter', 'catalytic-converter', E, [['catalyst', merge([rod(cat0, cat1, 0.052, 20), rod(cat0.clone().add(V(0.03, 0.03, 0)), cat0, 0.035, 14)])]]);
    rig.part(root, 'heat-shield-cat', 'catalytic-converter', E, [['aluminium', rod(cat0.clone().add(V(-0.02, 0.0, 0)), cat1.clone().add(V(0.02, 0, 0)), 0.06, 20, 0.06), '#9fa3aa']]);
    const o2a = V(XC[3] + 0.0, CRANK_Y + 0.05, 0.27);
    const o2b = V(0.78, 0.25, 0.25);
    rig.part(root, 'oxygen-sensors', 'oxygen-sensor', 'control', [['steel', merge([rod(o2a, o2a.clone().add(V(0, 0.05, 0.03)), 0.008, 10), rod(o2b, o2b.clone().add(V(0, 0.05, 0.04)), 0.008, 10)])]]);
    const pipe = [cat1, V(0.5, 0.215, 0.18), V(0.1, 0.205, 0.17)];
    const res0 = V(0.1, 0.205, 0.17);
    const res1 = V(-0.45, 0.205, 0.17);
    const back = [res1, V(-0.75, 0.22, 0.2), V(-1.1, 0.3, 0.25), V(-1.75, 0.33, 0.25), V(-1.92, 0.3, 0.2)];
    rig.part(root, 'exhaust-pipes', 'exhaust-pipe', E, [['muffler', merge([tube(pipe, 0.028, { radial: 12 }), tube(back, 0.028, { radial: 12 })])]]);
    rig.part(root, 'resonator', 'resonator', E, [['muffler', rod(res0, res1, 0.05, 20)]]);
    const mx = -2.06;
    rig.part(root, 'muffler', 'muffler', E, [['muffler', rbox(0.24, 0.16, 1.0, 0.07, mx, 0.3, 0.0)]]);
    const tips: BufferGeometry[] = [];
    for (const s of [-1, 1]) tips.push(rod(V(mx - 0.1, 0.27, s * 0.42), V(BODY.xTail + 0.02, 0.27, s * 0.42), 0.038, 18));
    rig.part(root, 'tailpipes', 'tailpipe', E, [['chrome', merge(tips), '#7d8189']]);
    rig.part(root, 'exhaust-hangers', 'exhaust-pipe', E, [['rubber', merge([V(-0.3, 0.26, 0.17), V(-1.5, 0.37, 0.25), V(-2.0, 0.39, -0.3), V(-2.0, 0.39, 0.3)].map((p) => rod(p, p.clone().add(V(0, 0.06, 0)), 0.01, 8)))]]);
    flows.exhaust = [V(XC[1], DECK_Y + 0.053, 0.13), V(XC[1], CRANK_Y + 0.16, 0.22), collector, cat0, cat1, ...pipe.slice(1), res1, ...back.slice(1), V(mx + 0.1, 0.3, 0.2), V(mx - 0.08, 0.3, 0.42), V(BODY.xTail - 0.25, 0.27, 0.42)];
  }

  // ───────────────────────── fuel ─────────────────────────
  {
    const F = 'fuel';
    const tank: BufferGeometry[] = [];
    for (const s of [-1, 1]) tank.push(rbox(0.42, 0.2, 0.4, 0.06, -1.0, 0.31, s * 0.32));
    tank.push(rbox(0.38, 0.08, 0.3, 0.03, -1.0, 0.41, 0));
    rig.part(root, 'fuel-tank', 'fuel-tank', F, [['polymer', merge(tank), '#26282c']]);
    rig.part(root, 'fuel-pump', 'fuel-pump', F, [['polymerGloss', at(alongAxis(lathe([[0, 0], [0.05, 0], [0.05, 0.03], [0, 0.03]], 'y', 24), 'y'), -1.0, 0.43, -0.32)], ['steel', at(alongAxis(lathe([[0, 0], [0.022, 0], [0.022, 0.16], [0, 0.16]], 'y', 16), 'y'), -1.0, 0.25, -0.32)]]);
    const line = [V(-1.0, 0.46, -0.32), V(-0.8, 0.3, -0.24), V(-0.4, 0.23, -0.22), V(0.4, 0.24, -0.22), V(1.0, 0.36, -0.2), V(1.14, 0.62, -0.16), V(XC[3] + 0.03, DECK_Y + 0.09, 0.05)];
    rig.part(root, 'fuel-line', 'fuel-line', F, [['steel', tube(line, 0.005, { radial: 8 })]]);
    rig.part(root, 'fuel-filler', 'fuel-tank', F, [['steel', tube([V(-0.92, 0.42, 0.45), V(-1.3, 0.62, 0.7), V(-1.86, 0.84, 0.86)], 0.022, { radial: 10 })]]);
    flows.fuel = [...line, V(XC[3] + 0.03, DECK_Y + 0.105, -0.03), V(XC[3], DECK_Y + 0.09, -0.122), V(XC[0], DECK_Y + 0.09, -0.122)];
  }

  // ───────────────────────── intake air path ─────────────────────────
  flows.air = [V(2.12, 0.62, -0.35), V(2.05, 0.68, -0.44), V(1.86, 0.66, -0.47), V(1.8, 0.68, -0.4), V(1.74, DECK_Y + 0.035, -0.33), V(1.65, DECK_Y + 0.0, -0.29), V(XC[0], DECK_Y - 0.02, -0.29), V(XC[2], DECK_Y - 0.02, -0.29), V(XC[1], DECK_Y + 0.05, -0.24), V(XC[1], DECK_Y + 0.075, -0.15), V(XC[1], DECK_Y + 0.02, -0.03)];

  // ───────────────────────── brake hydraulics ─────────────────────────
  let pedal: import('./rig').PartNode;
  let throttlePedal: import('./rig').PartNode;
  {
    const Bk = 'brakes';
    const booster = V(1.02, 0.78, -0.42);
    rig.part(root, 'brake-booster', 'brake-booster', Bk, [['paintBlack', at(alongAxis(lathe([[0, 0], [0.1, 0.0], [0.11, 0.02], [0.11, 0.1], [0.1, 0.12], [0, 0.12]], 'y', 40), 'x'), booster.x - 0.06, booster.y, booster.z)]]);
    const mc0 = booster.clone().add(V(0.06, 0, 0));
    const mc1 = booster.clone().add(V(0.24, 0, 0));
    rig.part(root, 'master-cylinder', 'master-cylinder', Bk, [['castAl', rod(mc0, mc1, 0.025, 18)]]);
    rig.part(root, 'brake-reservoir', 'brake-fluid-reservoir', Bk, [['polymer', rbox(0.12, 0.06, 0.07, 0.015, mc0.x + 0.09, mc0.y + 0.06, mc0.z), '#dcdcd6'], ['polymer', at(alongAxis(lathe([[0, 0], [0.022, 0], [0.022, 0.015], [0, 0.015]], 'y', 16), 'y'), mc0.x + 0.06, mc0.y + 0.09, mc0.z)]]);
    const abs = V(1.22, 0.58, 0.58);
    rig.part(root, 'abs-modulator', 'abs-modulator', Bk, [['castAl', rbox(0.12, 0.1, 0.1, 0.01, abs.x, abs.y, abs.z)], ['polymerGloss', rbox(0.12, 0.05, 0.06, 0.01, abs.x, abs.y - 0.01, abs.z - 0.08)]]);
    ecus.abs = abs.clone().add(V(0, 0.0, -0.09));
    // lines: master cylinder → ABS unit → each wheel
    const toAbs = [mc1.clone().add(V(-0.03, -0.02, 0)), V(1.2, 0.72, -0.2), V(1.22, 0.7, 0.3), abs.clone().add(V(0, 0.04, -0.03))];
    const wheels = [
      [abs, V(1.3, 0.55, 0.4), V(1.42, 0.45, 0.25), V(1.43, 0.42, -0.55), V(BODY.xFront - 0.02, 0.4, -0.66)],
      [abs, V(1.35, 0.55, 0.62), V(BODY.xFront - 0.02, 0.4, 0.66)],
      [abs, V(1.2, 0.3, 0.12), V(0.0, 0.2, -0.12), V(-1.2, 0.3, -0.35), V(BODY.xRear - 0.05, 0.4, -0.67)],
      [abs, V(1.2, 0.3, 0.14), V(0.0, 0.2, -0.1), V(-1.2, 0.3, 0.35), V(BODY.xRear - 0.05, 0.4, 0.67)],
    ];
    rig.part(root, 'brake-lines', 'brake-line', Bk, [['copper', merge([tube(toAbs, 0.003, { radial: 6 }), ...wheels.map((w) => tube(w, 0.003, { radial: 6, segments: 60 }))]), '#8a6a4a']]);
    flows.brakeMaster = toAbs;
    wheels.forEach((w, i) => (flows[`brake${i}`] = w));
    // pedals (in the footwell): the brake pedal pivots on its bracket; its pushrod enters the booster
    const pivot = V(0.82, 0.82, -0.34);
    const pad = V(0.68, 0.47, -0.33);
    pedal = rig.part(root, 'brake-pedal', 'brake-pedal', Bk, [['steel', merge([rod(pivot, pad, 0.008, 10), rbox(0.03, 0.06, 0.08, 0.008, pad.x, pad.y, pad.z)]), '#2a2c30'], ['rubber', rbox(0.012, 0.055, 0.075, 0.006, pad.x - 0.012, pad.y, pad.z)]], { pivot });
    rig.part(root, 'pedal-box', 'brake-pedal', Bk, [['steel', merge([rbox(0.08, 0.06, 0.14, 0.01, pivot.x + 0.02, pivot.y, pivot.z + 0.03), rod(pivot.clone().add(V(-0.05, -0.08, 0)), booster.clone().add(V(-0.06, 0, 0.0)), 0.006, 8)]), '#2a2c30']]);
    const tp = V(0.83, 0.72, -0.22);
    throttlePedal = rig.part(root, 'throttle-pedal', 'accelerator-pedal', 'controls', [['polymer', merge([rod(tp, V(0.7, 0.44, -0.22), 0.007, 8), rbox(0.02, 0.12, 0.06, 0.008, 0.71, 0.48, -0.22)])]], { pivot: tp });
  }

  // ───────────────────────── 12 V, controllers, harness ─────────────────────────
  {
    const El = 'electrical';
    const batt = V(1.12, 0.66, 0.6);
    rig.part(root, 'battery', 'battery', El, [
      ['battery', rbox(0.27, 0.18, 0.17, 0.012, batt.x, batt.y, batt.z)],
      ['polymer', rbox(0.27, 0.02, 0.17, 0.008, batt.x, batt.y + 0.1, batt.z), '#3a3d42'],
      ['copper', merge([rod(V(batt.x + 0.09, batt.y + 0.11, batt.z - 0.05), V(batt.x + 0.09, batt.y + 0.13, batt.z - 0.05), 0.009, 10), rod(V(batt.x - 0.09, batt.y + 0.11, batt.z - 0.05), V(batt.x - 0.09, batt.y + 0.13, batt.z - 0.05), 0.009, 10)])],
    ]);
    const fuse = V(1.35, 0.68, -0.6);
    rig.part(root, 'fuse-box', 'fuse-relay-box', El, [['polymer', rbox(0.18, 0.08, 0.13, 0.015, fuse.x, fuse.y, fuse.z)], ['polymerGloss', rbox(0.17, 0.01, 0.12, 0.004, fuse.x, fuse.y + 0.045, fuse.z), '#3b3e44']]);
    const ecm = V(1.32, 0.66, 0.6);
    rig.part(root, 'ecm', 'engine-control-module', 'control', [['castAl', rbox(0.18, 0.04, 0.15, 0.008, ecm.x, ecm.y, ecm.z)], ['polymer', rbox(0.06, 0.04, 0.05, 0.006, ecm.x - 0.06, ecm.y + 0.03, ecm.z - 0.05)]]);
    ecus.ecm = ecm.clone();
    ecus.tcm = V(0.62, TRANS.axisY - 0.13, -0.03);
    const bcm = V(0.62, 0.62, -0.5);
    rig.part(root, 'bcm', 'body-control-module', 'control', [['polymer', rbox(0.16, 0.05, 0.12, 0.008, bcm.x, bcm.y, bcm.z), '#25272b']]);
    ecus.bcm = bcm.clone();
    ecus.cluster = V(0.6, 0.94, -0.37);
    ecus.acm = V(0.2, 0.28, 0.0);
    ecus.eps = V(BODY.xFront + 0.01, 0.315, -0.18);
    const obd = V(0.66, 0.56, -0.48);
    rig.part(root, 'obd-port', 'diagnostic-connector', 'control', [['polymerGloss', rbox(0.045, 0.02, 0.025, 0.004, obd.x, obd.y, obd.z)]]);
    ecus.obd = obd.clone();
    // harness: battery → fuse box → along the firewall → into the cabin → along the sills
    const trunk = [batt.clone().add(V(-0.09, 0.12, -0.06)), V(1.2, 0.76, 0.3), V(1.05, 0.82, 0.1), V(0.98, 0.82, -0.3), fuse.clone().add(V(-0.05, 0.05, 0.05))];
    const engineLoom = [V(0.98, 0.82, -0.1), V(1.2, DECK_Y + 0.13, -0.12), V(XC[0], DECK_Y + 0.13, -0.12), V(XC[0] + 0.03, DECK_Y + 0.12, 0.05)];
    const cabinLoom = [V(0.98, 0.82, -0.3), V(0.85, 0.75, -0.45), bcm, V(0.55, 0.3, -0.62), V(-0.6, 0.25, -0.66), V(-1.8, 0.45, -0.62), V(-2.3, 0.9, -0.55)];
    const ground = [batt.clone().add(V(0.09, 0.12, -0.06)), V(1.25, 0.6, 0.45), V(XC[0], CRANK_Y + 0.12, 0.15)];
    const starterCable = [batt.clone().add(V(-0.09, 0.12, -0.06)), V(1.0, 0.55, 0.4), V(0.98, 0.3, 0.2), V(1.0, 0.22, -0.05), V(1.03, CRANK_Y - 0.13, -0.15)];
    const altCable = [V(BELT_X - 0.15, CRANK_Y + 0.31, 0.2), V(1.4, 0.75, 0.4), batt.clone().add(V(-0.09, 0.12, -0.06))];
    rig.part(root, 'wiring-harness', 'wiring-harness', El, [['harness', merge([tube(trunk, 0.012, { radial: 8 }), tube(engineLoom, 0.009, { radial: 8 }), tube(cabinLoom, 0.01, { radial: 8 })])]]);
    rig.part(root, 'battery-cables', 'battery-cable', El, [['copper', merge([tube(starterCable, 0.006, { radial: 8 }), tube(altCable, 0.005, { radial: 8 })]), '#7c2d24'], ['harness', tube(ground, 0.006, { radial: 8 })]]);
    flows.starterCurrent = starterCable;
    flows.chargeCurrent = altCable;
    flows.groundReturn = ground;
    flows.ecuPower = [batt.clone().add(V(-0.09, 0.12, -0.06)), ...trunk.slice(1, 3), V(1.2, 0.72, 0.5), ecm];
    // wipers on the cowl
    const wip: BufferGeometry[] = [];
    for (const z of [-0.45, 0.05]) wip.push(rod(V(0.97, 0.985, z), V(0.84, 1.05, z + 0.42), 0.006, 6), rbox(0.02, 0.015, 0.5, 0.004, 0.86, 1.04, z + 0.25));
    rig.part(root, 'wipers', 'wipers', El, [['polymer', merge(wip)]]);
  }

  // ───────────────────────── air conditioning ─────────────────────────
  {
    const H = 'hvac';
    const evap = V(0.74, 0.68, 0.12);
    rig.part(root, 'hvac-box', 'hvac-module', H, [['polymer', rbox(0.22, 0.24, 0.55, 0.03, 0.74, 0.66, 0.0), '#202226']]);
    rig.part(root, 'evaporator', 'evaporator', H, [['radiator', rbox(0.035, 0.16, 0.2, 0.006, evap.x, evap.y, evap.z), '#8b9097']]);
    rig.part(root, 'blower', 'blower-motor', H, [['polymer', at(alongAxis(lathe([[0, 0], [0.08, 0], [0.08, 0.07], [0, 0.07]], 'y', 28), 'y'), 0.72, 0.5, 0.36)]]);
    rig.part(root, 'cabin-filter', 'cabin-air-filter', H, [['airbag', rbox(0.025, 0.02, 0.2, 0.004, 0.86, 0.79, 0.12)]]);
    rig.part(root, 'blend-door', 'blend-door', H, [['polymer', rbox(0.01, 0.12, 0.18, 0.003, 0.78, 0.66, 0.0), '#3a3c41']], { pivot: V(0.78, 0.72, 0.0) });
    const ac0 = ACCESSORY.find((p) => p.id === 'compressor')!;
    const comp = V(BELT_X - 0.15, ac0.v, -ac0.u);
    const lines = [
      [comp, V(1.85, 0.3, -0.25), V(radX + 0.045, 0.32, -0.3)],
      [V(radX + 0.045, 0.62, 0.3), V(1.6, 0.72, 0.4), V(1.0, 0.76, 0.3), V(0.86, 0.72, 0.18)],
      [V(0.86, 0.66, 0.06), V(1.0, 0.7, 0.2), V(1.3, 0.62, 0.0), comp.clone().add(V(0, 0.05, 0))],
    ];
    rig.part(root, 'ac-lines', 'refrigerant-line', H, [['aluminium', merge(lines.map((l) => tube(l, 0.007, { radial: 8 })))]]);
    flows.refrigerant = [...lines[0], ...lines[1], ...lines[2]];
    flows.cabinAir = [V(0.86, 0.95, 0.15), V(0.86, 0.79, 0.12), V(0.72, 0.6, 0.36), V(0.74, 0.62, 0.12), V(0.74, 0.7, 0.0), V(0.62, 0.86, -0.1), V(0.45, 0.92, -0.37), V(0.1, 0.95, -0.37)];
  }

  // CAN bus: a trunk through the car with the controllers on it (drawn by the network overview)
  flows.can = [ecus.ecm, V(1.15, 0.7, 0.3), V(0.95, 0.62, 0.0), ecus.tcm, V(0.7, 0.4, -0.2), ecus.bcm, ecus.cluster, V(0.45, 0.62, -0.1), ecus.acm, V(0.8, 0.45, 0.2), ecus.abs, V(1.4, 0.45, 0.2), ecus.eps];
  // the differential's surroundings for its own flows
  flows.diffOil = [V(DIFF_C.x - 0.05, DIFF_C.y - 0.1, -0.06), V(DIFF_C.x + 0.05, DIFF_C.y - 0.06, 0.04), V(DIFF_C.x + 0.08, DIFF_C.y + 0.02, 0.06)];

  return { fans, pedal: pedal!, throttlePedal: throttlePedal!, flows, ecus, root };
}
