/**
 * The flows the lessons draw, built from the paths the geometry defines (systems.flows) plus
 * the torque path, from the crankshaft through the converter, the gearbox, the driveshaft and
 * the differential to each rear tyre's contact patch.
 */
import { Vector3 } from 'three';
import type { Car } from '../scene/car/build';
import type { FlowDef } from '../scene/viz/flows';
import type { FlowKind } from '../scene/viz/language';
import { CRANK_Y, FLEX_X, XC } from '../scene/car/engineGeo';
import { DIFF_C, DRIVESHAFT, PINION_Y, TRANS } from '../scene/car/drivetrainGeo';
import { BODY } from '../spec/vehicle';

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

export function FLOW_DEFS(car: Car): FlowDef[] {
  const f = car.systems.flows;
  const kindOf: Record<string, FlowKind> = {
    air: 'air',
    fuel: 'fuel',
    exhaust: 'exhaust',
    coolantEngine: 'coolant',
    coolantBypass: 'coolant',
    coolantRadiator: 'coolant',
    coolantHeater: 'coolant',
    radiatorAir: 'air',
    oilMain: 'oil',
    oilMains: 'oil',
    oilHead: 'oil',
    oilReturn: 'oil',
    brakeMaster: 'hydraulic',
    brake0: 'hydraulic',
    brake1: 'hydraulic',
    brake2: 'hydraulic',
    brake3: 'hydraulic',
    starterCurrent: 'power',
    chargeCurrent: 'power',
    groundReturn: 'power',
    ecuPower: 'power',
    can: 'signal',
    refrigerant: 'refrigerant',
    cabinAir: 'air',
  };
  const pace: Record<string, number> = { radiatorAir: 1.6, cabinAir: 0.8, can: 1.2, ecuPower: 1.0 };
  const spread: Record<string, number> = { radiatorAir: 0.25, cabinAir: 0.05, exhaust: 0.012, air: 0.012 };
  const defs: FlowDef[] = [];
  for (const [id, points] of Object.entries(f)) {
    const kind = kindOf[id];
    if (!kind) continue;
    defs.push({ id, kind, points, pace: pace[id] ?? 1, spread: spread[id] ?? 0 });
  }
  // torque: crankshaft → flexplate → converter → gearbox → driveshaft → pinion → ring gear
  const main = [V(XC[0] + 0.02, CRANK_Y, 0), V(FLEX_X, CRANK_Y, 0), V(TRANS.convX, CRANK_Y, 0), V(0.75, CRANK_Y, 0), V(TRANS.tailEnd, CRANK_Y, 0), DRIVESHAFT.a.clone(), DRIVESHAFT.b.clone(), V(DIFF_C.x + 0.06, PINION_Y, 0), V(DIFF_C.x, DIFF_C.y, 0)];
  defs.push({ id: 'torque', kind: 'torque', points: main, pace: 1.2 });
  for (const s of [-1, 1]) {
    defs.push({
      id: `torque${s < 0 ? 'L' : 'R'}`,
      kind: 'torque',
      points: [V(DIFF_C.x, DIFF_C.y, 0), V(DIFF_C.x, DIFF_C.y, s * 0.2), V(BODY.xRear, 0.32, s * 0.6), V(BODY.xRear, 0.32, s * 0.79), V(BODY.xRear, 0.14, s * 0.8), V(BODY.xRear, 0.02, s * 0.8)],
      pace: 0.8,
    });
  }
  return defs;
}
