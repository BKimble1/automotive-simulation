/**
 * Runs: one complete description of what the car does, and one way to start it.
 *
 * A RunSpec names everything a run depends on: where it starts (a canonical state), the driver
 * (a script, or none for a person at the controls), the parameters, the faults, the road, the
 * initial inputs, how long it lasts and how fast it plays. initRun() resets the car to exactly
 * that, and nothing else: whatever is not specified takes its baseline value, so a run never
 * inherits a previous run's parameters, faults, road, inputs or controller memory. The same
 * function starts a lab's chart computation, its live playback, a scenario, a fault case, the
 * driving workbench and every chain of a lesson or the film, so they always agree.
 *
 * Everything is data except the start state builder and the driver script; those are rebuilt
 * from the run's id (and a lab's values) wherever the run is computed, including in a worker.
 */
import { Car, NO_FAULTS, cloneState, defaultInputs, defaultParams, makeRoad, configOf, DEFAULT_ROAD, type CarState, type Faults, type Inputs, type Params, type RoadSpec } from './car';
import { ELECTRICAL } from '../spec/vehicle';

export type Drive = (t: number, inp: Inputs, s: CarState) => void;

export interface RunSpec {
  /** Stable id (what produced the run: 'lab:braking', 'scenario:city', 'film:3', 'drive'). */
  id: string;
  start: () => CarState;
  /** The driver script; null when a person drives (the workbench). */
  drive?: Drive | null;
  params?: Partial<Params>;
  faults?: Partial<Faults>;
  road?: RoadSpec;
  /** Inputs at the start (the script sets them from its first step). */
  inputs?: Partial<Inputs>;
  /** Simulated seconds the run lasts, and an earlier end. */
  duration?: number;
  until?: (s: CarState, t: number) => boolean;
  /** Mechanical time per second of real time when it plays live. */
  timeScale?: number;
  /** Start again after this many simulated seconds (looping scenarios). */
  loop?: number;
}

/** The state a run starts from, adjusted for its configuration: settled loads, the faults' starting conditions. */
export function startState(spec: RunSpec, params: Params, faults: Faults): CarState {
  const s = cloneState(spec.start());
  const cfg = configOf(params);
  // the ride starts settled for this configuration: static tyre loads sum to its weight
  for (let i = 0; i < 4; i++) {
    if (s.wheelZ[i] === 0 && s.wheelZV[i] === 0) s.fz[i] = cfg.fzStatic[i];
  }
  // an aged battery starts the run partly discharged (a repair replaces it; see diagnosis)
  if (faults.weakBattery) {
    s.soc = Math.min(s.soc, 0.32);
    if (s.engine !== 'running') s.volts = ELECTRICAL.ocvEmpty + (ELECTRICAL.ocvFull - ELECTRICAL.ocvEmpty) * s.soc;
  }
  // the controllers' memory starts clean: no wheel-speed history from another run
  s.prevOmega = [...s.wheelOmega];
  s.absPhase = ['off', 'off', 'off', 'off'];
  s.absCount = [0, 0, 0, 0];
  s.absHold = [0, 0, 0, 0];
  s.absCycles = 0;
  s.ripple = null;
  return s;
}

/** Reset the car to exactly this run: state, configuration, inputs, driver. */
export function initRun(car: Car, spec: RunSpec) {
  const params: Params = { ...defaultParams(), ...(spec.params ?? {}) };
  const faults: Faults = { ...NO_FAULTS, ...(spec.faults ?? {}) };
  car.params = params;
  car.faults = faults;
  car.road = makeRoad(spec.road ?? DEFAULT_ROAD);
  const s = startState(spec, params, faults);
  car.restore(s);
  car.inputs = { ...defaultInputs(), ignition: s.engine === 'running', selector: s.selector, ...(spec.inputs ?? {}) };
  const drive = spec.drive ?? null;
  car.program = drive ? (t, inp, st) => drive(t, inp, st) : null;
  car.programId = spec.id;
  car.programT0 = car.s.t;
}

export interface Sample {
  [key: string]: number;
}

/**
 * Run a spec off screen, sampling every `every` simulated seconds until its duration or its
 * `until` (the same contract the live playback honours).
 */
export function simulate(spec: RunSpec, sample: (s: CarState, t: number, car: Car) => Sample, every = 0.05, car = new Car()): Sample[] {
  initRun(car, spec);
  const out: Sample[] = [];
  const duration = spec.duration ?? 10;
  const n = Math.round(duration / every);
  for (let i = 0; i <= n; i++) {
    const t = i * every;
    car.runTo(car.programT0 + t);
    out.push(sample(car.s, t, car));
    if (spec.until?.(car.s, t)) break;
  }
  return out;
}

/** Where a run ends (simulated seconds from its start), by the same rule as `simulate`. */
export function runEnd(samples: Sample[]): number {
  return samples.length ? samples[samples.length - 1].t : 0;
}
