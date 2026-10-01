/**
 * The guided lessons (the ten hero sequences), the vertical slice and the film's raw material.
 * Every beat has a short title, one or two sentences (also the narration script), one view (the
 * visual focus) and the car doing the thing it explains: the model's own state drives what is on
 * screen, so a caption describes what is actually happening at that moment.
 *
 * Time: each beat runs mechanical time at its time scale (slow motion for the engine, real time
 * for driving, fast-forward for warming up), integrated exactly, so seeking is deterministic.
 */
import { NO_FAULTS, presetCold, presetCruise, presetIdle, type CarState, type Inputs, type RoadSpec } from '../sim/car';
import { TIRE } from '../spec/vehicle';
import type { Beat, Sequence } from '../world/sequence';
import { brakeAt, cruise, pullAway } from './drivers';

/** Hold the start button from `press` until the engine runs (the car's start-stop logic). */
function startScript(press: number) {
  return (t: number, inp: Inputs, s: CarState) => {
    // the press wakes the car and starts the engine in one go
    inp.ignition = t >= press || s.engine === 'running';
    inp.selector = 'P';
    inp.start = t >= press && s.engine !== 'running' && t < press + 4;
  };
}

const idleInPark = (_t: number, inp: Inputs) => {
  inp.ignition = true;
  inp.selector = 'P';
};

/** A warm engine at a chosen coolant temperature. */
const warmAt = (coolantC: number, base: () => CarState = presetIdle) => () => {
  const s = base();
  s.coolantC = coolantC;
  s.oilC = coolantC + 2;
  s.thermostat = coolantC < 88 ? 0 : Math.min(1, (coolantC - 88) / 12);
  return s;
};

// ───────────────────────────── 1. start → idle ─────────────────────────────
const startBeats: Beat[] = [
  {
    id: 'press',
    title: 'Press START',
    text: 'With the brake pedal held, one press of the start button wakes the car’s control units and asks the engine control unit to start the engine.',
    duration: 5.5,
    view: 'start-button',
    program: { start: presetCold, drive: startScript(3.9) },
    // real time until just before the press, then slowing: the button goes in and lights, and the
    // starter's first moments are already in slow motion
    timeScale: { from: 1, to: 0.05, ramp: 0.6, delay: 3.6 },
    chapter: 'Starting',
    readouts: ['volts'],
  },
  {
    id: 'battery',
    title: 'The battery feeds the starter',
    text: 'The 12-volt battery sends about 170 amps to the starter motor. Its voltage dips while the starter works.',
    duration: 5,
    view: 'battery-starter',
    timeScale: 0.05,
    readouts: ['volts', 'starterAmps'],
  },
  {
    id: 'crank',
    title: 'The starter turns the crankshaft',
    text: 'The starter’s small pinion meshes with the ring gear on the flexplate and spins the crankshaft at about 200 rpm.',
    duration: 5,
    view: 'starter-flexplate',
    timeScale: 0.04,
    readouts: ['rpm'],
  },
  {
    id: 'first-fire',
    title: 'Air, fuel, spark: the first firing',
    text: 'Once the crankshaft and camshaft sensors show where each piston is, the injectors spray fuel and the plugs fire. The engine starts turning on its own.',
    duration: 8,
    view: 'cylinder-cutaway',
    timeScale: 0.035,
    focusCyl: 0,
    readouts: ['rpm'],
  },
  {
    id: 'idle',
    title: 'A steady idle',
    text: 'The starter lets go. The engine control unit holds the speed near 750 rpm by adjusting the throttle.',
    duration: 5,
    view: 'cylinder-cutaway',
    timeScale: { from: 0.05, to: 1, ramp: 2.5 },
    focusCyl: 0,
    readouts: ['rpm', 'volts'],
  },
];

// ───────────────────────────── 2. the four-stroke cycle ─────────────────────────────
const strokeBeats: Beat[] = [
  {
    id: 'intake',
    title: 'Intake',
    text: 'The piston moves down with the intake valves open, drawing air into the cylinder. During this stroke the injector sprays in the fuel.',
    duration: 6,
    view: 'cylinder-cutaway',
    program: { start: presetIdle, drive: idleInPark },
    // one stroke (180° of crankshaft, at idle) per beat
    timeScale: 0.0067,
    focusCyl: 0,
    chapter: 'The four-stroke cycle',
  },
  {
    id: 'compression',
    title: 'Compression',
    text: 'Both valves close and the rising piston squeezes the mixture to a thirteenth of its volume. Just before the top, the spark plug fires.',
    duration: 6,
    view: 'cylinder-cutaway',
    timeScale: 0.0067,
    focusCyl: 0,
  },
  {
    id: 'power',
    title: 'Power',
    text: 'The flame spreads and the pressure rises sharply. The hot gas drives the piston down, and the connecting rod turns its push into rotation of the crankshaft.',
    duration: 6,
    view: 'cylinder-cutaway',
    timeScale: 0.0067,
    focusCyl: 0,
  },
  {
    id: 'exhaust',
    title: 'Exhaust',
    text: 'The exhaust valves open and the rising piston pushes the burnt gas out. The camshafts turn at half crankshaft speed, so each valve opens once every two revolutions.',
    duration: 6,
    view: 'cylinder-cutaway',
    timeScale: 0.0067,
    focusCyl: 0,
  },
];

// ───────────────────────────── 3. firing order ─────────────────────────────
const firingBeats: Beat[] = [
  {
    id: 'four-cylinders',
    title: 'Four cylinders, one crankshaft',
    text: 'All four cylinders run the same cycle, but each is half a revolution behind the one before, so one of them is always on its power stroke.',
    duration: 7,
    view: 'firing-order',
    program: { start: presetIdle, drive: idleInPark },
    timeScale: 0.012,
    chapter: 'Firing order',
  },
  {
    id: 'firing-1342',
    title: 'Firing 1-3-4-2',
    text: 'Watch the flames: cylinder 1, then 3, then 4, then 2. Pistons 1 and 4 move together, as do 2 and 3, so the engine stays balanced.',
    duration: 8,
    view: 'firing-order',
    timeScale: 0.012,
    readouts: ['firing'],
  },
  {
    id: 'crank-throws',
    title: 'The crankshaft’s throws',
    text: 'The crankshaft’s throws are set half a turn apart. Each power stroke pushes it on for half a revolution, then hands over to the next cylinder.',
    duration: 6,
    view: 'crank-throws',
    timeScale: 0.012,
  },
  {
    id: 'idle-speed',
    title: 'Up to speed',
    text: 'At an idle of 750 revolutions a minute, that is 25 power strokes every second; at 6,000, two hundred.',
    duration: 5,
    view: 'firing-order',
    timeScale: { from: 0.012, to: 1, ramp: 3 },
    readouts: ['rpm'],
  },
];

// ───────────────────────────── 4. torque path and a gear change ─────────────────────────────
const torqueBeats: Beat[] = [
  {
    id: 'torque-path',
    title: 'From crankshaft to road',
    text: 'In Drive, torque flows from the crankshaft through the torque converter and the gearbox, along the driveshaft to the differential, and out to the rear wheels.',
    duration: 6.5,
    view: 'torque-path',
    // select Drive at 0.6 s, pull away at 2.4 s; the first upshift comes at about 4.8 s
    program: { start: presetIdle, drive: pullAway(0.6, 2.4, 0.45) },
    timeScale: { from: 1, to: 0.12, ramp: 1.5, delay: 2.4 },
    chapter: 'To the road',
    readouts: ['rpm', 'gear', 'kmh'],
  },
  {
    id: 'converter',
    title: 'The torque converter',
    text: 'The engine spins the impeller, in blue, which flings fluid into the amber turbine that drives the gearbox. While the car is slow, the stator turns the fluid back to help the impeller, multiplying the torque.',
    duration: 6,
    view: 'converter',
    timeScale: 0.12,
    readouts: ['rpm', 'turbineRpm'],
  },
  {
    id: 'first-gear',
    title: 'First gear',
    text: 'In first gear three of the five clutches and brakes are applied, A, B and C, locking the four planetary gearsets into a 4.7 to 1 reduction.',
    duration: 5,
    view: 'gear-elements',
    timeScale: 0.1,
    readouts: ['gearKey', 'gear', 'ratio', 'elements'],
  },
  {
    id: 'upshift',
    title: 'Changing up',
    text: 'At about 3,700 rpm the gearbox control unit changes up: clutch C releases while clutch E applies, in about a third of a second, and the engine speed falls.',
    duration: 7,
    view: 'gear-elements',
    timeScale: 0.1,
    readouts: ['gearKey', 'gear', 'slip', 'elements'],
  },
  {
    id: 'differential',
    title: 'The differential',
    text: 'At the rear axle, the pinion turns the ring gear at a 3.15 to 1 reduction, and the differential shares the torque between the two half shafts.',
    duration: 5.5,
    view: 'differential',
    timeScale: 0.3,
    readouts: ['gear', 'kmh'],
  },
  {
    id: 'contact',
    title: 'The tyres push the road',
    text: 'Each rear tyre grips the road over a patch about the size of a hand and pushes backward on it. The road pushes the car forward.',
    duration: 6,
    view: 'rear-contact',
    timeScale: 0.5,
    readouts: ['kmh', 'wheelTorque'],
  },
  {
    id: 'away',
    title: 'Motion',
    text: 'The fuel’s chemical energy has become forward motion: 1,560 kilograms, already past 60 km/h and still gaining speed.',
    duration: 5,
    view: 'drive-away',
    timeScale: 1,
    readouts: ['kmh', 'gear', 'accel'],
  },
];

// ───────────────────────────── 5. the differential through a corner ─────────────────────────────
// 25 km/h, then a 12 m left turn beginning 19 m ahead (the car reaches it after about 2.7 s)
const CORNER = { R: 12, curveX: 19 };
const cornerProgram = {
  start: () => presetCruise(25),
  drive: cruise(25, CORNER, 0.14),
  road: { mu: TIRE.muDry, curve: 1 / CORNER.R, curveX: CORNER.curveX },
};
const diffBeats: Beat[] = [
  {
    id: 'diff-straight',
    title: 'Straight ahead',
    text: 'Driving straight, both rear wheels turn at the same speed. The spider gears ride round with the carrier without turning on their pin.',
    duration: 6,
    view: 'differential',
    program: cornerProgram,
    timeScale: 0.4,
    chapter: 'Cornering',
    readouts: ['wheelSpeeds'],
  },
  {
    id: 'corner-path',
    title: 'Into the corner',
    text: 'In a corner the outer wheel has farther to go. On this 12-metre turn it travels about 14 percent farther than the inner wheel, in the same time.',
    duration: 6,
    view: 'corner-top',
    timeScale: 0.5,
    readouts: ['wheelSpeeds', 'kmh'],
  },
  {
    id: 'diff-corner',
    title: 'The spider gears turn',
    text: 'Now the spider gears turn on their pin: the outer side gear speeds up and the inner one slows by the same amount, while both still receive the same torque.',
    duration: 7,
    view: 'differential',
    timeScale: 0.35,
    readouts: ['wheelSpeeds'],
  },
];

// ───────────────────────────── 6. suspension over a bump ─────────────────────────────
const BUMP_AT = 18;
const bumpRoad = (at: number): RoadSpec => ({ mu: TIRE.muDry, bumpAt: at });
const suspensionBeats: Beat[] = [
  {
    id: 'susp-parts',
    title: 'Holding the wheel',
    text: 'Each front wheel hangs on two wishbones. A coil spring carries the car’s weight, and the damper inside it controls how fast the wheel can move.',
    duration: 6,
    view: 'suspension-front',
    program: { start: () => presetCruise(30), drive: cruise(30), road: bumpRoad(BUMP_AT) },
    timeScale: 0.3,
    chapter: 'Suspension',
  },
  {
    id: 'susp-bump',
    title: 'Over a bump',
    text: 'The wheel rises over the bump and the spring compresses, storing the energy instead of passing the jolt to the body.',
    duration: 6,
    view: 'suspension-front',
    timeScale: 0.12,
    readouts: ['wheelTravel'],
  },
  {
    id: 'susp-settle',
    title: 'One movement, then calm',
    text: 'The damper turns the spring’s rebound into heat, so the wheel settles in a single movement and the body barely moves.',
    duration: 5,
    view: 'ride-side',
    timeScale: 0.3,
    readouts: ['wheelTravel', 'pitch'],
  },
  {
    id: 'susp-worn',
    title: 'With worn dampers',
    text: 'With worn front dampers the same bump leaves the wheels bouncing, and each bounce loosens the tyre’s grip on the road.',
    duration: 8,
    view: 'suspension-front',
    program: { start: () => presetCruise(30), drive: cruise(30), road: bumpRoad(9), faults: { ...NO_FAULTS, wornDamper: 0 } },
    timeScale: 0.2,
    readouts: ['wheelTravel'],
  },
];

// ───────────────────────────── 7. braking: without and with ABS ─────────────────────────────
const WET = { mu: TIRE.muWet };
const brakeBeats: Beat[] = [
  {
    id: 'brake-system',
    title: 'Pressure, not effort',
    text: 'Press the pedal and the booster multiplies the push. The master cylinder turns it into fluid pressure, carried to a caliper at each wheel.',
    duration: 7,
    view: 'brake-hydraulics',
    program: { start: () => presetCruise(60), drive: brakeAt(60, 1.2, 160) },
    timeScale: 0.5,
    chapter: 'Braking',
    readouts: ['kmh', 'brakeBar'],
  },
  {
    id: 'brake-heat',
    title: 'Motion into heat',
    text: 'The caliper squeezes the pads onto the disc. The car’s motion becomes heat: a hard stop from motorway speed can heat a disc by a hundred degrees.',
    duration: 6,
    view: 'brake-corner',
    timeScale: 0.5,
    readouts: ['brakeBar', 'discC'],
  },
  {
    id: 'lockup',
    title: 'Without ABS',
    text: 'In an emergency stop on a wet road without ABS, the wheels lock. A sliding tyre grips less and cannot steer: the car needs about 65 metres to stop from 80 km/h.',
    duration: 8.5,
    view: 'braking-side',
    program: { start: () => presetCruise(80), drive: brakeAt(80, 1.0, 500), road: WET, faults: { ...NO_FAULTS, absDisabled: true } },
    timeScale: 1,
    readouts: ['kmh', 'stopDistance', 'abs'],
  },
  {
    id: 'with-abs',
    title: 'With ABS',
    text: 'With ABS, each wheel’s pressure is released and re-applied many times a second, keeping the tyre just short of locking. The car stops in about 46 metres, and can still steer.',
    duration: 7.5,
    view: 'braking-side',
    program: { start: () => presetCruise(80), drive: brakeAt(80, 1.0, 500), road: WET },
    timeScale: 1,
    readouts: ['kmh', 'stopDistance', 'abs'],
  },
  {
    id: 'abs-close',
    title: 'Release, hold, apply',
    text: 'Slowed down, you can see the ABS unit pulse the pressure at the front wheel: release as the wheel starts to slow too quickly, hold, then apply again.',
    duration: 8,
    view: 'brake-corner',
    program: { start: () => presetCruise(80), drive: brakeAt(80, 0.25, 500), road: WET },
    timeScale: 0.08,
    readouts: ['brakeBar', 'abs'],
  },
];

// ───────────────────────────── 8. cooling and lubrication under load ─────────────────────────────
const coolingBeats: Beat[] = [
  {
    id: 'warm-up',
    title: 'Warming up',
    text: 'While the engine is cold the thermostat stays shut. The water pump sends coolant round the engine only, through the bypass, so it warms up quickly.',
    duration: 6,
    view: 'cooling-circuit',
    program: { start: warmAt(55), drive: idleInPark },
    timeScale: 1,
    chapter: 'Cooling and lubrication',
    readouts: ['coolantC', 'thermostat'],
  },
  {
    id: 'thermostat-opens',
    title: 'The thermostat opens',
    text: 'Under load the coolant passes 88 degrees. The wax in the thermostat melts and expands, opening the way to the radiator, where the air carries the heat away. Time is sped up here.',
    duration: 8,
    view: 'cooling-circuit',
    program: { start: warmAt(84, () => presetCruise(100)), drive: cruise(140, undefined, 0.4) },
    timeScale: 3,
    readouts: ['coolantC', 'thermostat', 'kmh'],
  },
  {
    id: 'fan',
    title: 'Stopped in traffic',
    text: 'Stopped in hot traffic, little air passes through the radiator. When the coolant passes 102 degrees, the electric fans switch on and pull air through it.',
    duration: 6,
    view: 'cooling-circuit',
    program: { start: warmAt(102.2), drive: idleInPark, road: { mu: TIRE.muDry, ambientC: 38 } },
    timeScale: 1,
    readouts: ['coolantC', 'fan'],
  },
  {
    id: 'oil',
    title: 'A film of oil',
    text: 'Meanwhile the oil pump draws oil from the pan and pushes it through the filter to every bearing, the camshafts and the chain. The parts never touch: they ride on a film of oil.',
    duration: 8,
    view: 'oil-circuit',
    program: { start: warmAt(92, () => presetCruise(100)), drive: cruise(100) },
    timeScale: 0.5,
    readouts: ['oilBar', 'oilC', 'rpm'],
  },
];

// ───────────────────────────── 9. charging and the data network ─────────────────────────────
const lightsOn = (at: number, amps: number) => (t: number, inp: Inputs) => {
  inp.ignition = true;
  inp.selector = 'P';
  inp.accessoriesAmps = t >= at ? amps : 8;
  inp.heater = t >= at;
};
const electricalBeats: Beat[] = [
  {
    id: 'charging',
    title: 'Charging',
    text: 'Once the engine runs, the belt-driven alternator powers the car and recharges the battery, holding the system at about 14 volts.',
    duration: 7,
    view: 'charging',
    // the headlights and blower (20 A) come on just after the next step starts; at idle the
    // alternator can carry that and still charge the battery, so the voltage holds (tested)
    program: { start: presetIdle, drive: lightsOn(7.3, 20) },
    timeScale: 1,
    chapter: 'Electrical and control',
    readouts: ['volts', 'alternatorAmps', 'batteryAmps'],
  },
  {
    id: 'load',
    title: 'More load',
    text: 'Switch on the headlights and the blower, and the alternator’s regulator raises its field to supply the extra current while the voltage holds.',
    duration: 6,
    view: 'charging',
    timeScale: 1,
    readouts: ['volts', 'alternatorAmps', 'batteryAmps'],
  },
  {
    id: 'can',
    title: 'The control units talk',
    text: 'The control units share information over a two-wire data network called CAN. The engine unit broadcasts engine speed and torque; the gearbox, brakes and instruments listen and answer.',
    duration: 8,
    view: 'network',
    program: { start: () => presetCruise(50), drive: cruise(50) },
    timeScale: 1,
    readouts: ['rpm', 'kmh', 'gear'],
  },
];

// ───────────────────────────── 10. taken apart and put back together ─────────────────────────────
const explodedBeats: Beat[] = [
  {
    id: 'assembled',
    title: 'One car',
    text: 'Every system you have seen sits inside this one body, packed into a space under five metres long.',
    duration: 5,
    view: 'overview',
    program: { start: presetIdle, drive: idleInPark },
    timeScale: 1,
    chapter: 'All together',
  },
  {
    id: 'explode',
    title: 'Taken apart',
    text: 'Taken apart, it is a few hundred major parts in ten systems: the body, the engine and its air, fuel and cooling, the driveline, the chassis, the brakes, the electrics and the cabin.',
    duration: 9,
    view: 'exploded',
    timeScale: 1,
  },
  {
    id: 'reassemble',
    title: 'Back together',
    text: 'Each one depends on the others. Together they turn a few grams of fuel into motion, every second.',
    duration: 7,
    view: 'hero',
    timeScale: 1,
  },
];

export const LESSONS: Record<string, Sequence> = {
  start: { id: 'start', title: 'Starting the engine', beats: startBeats },
  'four-stroke': { id: 'four-stroke', title: 'The four-stroke cycle', beats: strokeBeats },
  'firing-order': { id: 'firing-order', title: 'Firing order', beats: firingBeats },
  'torque-path': { id: 'torque-path', title: 'From crankshaft to road', beats: torqueBeats },
  differential: { id: 'differential', title: 'The differential in a corner', beats: diffBeats },
  suspension: { id: 'suspension', title: 'Suspension over a bump', beats: suspensionBeats },
  braking: { id: 'braking', title: 'Braking, with and without ABS', beats: brakeBeats },
  cooling: { id: 'cooling', title: 'Cooling and lubrication', beats: coolingBeats },
  electrical: { id: 'electrical', title: 'Charging and the data network', beats: electricalBeats },
  exploded: { id: 'exploded', title: 'Taken apart', beats: explodedBeats },
  slice: { id: 'slice', title: 'From the start button to the road', beats: [...startBeats, ...strokeBeats, ...torqueBeats] },
};

/** The ten hero sequences, in teaching order (Explore's “Show how it works” and the film). */
export const HERO_ORDER = ['start', 'four-stroke', 'firing-order', 'torque-path', 'differential', 'suspension', 'braking', 'cooling', 'electrical', 'exploded'] as const;
