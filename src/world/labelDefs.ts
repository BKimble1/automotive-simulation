/**
 * The in-scene labels the lessons use, pinned to the drawn car (see scene/labels.ts). Ids are
 * referenced by views as `label:<id>` channels.
 */
import { Vector3 } from 'three';
import type { Car } from '../scene/car/build';
import type { LabelDef } from '../scene/labels';
import { CRANK_Y, DECK_Y, FLEX_X, XC } from '../scene/car/engineGeo';
import { DIFF_C, TRANS } from '../scene/car/drivetrainGeo';
import { BODY } from '../spec/vehicle';

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

export function labelDefs(car: Car): Record<string, LabelDef> {
  const E = car.engine;
  const valve = (intake: boolean) => E.valves.find((v) => v.cyl === 0 && v.intake === intake)!;
  const vin = valve(true);
  const vex = valve(false);
  const worldOf = (name: string, offset = new Vector3()) => {
    const node = car.rig.parts.get(name);
    const out = new Vector3();
    return () => (node ? node.object.localToWorld(out.copy(offset)) : out.set(0, 0, 0));
  };
  const cx = TRANS.convX;
  const defs: Record<string, LabelDef> = {
    // the start
    battery: { text: 'Battery', at: V(1.12, 0.8, 0.6) },
    ecm: { text: 'Engine control unit', at: V(1.32, 0.7, 0.6), side: 'left' },
    starter: { text: 'Starter motor', at: V(FLEX_X - 0.1, CRANK_Y - 0.16, -0.12), side: 'left' },
    'starter-pinion': { text: 'Starter pinion', at: V(FLEX_X - 0.005, CRANK_Y - 0.135, -0.094), side: 'left' },
    'ring-gear-flex': { text: 'Flexplate ring gear', at: V(FLEX_X, CRANK_Y + 0.12, -0.09) },
    crankshaft: { text: 'Crankshaft', at: V(XC[2], CRANK_Y, -0.03) },
    'start-button': { text: 'Start button', at: V(0.54, 0.86, -0.62), side: 'left' },
    // the cylinder
    'intake-valve': { text: 'Intake valve', at: vin.seat.clone().addScaledVector(vin.dir, 0.05) },
    'exhaust-valve': { text: 'Exhaust valve', at: vex.seat.clone().addScaledVector(vex.dir, 0.05), side: 'left' },
    'spark-plug': { text: 'Spark plug', at: E.plugTips[0].clone().add(V(0, 0.075, 0)) },
    injector: { text: 'Injector', at: E.injectorTips[0].clone().add(V(0, 0.035, -0.03)) },
    piston: { text: 'Piston', at: worldOf('piston-1', V(0, 0.0, 0.03)), side: 'left' },
    // firing order
    cyl1: { text: '1', at: V(XC[0], DECK_Y + 0.2, 0) },
    cyl2: { text: '2', at: V(XC[1], DECK_Y + 0.2, 0) },
    cyl3: { text: '3', at: V(XC[2], DECK_Y + 0.2, 0) },
    cyl4: { text: '4', at: V(XC[3], DECK_Y + 0.2, 0) },
    // the torque converter (colour-coded as in its view)
    impeller: { text: 'Impeller (engine)', at: V(cx - 0.02, TRANS.axisY + 0.135, -0.02), color: '#4f9cf0' },
    turbine: { text: 'Turbine (gearbox)', at: V(cx + 0.02, TRANS.axisY + 0.135, -0.02), side: 'left', color: '#f0a23c' },
    stator: { text: 'Stator', at: V(cx, TRANS.axisY - 0.05, -0.02), color: '#e6e9ee' },
    // the gearbox
    gearsets: { text: 'Planetary gearsets', at: V(0.78, TRANS.axisY + 0.09, -0.02) },
    clutches: { text: 'Clutches and brakes', at: V(0.92, TRANS.axisY - 0.11, -0.02), side: 'left' },
    // the differential
    'ring-gear': { text: 'Ring gear', at: V(DIFF_C.x, DIFF_C.y + 0.11, -0.06), side: 'left' },
    spiders: { text: 'Spider gears', at: V(DIFF_C.x - 0.01, DIFF_C.y + 0.05, 0.0) },
    'side-gears': { text: 'Side gears', at: V(DIFF_C.x - 0.01, DIFF_C.y - 0.02, 0.06) },
    'half-shafts': { text: 'Half shaft', at: V(DIFF_C.x, DIFF_C.y, 0.4) },
    // the road
    'contact-patch': { text: 'Contact patch', at: V(BODY.xRear, 0.005, -0.8), ground: true },
  };
  return defs;
}

/** View channels that show labels. */
export const labels = (...ids: string[]): Record<string, number> => Object.fromEntries(ids.map((id) => [`label:${id}`, 1]));
