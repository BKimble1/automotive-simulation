/**
 * The guided lessons ("Show how it works") and the scripts their car runs. Every step has a short
 * title, one or two sentences, one view (a visual focus) and the car doing the thing it explains.
 * The engine's own timing (sim/engine.ts) drives the cutaway, so the captions describe what is
 * actually on screen at that moment.
 */
import { presetCold, presetIdle, type CarState, type Inputs } from '../sim/car';
import type { Beat, Sequence } from '../world/sequence';

/** Hold the start button from `press` until the engine runs (the car's start-stop logic). */
function startScript(press: number) {
  return (t: number, inp: Inputs, s: CarState) => {
    inp.ignition = true;
    inp.selector = 'P';
    inp.start = t >= press && s.engine !== 'running' && t < press + 4;
  };
}

/** Idle, select Drive, then a firm, steady pull away. */
function pullAwayScript(drive: number, go: number, throttle = 0.55) {
  return (t: number, inp: Inputs) => {
    inp.ignition = true;
    inp.selector = t >= drive ? 'D' : 'P';
    inp.brakeN = t >= drive - 0.4 && t < go ? 120 : 0;
    inp.throttle = t >= go ? Math.min(throttle, (t - go) * 0.8) : 0;
  };
}

const startBeats: Beat[] = [
  {
    id: 'press',
    title: 'Press START',
    text: 'With the brake pedal held, the start button asks the body control module to wake the car and the engine control module to start the engine.',
    duration: 4.2,
    view: 'start-button',
    program: { start: presetCold, drive: startScript(3.9) },
    timeScale: 1,
    chapter: 'Starting',
  },
  {
    id: 'battery',
    title: 'The battery feeds the starter',
    text: 'The 12 V battery sends about 200 amps to the starter motor. The voltage dips while it works.',
    duration: 4.5,
    view: 'battery-starter',
    timeScale: 0.05,
  },
  {
    id: 'crank',
    title: 'The starter turns the crankshaft',
    text: 'The starter’s small pinion engages the ring gear on the flexplate and spins the crankshaft at about 200 rpm.',
    duration: 4.5,
    view: 'starter-flexplate',
    timeScale: 0.04,
  },
  {
    id: 'first-fire',
    title: 'Air, fuel, spark: the first firing',
    text: 'Once the sensors confirm where each piston is, the injectors spray fuel and the plugs fire. The first cylinders ignite and the engine starts turning on its own.',
    duration: 8,
    view: 'cylinder-cutaway',
    timeScale: 0.035,
    focusCyl: 0,
  },
  {
    id: 'idle',
    title: 'A stable idle',
    text: 'The starter disengages. The engine control module holds the speed near 750 rpm by adjusting the throttle.',
    duration: 4,
    view: 'firing-order',
    timeScale: { from: 0.05, to: 1, ramp: 2.5 },
  },
];

const strokeBeats: Beat[] = [
  {
    id: 'intake',
    title: 'Intake',
    text: 'The piston moves down and the intake valves are open, so air is drawn in. Near the bottom of the stroke the injector sprays fuel into the cylinder.',
    duration: 6,
    view: 'cylinder-cutaway',
    program: { start: presetIdle, drive: (_t, inp) => ((inp.ignition = true), (inp.selector = 'P')) },
    // one stroke (180° of crank, at idle) per step
    timeScale: 0.0067,
    focusCyl: 0,
    chapter: 'The four-stroke cycle',
  },
  {
    id: 'compression',
    title: 'Compression',
    text: 'Both valves close and the rising piston squeezes the mixture to about a thirteenth of its volume. Just before the top, the spark plug fires.',
    duration: 6,
    view: 'cylinder-cutaway',
    timeScale: 0.0067,
    focusCyl: 0,
  },
  {
    id: 'power',
    title: 'Power',
    text: 'The flame spreads from the plug and the pressure rises sharply. The hot gas drives the piston down, and through the connecting rod it turns the crankshaft.',
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
  {
    id: 'firing-order',
    title: 'Four cylinders, firing 1-3-4-2',
    text: 'With four cylinders there is a power stroke every half revolution, in the order 1-3-4-2. Pistons 1 and 4 move together, as do 2 and 3, so the pushes come evenly and the engine runs smoothly.',
    duration: 8,
    view: 'firing-order',
    timeScale: { from: 0.0067, to: 0.05, ramp: 3 },
  },
];

const driveBeats: Beat[] = [
  {
    id: 'torque-path',
    title: 'From crankshaft to road',
    text: 'In Drive, torque flows from the crankshaft through the torque converter and the gearbox, along the driveshaft, and into the differential.',
    duration: 6,
    view: 'torque-path',
    program: { start: presetIdle, drive: pullAwayScript(0.6, 2.4, 0.45) },
    timeScale: 1,
    chapter: 'To the road',
  },
  {
    id: 'converter',
    title: 'The torque converter',
    text: 'Fluid flung by the engine-driven impeller drives the turbine. While the car is slow, the stator redirects that fluid back to the impeller and multiplies the torque.',
    duration: 6,
    view: 'converter',
    timeScale: 0.25,
  },
  {
    id: 'differential',
    title: 'The differential',
    text: 'The pinion turns the ring gear at a 3.15 to 1 reduction and splits the torque between the two half shafts.',
    duration: 5,
    view: 'differential',
    timeScale: 0.35,
  },
  {
    id: 'contact',
    title: 'The tyres push the road',
    text: 'Each rear tyre grips the road over a contact patch about the size of a hand and pushes backward on it. The road pushes the car forward.',
    duration: 6,
    view: 'rear-contact',
    timeScale: 0.5,
  },
  {
    id: 'away',
    title: 'Motion',
    text: 'The engine’s combustion has become forward motion: 1,560 kg accelerating at about a third of g.',
    duration: 5,
    view: 'drive-away',
    timeScale: 1,
  },
];

export const LESSONS: Record<string, Sequence> = {
  slice: { id: 'slice', title: 'From the start button to the road', beats: [...startBeats, ...strokeBeats, ...driveBeats] },
  start: { id: 'start', title: 'Starting the engine', beats: startBeats },
  'four-stroke': { id: 'four-stroke', title: 'The four-stroke cycle', beats: strokeBeats },
  'torque-path': { id: 'torque-path', title: 'From crankshaft to road', beats: driveBeats },
};
