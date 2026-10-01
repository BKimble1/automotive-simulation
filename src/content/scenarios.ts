/**
 * Simulate: six operating scenarios (the car doing everyday things, with its gauges) and six
 * faults to diagnose. A diagnosis follows the workshop's order: the complaint, what to inspect,
 * what to measure, a conclusion, then the reveal (what failed, why it caused those symptoms, and
 * the repair). Each fault is a real fault in the car's model, so the gauges and the scene show
 * its true effects, not a scripted picture.
 */
import { NO_FAULTS, presetCold, presetCruise, presetIdle, type CarState, type Faults, type Inputs, type RoadSpec } from '../sim/car';
import { brakeAt, cruise, holdSpeed, laneSteer, type Drive } from './drivers';
import { TIRE, units } from '../spec/vehicle';

export interface ScenarioProgram {
  start: () => CarState;
  drive: Drive;
  road?: RoadSpec;
  faults?: Partial<Faults>;
  timeScale?: number;
  /** Start again after this many simulated seconds (an event that is over). */
  loop?: number;
}

export interface Scenario {
  id: string;
  title: string;
  summary: string;
  view: string;
  program: ScenarioProgram;
  /** Readout ids for the live gauges. */
  gauges: string[];
  /** What to watch for. */
  watch: string;
}

export interface Inspection {
  id: string;
  label: string;
  /** Where the camera goes: a view id or a registry id. */
  look: string;
  finding: string;
  /** This finding points at the cause. */
  telling?: boolean;
}

export interface FaultCase {
  id: string;
  title: string;
  complaint: string;
  view: string;
  program: ScenarioProgram;
  gauges: string[];
  inspections: Inspection[];
  /** Measurements and what normal looks like. */
  measures: { readout: string; normal: string }[];
  causes: { id: string; label: string; right?: boolean; why: string }[];
  reveal: { look: string; text: string; repair: string };
  /** What the repair replaces, set on the running car (a new battery is charged). */
  repairState?: { soc?: number };
}

const P = (inp: Inputs) => {
  inp.ignition = true;
  inp.selector = 'P';
};
const idle: Drive = (_t, inp) => P(inp);
/** Start from cold with the button, then idle. */
const startThenIdle: Drive = (t, inp, s) => {
  inp.ignition = t >= 0.5 || s.engine === 'running';
  inp.selector = 'P';
  inp.start = t >= 0.5 && s.engine !== 'running' && t < 6;
};
/** Stop and go: away to 50, hold, brake to a stop, wait; repeat every 18 s. */
const stopAndGo: Drive = (t, inp, s) => {
  inp.ignition = true;
  inp.selector = 'D';
  inp.steer = laneSteer(s, { R: 0, curveX: 0 });
  const c = t % 18;
  if (c < 9) {
    inp.brakeN = 0;
    inp.throttle = units.msToKmh(s.u) < 47 ? 0.45 : holdSpeed(s, 50);
  } else if (c < 14) {
    inp.throttle = 0;
    inp.brakeN = s.u > 0.3 ? 140 : 80;
  } else {
    inp.throttle = 0;
    inp.brakeN = 80;
  }
};
/** Cruise at 80, then floor it to overtake (kickdown), then ease off at 125. */
const overtake: Drive = (t, inp, s) => {
  inp.ignition = true;
  inp.selector = 'D';
  inp.steer = laneSteer(s, { R: 0, curveX: 0 });
  const v = units.msToKmh(s.u);
  inp.throttle = t < 3 ? holdSpeed(s, 80) : v < 125 && t < 14 ? 1 : holdSpeed(s, 125);
};

export const SCENARIOS: Scenario[] = [
  {
    id: 'cold-start',
    title: 'A cold start',
    summary: 'A cold morning: the engine starts and idles while it warms, the thermostat shut so the heat stays in the engine. Time runs ten times faster here.',
    view: 'cooling-circuit',
    program: { start: presetCold, drive: startThenIdle, timeScale: 10 },
    gauges: ['rpm', 'coolantC', 'thermostat', 'oilBar', 'volts'],
    watch: 'Oil pressure is highest while the oil is cold and thick, and the coolant warms steadily with the thermostat shut.',
  },
  {
    id: 'city',
    title: 'City driving',
    summary: 'Stop and go: away to 50 km/h, brake to a stop, wait, again.',
    view: 'torque-path',
    program: { start: presetIdle, drive: stopAndGo },
    gauges: ['kmh', 'rpm', 'gear', 'brakeBar'],
    watch: 'The gearbox changes up early at light throttle, and the converter lets the engine idle while the car waits in Drive.',
  },
  {
    id: 'motorway',
    title: 'Motorway cruise',
    summary: 'Steady at 120 km/h in eighth gear, the converter locked.',
    view: 'drive-away',
    program: { start: () => presetCruise(120), drive: cruise(120) },
    gauges: ['kmh', 'rpm', 'gear', 'coolantC'],
    watch: 'About 2,100 rpm: the engine barely works. Ram air through the radiator keeps the coolant steady without the fans.',
  },
  {
    id: 'overtake',
    title: 'Overtaking',
    summary: 'Cruising at 80, then the pedal to the floor: the gearbox kicks down and the car pulls hard to 125 km/h.',
    view: 'torque-path',
    program: { start: () => presetCruise(80), drive: overtake, loop: 18 },
    gauges: ['kmh', 'rpm', 'gear', 'accel'],
    watch: 'Kickdown drops several gears at once to put the engine near its power peak.',
  },
  {
    id: 'emergency-stop',
    title: 'Emergency stop in the wet',
    summary: 'From 80 km/h on a wet road, the pedal stamped down. ABS works.',
    view: 'braking-side',
    program: { start: () => presetCruise(80), drive: brakeAt(80, 2, 520), road: { mu: 0.55 }, loop: 10 },
    gauges: ['kmh', 'brakeBar', 'stopDistance', 'abs'],
    watch: 'The pressure pulses as ABS releases and re-applies each wheel; the car stops in about 46 m.',
  },
  {
    id: 'bend',
    title: 'A long bend',
    summary: 'A 40-metre left-hander at 55 km/h: the body leans and the outer tyres take the load.',
    view: 'corner-top',
    program: { start: () => presetCruise(55), drive: cruise(55, { R: 40, curveX: 25 }), road: { mu: TIRE.muDry, curve: 1 / 40, curveX: 25 }, loop: 9 },
    gauges: ['kmh', 'wheelSpeeds', 'accel'],
    watch: 'The outer rear wheel turns faster than the inner one, and the differential lets it.',
  },
];

const bumpy = (at: number): RoadSpec => ({ mu: TIRE.muDry, bumpAt: at });

export const FAULTS: FaultCase[] = [
  {
    id: 'misfire',
    title: 'Shaking at idle',
    complaint: 'The engine shakes at idle and feels weak pulling away. The engine warning light is on.',
    view: 'firing-order',
    program: { start: presetIdle, drive: idle, faults: { misfireCyl: 1 } },
    gauges: ['rpm', 'firing', 'misfires'],
    inspections: [
      { id: 'plugs', label: 'Spark plugs and coils', look: 'ignition-coil', finding: 'Plugs 1, 3 and 4 fire on time. Cylinder 2 shows no spark at all.', telling: true },
      { id: 'injectors', label: 'Fuel injectors', look: 'fuel-injector', finding: 'All four injectors pulse normally; rail pressure is steady.' },
      { id: 'air', label: 'Air intake', look: 'intake', finding: 'The filter is clean and there are no leaks after the throttle.' },
      { id: 'timing', label: 'Timing chain', look: 'timing-chain', finding: 'Cam and crank signals line up; the chain is tight.' },
    ],
    measures: [
      { readout: 'misfires', normal: 'The engine unit counts no misfires.' },
      { readout: 'rpm', normal: 'A steady 750 rpm.' },
    ],
    causes: [
      { id: 'coil', label: 'A failed ignition coil on cylinder 2', right: true, why: 'No spark in one cylinder means that cylinder’s mixture never burns.' },
      { id: 'filter', label: 'A blocked air filter', why: 'That would starve all four cylinders equally, not one.' },
      { id: 'fuel', label: 'Low fuel pressure', why: 'The rail pressure is steady and every injector pulses.' },
      { id: 'chain', label: 'A stretched timing chain', why: 'The cam and crank signals agree.' },
    ],
    reveal: {
      look: 'firing-order',
      text: 'Cylinder 2’s coil has failed. That cylinder still draws in air and fuel, but nothing lights it: one power stroke in four is missing, so the crankshaft slows every time cylinder 2 should fire, and the engine shakes. The engine unit sees the speed dips, counts misfires and switches on the warning light; unburnt fuel would soon overheat the catalytic converter.',
      repair: 'Replace the coil on cylinder 2.',
    },
  },
  {
    id: 'overheat',
    title: 'Overheating on the motorway',
    complaint: 'On the motorway the temperature gauge climbs toward red. The heater still blows hot.',
    view: 'cooling-circuit',
    program: { start: () => Object.assign(presetCruise(110), { coolantC: 96, thermostat: 0 }), drive: cruise(110), faults: { thermostatStuckClosed: true }, timeScale: 3 },
    gauges: ['coolantC', 'thermostat', 'fan', 'kmh'],
    inspections: [
      { id: 'level', label: 'Coolant level', look: 'expansion-tank', finding: 'The expansion tank is at the full mark.' },
      { id: 'fan', label: 'Cooling fans', look: 'cooling-fan', finding: 'The fans run when the coolant passes 102 °C.' },
      { id: 'hoses', label: 'Radiator hoses', look: 'coolant-hose', finding: 'The top hose to the radiator stays cool while the engine is hot.', telling: true },
      { id: 'oil', label: 'Engine oil', look: 'oil-pan', finding: 'Oil level and colour are normal; no coolant in the oil.' },
    ],
    measures: [
      { readout: 'thermostat', normal: 'Opens from 88 °C, fully by 100 °C.' },
      { readout: 'coolantC', normal: 'Holds near 90 °C.' },
    ],
    causes: [
      { id: 'thermostat', label: 'The thermostat stuck shut', right: true, why: 'Hot engine, cold top hose: coolant is not reaching the radiator.' },
      { id: 'fan', label: 'A failed cooling fan', why: 'The fans run, and at motorway speed the air rushing through matters more.' },
      { id: 'leak', label: 'A coolant leak', why: 'The level is full.' },
      { id: 'gasket', label: 'A blown head gasket', why: 'There is no coolant in the oil and no loss of coolant.' },
    ],
    reveal: {
      look: 'cooling-circuit',
      text: 'The thermostat has stuck shut. The water pump still circulates coolant round the engine through the bypass, which is why the heater stays hot, but none reaches the radiator, so the heat has nowhere to go. Under motorway load the temperature climbs steadily.',
      repair: 'Replace the thermostat and refill the coolant.',
    },
  },
  {
    id: 'charging',
    title: 'Battery light on',
    complaint: 'The battery warning light came on while driving, and the headlights seem dimmer.',
    view: 'charging',
    program: { start: presetIdle, drive: (_t, inp) => (P(inp), (inp.accessoriesAmps = 40)), faults: { alternatorFailed: true } },
    gauges: ['volts', 'alternatorAmps', 'batteryAmps'],
    inspections: [
      { id: 'belt', label: 'Accessory belt', look: 'accessory-belt', finding: 'The belt is tight and turning every pulley, including the water pump’s.' },
      { id: 'battery', label: 'Battery and terminals', look: 'battery', finding: 'Terminals clean and tight. The battery is slowly discharging.' },
      { id: 'alternator', label: 'Alternator output', look: 'alternator', finding: 'The alternator turns but delivers no current.', telling: true },
      { id: 'fuses', label: 'Fuses', look: 'fuse-relay-box', finding: 'All fuses intact.' },
    ],
    measures: [
      { readout: 'volts', normal: 'About 14.2 V with the engine running.' },
      { readout: 'alternatorAmps', normal: 'Tens of amps, matching the load.' },
    ],
    causes: [
      { id: 'alternator', label: 'A failed alternator', right: true, why: 'It turns but gives no current, so the battery carries the whole load.' },
      { id: 'battery', label: 'A worn-out battery', why: 'A weak battery starts badly, but with a working alternator the voltage would still be about 14 V.' },
      { id: 'belt', label: 'A broken belt', why: 'The belt is turning all the pulleys.' },
      { id: 'fuse', label: 'A blown fuse', why: 'All fuses are intact.' },
    ],
    reveal: {
      look: 'charging',
      text: 'The alternator has failed (its regulator or diodes). The car now runs entirely on the battery: the voltage falls below 12.5 V and keeps falling. Within an hour or so the ignition and injection would stop working.',
      repair: 'Replace the alternator, then recharge the battery.',
    },
  },
  {
    id: 'oil-pressure',
    title: 'Oil light flickers',
    complaint: 'In town the oil warning light flickers when braking and pulling away, and there is a faint ticking from the top of the engine.',
    view: 'oil-circuit',
    program: { start: () => Object.assign(presetIdle(), { oilC: 100, coolantC: 92 }), drive: stopAndGo, faults: { lowOil: true } },
    gauges: ['oilBar', 'oilC', 'kmh'],
    inspections: [
      { id: 'dipstick', label: 'Oil level (dipstick)', look: 'oil-pan', finding: 'Well below the minimum mark.', telling: true },
      { id: 'filter', label: 'Oil filter', look: 'oil-filter', finding: 'Fitted correctly, no leaks.' },
      { id: 'sensor', label: 'Pressure switch', look: 'oil-pump', finding: 'The switch agrees with a mechanical gauge.' },
      { id: 'coolant', label: 'Coolant', look: 'cooling-circuit', finding: 'Temperature and level normal.' },
    ],
    measures: [
      { readout: 'oilBar', normal: 'Above 1 bar at all times, rising with engine speed.' },
      { readout: 'oilC', normal: 'Around 90–110 °C.' },
    ],
    causes: [
      { id: 'low', label: 'Low oil level', right: true, why: 'With too little oil, the oil sloshes away from the pickup whenever the car brakes or accelerates, and the pressure collapses.' },
      { id: 'sensor', label: 'A faulty pressure switch', why: 'A separate gauge confirms the low pressure.' },
      { id: 'viscosity', label: 'Oil too thin', why: 'It would show less, and the level would still be right.' },
      { id: 'thermostat', label: 'A failing thermostat', why: 'The coolant is at its normal temperature.' },
    ],
    reveal: {
      look: 'oil-circuit',
      text: 'The engine is low on oil. When the car brakes or pulls away the remaining oil sloshes to one end of the pan, the pickup draws air, and the pressure collapses for a moment: the light flickers. The ticking is the valvetrain running short of oil. Driven like this, the bearings would soon be damaged.',
      repair: 'Find the leak or the cause of consumption, then fill to the mark.',
    },
  },
  {
    id: 'bouncing',
    title: 'Bouncy front end',
    complaint: 'After a bump the front keeps bouncing, and the front left tyre is wearing in patches.',
    view: 'suspension-front',
    program: { start: () => presetCruise(30), drive: cruise(30), road: bumpy(14), faults: { wornDamper: 0 }, timeScale: 0.3, loop: 4.5 },
    gauges: ['wheelTravel', 'kmh'],
    inspections: [
      { id: 'damper', label: 'Front dampers', look: 'damper', finding: 'The front left damper shows oil on its body and offers little resistance.', telling: true },
      { id: 'spring', label: 'Front springs', look: 'coil-spring', finding: 'Both springs intact; the car sits level.' },
      { id: 'tyres', label: 'Tyre pressures', look: 'tyre', finding: 'All four at the correct pressure.' },
      { id: 'bushes', label: 'Wishbone bushes', look: 'lower-control-arm', finding: 'No play.' },
    ],
    measures: [{ readout: 'wheelTravel', normal: 'One rise over a bump, then settled.' }],
    causes: [
      { id: 'damper', label: 'A worn front left damper', right: true, why: 'Without damping, the spring’s energy keeps the wheel bouncing.' },
      { id: 'spring', label: 'A broken spring', why: 'The springs are intact and the car sits level.' },
      { id: 'pressure', label: 'Low tyre pressure', why: 'The pressures are correct.' },
      { id: 'bearing', label: 'A worn wheel bearing', why: 'That makes a hum, not a bounce.' },
    ],
    reveal: {
      look: 'suspension-front',
      text: 'The front left damper has lost its oil. The spring still stores the bump’s energy, but nothing turns it into heat, so the wheel bounces several times. Each time the tyre unloads it grips less and scuffs, which is the patchy wear.',
      repair: 'Replace both front dampers (in pairs, so the car stays balanced).',
    },
  },
  {
    id: 'slow-crank',
    title: 'Slow to start',
    complaint: 'On a cold morning the engine turns over slowly before it starts.',
    view: 'battery-starter',
    program: { start: presetCold, drive: startThenIdle, faults: { weakBattery: true }, timeScale: 0.5, loop: 6 },
    gauges: ['volts', 'starterAmps', 'rpm'],
    inspections: [
      { id: 'battery', label: 'Battery test', look: 'battery', finding: 'Resting voltage is fine, but it collapses under load.', telling: true },
      { id: 'starter', label: 'Starter motor', look: 'starter-motor', finding: 'The starter draws normal current for the voltage it gets.' },
      { id: 'cables', label: 'Battery cables', look: 'battery-cable', finding: 'Clean, tight terminals; no voltage drop across them.' },
      { id: 'fuel', label: 'Fuel', look: 'fuel-tank', finding: 'Fuel pressure builds normally when the car wakes.' },
    ],
    measures: [
      { readout: 'volts', normal: 'Stays above about 10 V while cranking.' },
      { readout: 'rpm', normal: 'About 200 rpm while cranking.' },
    ],
    causes: [
      { id: 'battery', label: 'A weak battery', right: true, why: 'Its voltage collapses under the starter’s load.' },
      { id: 'starter', label: 'A failing starter', why: 'It draws normal current for the voltage it gets.' },
      { id: 'alternator', label: 'A failed alternator', why: 'That would light the battery light while driving; it does not.' },
      { id: 'fuel', label: 'No fuel pressure', why: 'The engine turns slowly; with no fuel it would turn normally but not start.' },
    ],
    reveal: {
      look: 'battery-starter',
      text: 'The battery has lost much of its capacity. Cold makes it worse: under the starter’s load its voltage collapses, so the starter turns the engine slowly, the cranking takes longer, and on a colder day it might not start at all.',
      repair: 'Test and replace the battery; check the charging system too.',
    },
    repairState: { soc: 0.95 },
  },
];

export const SCENARIO_BY_ID = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
export const FAULT_BY_ID = Object.fromEntries(FAULTS.map((f) => [f.id, f]));
export { NO_FAULTS };
