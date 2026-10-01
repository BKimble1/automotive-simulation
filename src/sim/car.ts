/**
 * The car: every model composed and stepped together in fixed steps of simulated time
 * (STEP = 1 ms), so the same inputs give the same motion whatever the frame rate, and a
 * lesson can be re-simulated from its declared starting state to any moment (seeking).
 *
 * All dynamic state lives in one plain object (`CarState`): the bodies' motion and also the
 * controllers' memory (each ABS channel's phase, pressure, cycle count and hold timer, the
 * wheel speeds of the previous step it differentiates, the firing-pulse shape in use, the
 * geartrain's shaft angles). A snapshot is therefore a plain copy, and restoring one continues
 * exactly as if the run had never been interrupted (tested). The configuration a run uses
 * (inputs, parameters, faults, road) is set in one place, sim/run.ts, never inherited.
 *
 * What is modelled, briefly (constants in spec/vehicle.ts, assumptions in docs/ENGINEERING.md):
 *   engine        crank dynamics with the instantaneous gas torque of each cylinder at low
 *                 speed (so a misfire is felt as a speed dip), mean torque above; starter,
 *                 idle control, rev limiter, stall
 *   converter     impeller/turbine torques from the capacity factor, torque multiplication,
 *                 the stator's one-way clutch, lock-up clutch
 *   gearbox       four planetary gearsets and five shift elements (geartrain.ts): ratios from
 *                 tooth counts, shift schedule with hysteresis, clutch-to-clutch shifts with an
 *                 inertia phase, park pawl, neutral, reverse
 *   rear axle     open differential: the carrier carries the drive (with the drivetrain's
 *                 reflected inertia), the wheels share its torque equally and may turn at
 *                 different speeds
 *   tyres         slip ratio and slip angle per wheel, combined grip, loads from the ride model
 *   body          longitudinal, lateral and yaw motion about the centre of mass, and a
 *                 7-degree-of-freedom ride model: heave, pitch, roll and four wheels on springs,
 *                 dampers, anti-roll bars and tyre springs; static loads from the configured
 *                 mass and its distribution
 *   brakes        pedal → master cylinder → calipers, proportioning, ABS per wheel, rotor heat
 *                 and pad fade
 *   cooling, oil, 12 V electrical (systems.ts)
 */
import { BODY, BRAKES, CONVERTER, ELECTRICAL, ENGINE, GEARBOX, MASS, STEERING, SUSPENSION, TIRE, AIR_DENSITY, G, units } from '../spec/vehicle';
import { airMassFlow, fuelMassFlow, FUEL_LHV, frictionTorque, indicatedTorque, manifoldPressure, phaseDeg, sparkPhase, torqueRipple, CYCLE, fullLoadTorque } from './engine';
import { converterTorqueRatio, downshiftRpm, gearRatio, impellerTorque, statorHeld, upshiftRpm, DIFF } from './drivetrain';
import { appliedElements, geartrainSpeeds, type Element, type GeartrainSpeeds } from './geartrain';
import { slipRatio, tireForces } from './tire';
import { AbsChannel, brakeTorque, Cooling, Electrical, Lubrication, masterPressure, padMu, rearPressureFactor, type AbsPhase } from './systems';

export const STEP = 0.001;

export type Selector = 'P' | 'R' | 'N' | 'D';
export type EngineMode = 'off' | 'cranking' | 'running';

export interface Inputs {
  ignition: boolean;
  /** Start button held. The car cranks while it is held and the engine has not started. */
  start: boolean;
  throttle: number;
  /** Brake pedal force, N (about 150 N is firm, 500 N an emergency stop). */
  brakeN: number;
  /** Steering-wheel angle, rad (positive turns left). */
  steer: number;
  /** The selector position the driver asks for (the gearbox may refuse it: see `CarState.selector`). */
  selector: Selector;
  heater: boolean;
  /** Extra electrical load (lights, fan, heated glass…), A. */
  accessoriesAmps: number;
  /** Hold this gear in Drive (the selector's manual mode; 0 = automatic shifting). */
  manualGear: number;
  /** Ask for the converter's lock-up clutch whenever a gear is engaged and the car is moving (manual mode). */
  lockup: boolean;
}

export interface Faults {
  /** A cylinder (0-based) whose spark is lost, or −1. */
  misfireCyl: number;
  thermostatStuckClosed: boolean;
  fanFailed: boolean;
  lowCoolant: boolean;
  lowOil: boolean;
  wornBearings: boolean;
  /** An aged battery: higher internal resistance (its low charge is part of the run's start). */
  weakBattery: boolean;
  alternatorFailed: boolean;
  /** A worn damper at a corner (0 FL, 1 FR, 2 RL, 3 RR), or −1. */
  wornDamper: number;
  absDisabled: boolean;
  /** Pads that fade early (a lower fade threshold), for the brake fade lesson. */
  fadeProne: boolean;
}

export const NO_FAULTS: Faults = {
  misfireCyl: -1,
  thermostatStuckClosed: false,
  fanFailed: false,
  lowCoolant: false,
  lowOil: false,
  wornBearings: false,
  weakBattery: false,
  alternatorFailed: false,
  wornDamper: -1,
  absDisabled: false,
  fadeProne: false,
};

/**
 * The road as data (so a run can be described, compared and sent to a worker): friction, an
 * optional bump across the lane, an optional left-hand arc, the air temperature. The physics
 * (makeRoad) and the drawn road (scene/road.ts) are both built from it.
 */
export interface RoadSpec {
  mu: number;
  ambientC?: number;
  /** A smooth bump across the lane, centred `bumpAt` metres along the path. */
  bumpAt?: number;
  bumpHeight?: number;
  bumpLength?: number;
  /** Curvature of the arc (1/m, positive left) and where it begins (road x, m). */
  curve?: number;
  curveX?: number;
}

export const DEFAULT_ROAD: RoadSpec = { mu: TIRE.muDry, ambientC: 25 };

/** The road the model drives on: friction and the height under each side at distance s. */
export interface Road {
  spec: RoadSpec;
  mu: number;
  ambientC: number;
  height: ((s: number, side: -1 | 1) => number) | null;
}

export function makeRoad(spec: RoadSpec = DEFAULT_ROAD): Road {
  const sp = { ...spec };
  let height: Road['height'] = null;
  if (sp.bumpAt !== undefined) {
    const H = sp.bumpHeight ?? 0.07;
    const half = (sp.bumpLength ?? 0.7) / 2;
    const at = sp.bumpAt;
    height = (s: number) => {
      const d = s - at;
      return Math.abs(d) < half ? H * 0.5 * (1 + Math.cos((Math.PI * d) / half)) : 0;
    };
  }
  return { spec: sp, mu: sp.mu, ambientC: sp.ambientC ?? 25, height };
}

/** Engineering parameters a lab may change (defaults from spec/vehicle.ts). */
export interface Params {
  finalDrive: number;
  wheelRateFront: number;
  wheelRateRear: number;
  dampingFront: number;
  dampingRear: number;
  steeringRatio: number;
  /** Total mass with the driver, kg, and the share of it on the front axle. */
  mass: number;
  frontShare: number;
  cgHeight: number;
  biasFront: number;
  muScale: number;
}

export function defaultParams(): Params {
  return {
    finalDrive: GEARBOX.finalDrive,
    wheelRateFront: SUSPENSION.wheelRateFront,
    wheelRateRear: SUSPENSION.wheelRateRear,
    dampingFront: SUSPENSION.dampingFront,
    dampingRear: SUSPENSION.dampingRear,
    steeringRatio: STEERING.ratio,
    mass: MASS.total,
    frontShare: MASS.frontShare,
    cgHeight: MASS.cgHeight,
    biasFront: BRAKES.biasFront,
    muScale: 1,
  };
}

/** Wheel order everywhere: front left, front right, rear left, rear right. */
export const WHEELS = [
  { x: BODY.xFront, z: -BODY.trackFront / 2, front: true },
  { x: BODY.xFront, z: BODY.trackFront / 2, front: true },
  { x: BODY.xRear, z: -BODY.trackRear / 2, front: false },
  { x: BODY.xRear, z: BODY.trackRear / 2, front: false },
] as const;

/**
 * What a configuration implies for the body (derived from Params, recomputed when they change).
 *
 * Assumptions, stated: mass added or removed sits at the designed centre of mass unless the
 * front share is changed; the unsprung masses stay as designed; the sprung mass's pitch, roll
 * and yaw inertias scale with it (the same radii of gyration). The suspension's ride height is
 * taken as set for the configured load (spring seats adjusted), so every configuration starts
 * settled at the same height, with static tyre loads that sum to its weight.
 */
export interface CarConfig {
  m: number;
  /** Sprung mass, kg. */
  ms: number;
  /** Centre of mass: x (vehicle frame), height, distances to the front and rear axles. */
  xCg: number;
  hCg: number;
  a: number;
  b: number;
  /** Static load on each tyre, N (sums to m·g). */
  fzStatic: number[];
  /** Wheel x relative to the centre of mass, m. */
  xr: number[];
  yawInertia: number;
  pitchInertia: number;
  rollInertia: number;
}

export function configOf(P: Params): CarConfig {
  const m = P.mass;
  const fs = P.frontShare;
  const L = BODY.wheelbase;
  const a = L * (1 - fs);
  const b = L * fs;
  const xCg = BODY.xFront - a;
  const unsprung = 2 * MASS.unsprungFront + 2 * MASS.unsprungRear;
  const ms = m - unsprung;
  const k = ms / (MASS.total - unsprung);
  return {
    m,
    ms,
    xCg,
    hCg: P.cgHeight,
    a,
    b,
    fzStatic: WHEELS.map((w) => (m * G * (w.front ? fs : 1 - fs)) / 2),
    xr: WHEELS.map((w) => w.x - xCg),
    yawInertia: MASS.yawInertia * (m / MASS.total),
    pitchInertia: MASS.pitchInertia * k,
    rollInertia: MASS.rollInertia * k,
  };
}

export interface CarState {
  t: number;
  /** The selector position in effect (the driver's request, once the gearbox allows it). */
  selector: Selector;
  engine: EngineMode;
  /** Crank angle (rad, kept within one 720° cycle) and speed (rad/s). */
  crank: number;
  omegaE: number;
  /** Total crank revolutions while cranking (sensor sync before the first injection). */
  crankRevs: number;
  /** Time since the engine started (fast idle after a start). */
  sinceStart: number;
  idleI: number;
  /** Throttle the engine actually gets (driver or idle control), 0 … 1. */
  throttleEff: number;
  map: number;
  /** Combustion strength per cylinder, 0 … 1 (0: misfire or not firing). */
  combustion: number[];
  /** Number of combustion events so far (for the first-fire moment). */
  fires: number;
  limiter: boolean;
  /** The firing-pulse shape in use (it is re-derived when the conditions change): its inputs. */
  ripple: { map: number; spark: number; comb: number[]; t: number } | null;
  // drivetrain
  gear: number;
  /** Gear being shifted to, and the shift's progress (0 … 1; 1 = done). */
  gearTarget: number;
  shift: number;
  /** Ratio in use (moves from the old ratio to the new one in a shift's inertia phase). */
  ratio: number;
  lockup: number;
  /** Turbine speed (rad/s) and angles of the converter's members, the driveshaft and the diff. */
  omegaT: number;
  turbineAngle: number;
  /** The stator: held by its one-way clutch while the converter multiplies torque, freewheeling above. */
  statorAngle: number;
  driveshaftAngle: number;
  carrierAngle: number;
  spiderAngle: number;
  /** The geartrain's eight shaft angles (geartrain.SHAFTS order) and each set's planet spin. */
  gt: number[];
  gtPlanet: number[];
  // wheels: spin angle (rad, forward rolling positive) and speed (rad/s)
  wheelAngle: number[];
  wheelOmega: number[];
  /** Wheel speeds one step earlier (the ABS reads wheel deceleration from them). */
  prevOmega: number[];
  /** Road-wheel steer angles, rad (positive left). */
  steerAngle: number[];
  steerWheel: number;
  // body motion in the car frame: forward speed, rightward speed, yaw rate (positive left)
  u: number;
  w: number;
  r: number;
  ax: number;
  az: number;
  /** World pose: position and heading (rad, positive left), distance travelled along the path. */
  X: number;
  Z: number;
  heading: number;
  s: number;
  // ride: heave (m), pitch (rad, nose up +), roll (rad, right side down +) and rates
  heave: number;
  pitch: number;
  roll: number;
  heaveV: number;
  pitchV: number;
  rollV: number;
  /** Wheel vertical displacement from rest (m) and speed. */
  wheelZ: number[];
  wheelZV: number[];
  /** Tyre loads, N, and grip use (0 … 1+). */
  fz: number[];
  fx: number[];
  fy: number[];
  slip: number[];
  slipAngle: number[];
  gripUse: number[];
  // brakes
  linePa: number;
  caliperPa: number[];
  /** ABS channels: phase, cycles counted this stop, hold timer (s). */
  absPhase: AbsPhase[];
  absCount: number[];
  absHold: number[];
  absCycles: number;
  rotorC: number[];
  brakePowerW: number;
  // systems
  coolantC: number;
  thermostat: number;
  fanOn: boolean;
  /** The electric fans' speed (rad/s, spinning up and down) and angle. */
  fanSpeed: number;
  fanAngle: number;
  radiatorFlow: number;
  bypassFlow: number;
  oilC: number;
  oilBar: number;
  oilStarving: boolean;
  soc: number;
  volts: number;
  batteryAmps: number;
  alternatorAmps: number;
  starterAmps: number;
  ecuPowered: boolean;
  /**
   * Integrated quantities for drawing flows: each advances with its modelled rate (and stands
   * still when the rate is zero), so a seek reconstructs the same picture.
   */
  phase: { air: number; fuel: number; exhaust: number; oil: number; coolant: number; bypass: number; power: number; signal: number; brake: number; heater: number; converter: number; radiatorAir: number; torque: number; refrigerant: number; cabinAir: number };
  // derived readouts
  engineTorque: number;
  wheelTorque: number;
  fuelGs: number;
  airGs: number;
  /** Lambda and the closed-loop fuel trim (%), from the oxygen sensor. */
  lambda: number;
  fuelTrim: number;
  /** Misfire counter seen by the ECU (crank speed variation). */
  misfireCount: number;
  /** Warnings shown on the cluster. */
  warnings: { engine: boolean; oil: boolean; battery: boolean; temp: boolean; abs: boolean; brake: boolean };
  stoppingFrom: number;
  stopDistance: number;
}

function zeros(n: number) {
  return new Array(n).fill(0);
}

export function initialState(): CarState {
  const cfg = configOf(defaultParams());
  return {
    t: 0,
    selector: 'P',
    engine: 'off',
    crank: 0,
    omegaE: 0,
    crankRevs: 0,
    sinceStart: 0,
    idleI: 0,
    throttleEff: 0,
    map: 1.013e5,
    combustion: zeros(4),
    fires: 0,
    limiter: false,
    ripple: null,
    gear: 0,
    gearTarget: 0,
    shift: 1,
    ratio: 0,
    lockup: 0,
    omegaT: 0,
    turbineAngle: 0,
    statorAngle: 0,
    driveshaftAngle: 0,
    carrierAngle: 0,
    spiderAngle: 0,
    gt: zeros(8),
    gtPlanet: zeros(4),
    wheelAngle: zeros(4),
    wheelOmega: zeros(4),
    prevOmega: zeros(4),
    steerAngle: zeros(4),
    steerWheel: 0,
    u: 0,
    w: 0,
    r: 0,
    ax: 0,
    az: 0,
    X: 0,
    Z: 0,
    heading: 0,
    s: 0,
    heave: 0,
    pitch: 0,
    roll: 0,
    heaveV: 0,
    pitchV: 0,
    rollV: 0,
    wheelZ: zeros(4),
    wheelZV: zeros(4),
    fz: [...cfg.fzStatic],
    fx: zeros(4),
    fy: zeros(4),
    slip: zeros(4),
    slipAngle: zeros(4),
    gripUse: zeros(4),
    linePa: 0,
    caliperPa: zeros(4),
    absPhase: ['off', 'off', 'off', 'off'],
    absCount: zeros(4),
    absHold: zeros(4),
    absCycles: 0,
    rotorC: [25, 25, 25, 25],
    brakePowerW: 0,
    coolantC: 25,
    thermostat: 0,
    fanOn: false,
    fanSpeed: 0,
    fanAngle: 0,
    radiatorFlow: 0,
    bypassFlow: 0,
    oilC: 25,
    oilBar: 0,
    oilStarving: false,
    soc: 0.9,
    volts: ELECTRICAL.ocvFull,
    batteryAmps: 0,
    alternatorAmps: 0,
    starterAmps: 0,
    ecuPowered: false,
    phase: { air: 0, fuel: 0, exhaust: 0, oil: 0, coolant: 0, bypass: 0, power: 0, signal: 0, brake: 0, heater: 0, converter: 0, radiatorAir: 0, torque: 0, refrigerant: 0, cabinAir: 0 },
    engineTorque: 0,
    wheelTorque: 0,
    fuelGs: 0,
    airGs: 0,
    lambda: 1,
    fuelTrim: 0,
    misfireCount: 0,
    warnings: { engine: false, oil: false, battery: false, temp: false, abs: false, brake: false },
    stoppingFrom: 0,
    stopDistance: 0,
  };
}

export function defaultInputs(): Inputs {
  return { ignition: false, start: false, throttle: 0, brakeN: 0, steer: 0, selector: 'P', heater: false, accessoriesAmps: 0, manualGear: 0, lockup: false };
}

/** A deep copy (state objects hold only numbers, strings, booleans and arrays of them). */
export function cloneState(s: CarState): CarState {
  return structuredClone(s);
}

/** Why a selector position is not available now ('' when it is). */
export function selectorRefusal(s: CarState, want: Selector): string {
  const kmh = units.msToKmh(s.u);
  if (want === s.selector) return '';
  if (want === 'P' && Math.abs(kmh) > 3) return 'Park engages only when the car has stopped.';
  if (want === 'R' && kmh > 5) return 'Reverse engages only below 5 km/h forward.';
  if (want === 'D' && kmh < -5) return 'Drive engages only below 5 km/h in reverse.';
  return '';
}

/**
 * Everything a run needs to continue exactly: the state, the configuration, and the time not
 * yet stepped. Plain data (the driver script is reattached by whoever owns it, by its id).
 */
export interface CarSnapshot {
  state: CarState;
  inputs: Inputs;
  params: Params;
  faults: Faults;
  road: RoadSpec;
  programId: string | null;
  programT0: number;
  acc: number;
}

const RW = TIRE.rollingRadius;
/** Inertia of the turbine, gearbox internals and driveshaft (at the turbine), kg·m². */
const DRIVE_INERTIA = 0.09;
const ENGINE_OFF_DECAY = 6;
const TWO_PI = 2 * Math.PI;
const wrapBig = (a: number) => (a > 1e4 || a < -1e4 ? a % TWO_PI : a);

export class Car {
  s: CarState;
  prev: CarState;
  inputs: Inputs = defaultInputs();
  faults: Faults = { ...NO_FAULTS };
  road: Road = makeRoad();
  private _params: Params = defaultParams();
  /** Derived from the parameters (recomputed when they are set). */
  config: CarConfig = configOf(this._params);
  /**
   * A scripted driver: called before every fixed step with the time since the script started
   * (s of simulated time), so the same script gives the same motion however time is stepped.
   */
  program: ((t: number, inputs: Inputs, s: CarState) => void) | null = null;
  /** The id of the run the program belongs to (for snapshots and telemetry). */
  programId: string | null = null;
  programT0 = 0;
  /** Accumulated simulated time not yet stepped. */
  private acc = 0;
  private cooling = new Cooling();
  private oil = new Lubrication();
  private elec = new Electrical();
  private abs = [new AbsChannel(), new AbsChannel(), new AbsChannel(), new AbsChannel()];
  private ripple: ((theta: number) => number) | null = null;
  private gts: GeartrainSpeeds = { shaft: zeros(8), planet: zeros(4), slip: { A: 0, B: 0, C: 0, D: 0, E: 0 } };

  constructor(state?: CarState) {
    this.s = state ? cloneState(state) : initialState();
    this.prev = cloneState(this.s);
    this.syncHelpers();
  }

  get params(): Params {
    return this._params;
  }
  /** Setting the parameters re-derives the configuration (static loads, centre of mass, inertias). */
  set params(p: Params) {
    this._params = p;
    this.config = configOf(p);
  }

  /** Restore an exact state (a lesson's starting point, or a seek). The configuration is kept. */
  restore(state: CarState) {
    this.s = cloneState(state);
    this.prev = cloneState(this.s);
    this.acc = 0;
    this.syncHelpers();
  }

  snapshot(): CarState {
    return cloneState(this.s);
  }

  /** The whole run as data. */
  save(): CarSnapshot {
    return {
      state: cloneState(this.s),
      inputs: { ...this.inputs },
      params: { ...this._params },
      faults: { ...this.faults },
      road: { ...this.road.spec },
      programId: this.programId,
      programT0: this.programT0,
      acc: this.acc,
    };
  }

  /** Load a saved run; its driver script is reattached by the caller (`program`, by `programId`). */
  load(snap: CarSnapshot) {
    this.params = { ...snap.params };
    this.faults = { ...snap.faults };
    this.road = makeRoad(snap.road);
    this.inputs = { ...snap.inputs };
    this.programId = snap.programId;
    this.programT0 = snap.programT0;
    this.restore(snap.state);
    this.acc = snap.acc;
  }

  /** The helper models read their memory from the state (they keep none of their own between steps). */
  private syncHelpers() {
    const s = this.s;
    this.cooling.coolantC = s.coolantC;
    this.cooling.thermostat = s.thermostat;
    this.cooling.fanOn = s.fanOn;
    this.oil.oilC = s.oilC;
    this.oil.pressureBar = s.oilBar;
    this.elec.soc = s.soc;
    this.elec.volts = s.volts;
    for (let i = 0; i < 4; i++) this.abs[i].load(s.absPhase[i], s.caliperPa[i], s.absCount[i], s.absHold[i]);
    this.ripple = s.ripple ? torqueRipple(s.ripple.map, s.ripple.spark, s.ripple.comb, 1) : null;
  }

  /**
   * Advance simulated time by `dt` seconds in fixed steps. Returns the interpolation factor
   * (0 … 1) between `prev` and `s` for drawing. At most `maxSteps` steps run in one call (the
   * rest of the time is dropped, not owed): a stalled frame never makes the car race to catch up.
   */
  advance(dt: number, maxSteps = 250): number {
    this.acc += Math.max(0, dt);
    let n = 0;
    while (this.acc >= STEP - 1e-12) {
      if (n === 0 || this.acc < 2 * STEP) this.copyPrev();
      this.step();
      this.acc -= STEP;
      n++;
      if (n >= maxSteps) {
        this.acc = Math.min(this.acc, STEP * 0.999);
        break;
      }
    }
    return Math.min(1, this.acc / STEP);
  }

  /**
   * Step until simulated time reaches `t` (absolute), keeping the last two states for drawing.
   * Returns the interpolation factor (0 … 1) for the remainder.
   */
  advanceTo(t: number, maxSteps = 20000): number {
    let n = 0;
    while (this.s.t + STEP <= t + 1e-9) {
      this.copyPrev();
      this.step();
      if (++n >= maxSteps) break;
    }
    this.acc = 0;
    return Math.max(0, Math.min(1, (t - this.s.t) / STEP));
  }

  /** Run until simulated time reaches `t` (from the current state). */
  runTo(t: number) {
    while (this.s.t < t - 1e-9) {
      this.copyPrev();
      this.step();
    }
    this.acc = 0;
  }

  private copyPrev() {
    const p = this.prev;
    const s = this.s;
    // only what drawing interpolates
    p.t = s.t;
    p.crank = s.crank;
    p.turbineAngle = s.turbineAngle;
    p.statorAngle = s.statorAngle;
    p.fanAngle = s.fanAngle;
    p.driveshaftAngle = s.driveshaftAngle;
    p.carrierAngle = s.carrierAngle;
    p.spiderAngle = s.spiderAngle;
    for (let i = 0; i < 8; i++) p.gt[i] = s.gt[i];
    for (let i = 0; i < 4; i++) {
      p.gtPlanet[i] = s.gtPlanet[i];
      p.wheelAngle[i] = s.wheelAngle[i];
      p.wheelZ[i] = s.wheelZ[i];
      p.steerAngle[i] = s.steerAngle[i];
    }
    p.heave = s.heave;
    p.pitch = s.pitch;
    p.roll = s.roll;
    p.X = s.X;
    p.Z = s.Z;
    p.heading = s.heading;
    p.s = s.s;
    p.steerWheel = s.steerWheel;
    Object.assign(p.phase, s.phase);
  }

  // ─────────────────────────────────── one step ───────────────────────────────────
  step() {
    const s = this.s;
    const h = STEP;
    if (this.program) this.program(s.t - this.programT0, this.inputs, s);
    const inp = this.inputs;
    const f = this.faults;
    const P = this._params;
    const cfg = this.config;
    s.t += h;

    // ── the selector: the driver's request, once the gearbox allows it
    if (inp.selector !== s.selector && !selectorRefusal(s, inp.selector)) s.selector = inp.selector;
    const sel = s.selector;

    // ── electrical first: the starter and the ECU need volts
    const cranking = inp.ignition && inp.start && s.engine !== 'running' && (sel === 'P' || sel === 'N');
    const accessories = inp.accessoriesAmps + (this.cooling.fanOn ? 22 : 0) + Math.abs(inp.steer) * 6;
    this.elec.step(h, inp.ignition, cranking, units.radToRpm(s.omegaE), accessories, f);
    s.soc = this.elec.soc;
    s.volts = this.elec.volts;
    s.batteryAmps = this.elec.batteryAmps;
    s.alternatorAmps = this.elec.alternatorAmps;
    s.starterAmps = this.elec.starterAmps;
    s.ecuPowered = this.elec.ecuPowered;

    // ── engine
    const rpm = units.radToRpm(s.omegaE);
    if (!inp.ignition && s.engine === 'running') s.engine = 'off';
    if (cranking && s.engine === 'off') {
      s.engine = 'cranking';
      s.crankRevs = 0;
    }
    if (s.engine === 'cranking' && !cranking) s.engine = rpm > 400 ? 'running' : 'off';

    // idle control and the throttle the engine gets
    let throttle = inp.throttle;
    const fastIdle = s.engine === 'running' ? 450 * Math.exp(-s.sinceStart / 1.6) * (s.coolantC < 60 ? 1 : 0.6) : 0;
    const idleTarget = ENGINE.idleRpm + fastIdle;
    if (s.engine === 'running') {
      const e = (idleTarget - rpm) / 1000;
      s.idleI = Math.max(-0.05, Math.min(0.15, s.idleI + e * h * 0.6));
      const idleThrottle = Math.max(0, Math.min(0.2, 0.035 + e * 0.12 + s.idleI));
      throttle = Math.max(throttle, idleThrottle);
    } else s.idleI = 0;
    if (s.engine === 'cranking') throttle = 0.04;
    s.throttleEff += (throttle - s.throttleEff) * Math.min(1, h * 25);
    s.map = manifoldPressure(s.throttleEff, Math.max(150, rpm));

    // fuel and spark: the ECU fires a cylinder when it is powered and has found from the crank
    // and cam sensors where each piston is (about two revolutions of cranking), below the limiter
    const fuelling = (s.engine === 'running' || (s.engine === 'cranking' && s.crankRevs > 2 && s.ecuPowered && rpm > 120)) && s.ecuPowered;
    if (rpm > ENGINE.limiterRpm) s.limiter = true;
    else if (rpm < ENGINE.limiterRpm - 150) s.limiter = false;
    let share = 0;
    for (let i = 0; i < 4; i++) {
      const on = fuelling && !s.limiter && f.misfireCyl !== i ? 1 : 0;
      s.combustion[i] = on;
      share += on / 4;
    }
    const spark = sparkPhase(Math.min(1, (s.map - 0.25e5) / 0.75e5), rpm);
    const meanIndicated = share > 0 ? indicatedTorque(Math.max(rpm, 300), s.map, 1) * share : 0;
    const friction = frictionTorque(rpm, this.oil.oilC) * (f.wornBearings ? 1.08 : 1);
    // instantaneous gas torque at low speed (firing pulses, a misfire's dip), the mean above;
    // the pulse shape is re-derived when the conditions change or a quarter second has passed,
    // and what it was derived from is part of the state (so a restored run matches)
    let gas = meanIndicated;
    if (rpm < 2500 && share > 0) {
      const rp = s.ripple;
      const stale = !rp || !this.ripple || Math.round(rp.map / 2000) !== Math.round(s.map / 2000) || Math.round(rp.spark) !== Math.round(spark) || rp.comb.some((c, i) => c !== s.combustion[i]) || s.t - rp.t > 0.25;
      if (stale) {
        s.ripple = { map: s.map, spark, comb: [...s.combustion], t: s.t };
        this.ripple = torqueRipple(s.map, spark, s.combustion, 1);
      }
      const k = Math.max(0, 1 - Math.max(0, rpm - 1500) / 1000);
      gas = meanIndicated * (1 - k + k * this.ripple!(s.crank));
    }
    // starter: a torque that falls to zero at the cranking speed the battery can reach
    const crankRpm = this.elec.crankingRpm();
    const starter = cranking ? Math.max(0, 110 * (1 - rpm / Math.max(1, crankRpm))) : 0;
    // alternator load
    const alt = s.alternatorAmps > 0 && s.omegaE > 1 ? (s.alternatorAmps * s.volts) / 0.55 / s.omegaE : 0;

    // ── converter, lock-up, gearbox
    const inGear = sel === 'D' || sel === 'R';
    if (sel === 'D' && s.gear <= 0) {
      s.gear = 1;
      s.gearTarget = 1;
      s.shift = 1;
    }
    if (sel === 'R') {
      s.gear = -1;
      s.gearTarget = -1;
      s.shift = 1;
    }
    if (!inGear) {
      s.gear = 0;
      s.gearTarget = 0;
      s.shift = 1;
    }
    // automatic shifting (from the turbine's speed, with hysteresis), or the gear the driver holds
    const turbRpm = units.radToRpm(Math.abs(s.omegaT));
    const held = sel === 'D' && inp.manualGear >= 1 ? Math.min(8, Math.round(inp.manualGear)) : 0;
    if (held && s.shift >= 1 && s.gear !== held) {
      s.gearTarget = s.gear + Math.sign(held - s.gear);
      s.shift = 0;
    } else if (sel === 'D' && !held && s.shift >= 1) {
      const up = upshiftRpm(inp.throttle);
      const down = downshiftRpm(inp.throttle);
      if (s.gear < 8 && turbRpm > up && s.u > 1) {
        s.gearTarget = s.gear + 1;
        s.shift = 0;
      } else if (s.gear > 1) {
        const rpmLower = turbRpm * (gearRatio(s.gear - 1) / gearRatio(s.gear));
        if (turbRpm < down && rpmLower < up * 0.9) {
          s.gearTarget = s.gear - 1;
          s.shift = 0;
        }
      }
    }
    if (s.shift < 1) {
      s.shift = Math.min(1, s.shift + h / GEARBOX.shiftTime);
      if (s.shift >= 1) s.gear = s.gearTarget;
    }
    // the inertia phase: the input speed moves from the old ratio to the new one
    const r0 = inGear ? gearRatio(s.gear) : 0;
    const r1 = inGear ? gearRatio(s.gearTarget) : 0;
    const u2 = s.shift * s.shift * (3 - 2 * s.shift);
    s.ratio = r0 + (r1 - r0) * u2;
    const fd = P.finalDrive;
    // lock-up clutch: from 3rd gear, above the lock-up speed, not under hard throttle from low speed
    const wantLock = (sel === 'D' && s.gear >= 3 && s.shift >= 1 && units.msToKmh(s.u) > CONVERTER.lockupKmh && !(inp.throttle > 0.85 && s.gear <= 4) && inp.brakeN < 300) || (inp.lockup && inGear && s.shift >= 1 && Math.abs(s.u) > 3);
    s.lockup += ((wantLock ? 1 : 0) - s.lockup) * Math.min(1, h * (wantLock ? 2.2 : 8));

    // ── rear axle carrier speed and the turbine (kinematically tied through the gearbox)
    const omegaC = (s.wheelOmega[2] + s.wheelOmega[3]) / 2;
    const parked = sel === 'P';
    s.omegaT = inGear ? omegaC * fd * s.ratio : s.omegaT * Math.exp(-h * 2) + (s.omegaE - s.omegaT) * Math.min(1, h * 3);
    // converter torques (signed, rpm in → N·m)
    const impRpm = units.radToRpm(s.omegaE);
    const tRpm = units.radToRpm(s.omegaT);
    let tp = 0;
    let tt = 0;
    if (impRpm > 1 || Math.abs(tRpm) > 1) {
      tp = impellerTorque(Math.max(0, impRpm), Math.max(0, tRpm));
      const sr = impRpm > 1 ? Math.max(0, tRpm) / impRpm : 1;
      tt = tp >= 0 ? tp * converterTorqueRatio(sr) : tp;
    }
    // the lock-up clutch: torque from slip, up to its capacity
    const slipW = s.omegaE - s.omegaT;
    const lockTorque = s.lockup * Math.max(-600, Math.min(600, slipW * 60));
    // engine shaft
    const loadE = (inGear ? tp + lockTorque : tp * 0.05) + alt;
    s.engineTorque = gas - friction;
    if (s.engine === 'off') {
      // spinning down on friction alone
      s.omegaE -= Math.sign(s.omegaE) * Math.min(Math.abs(s.omegaE), (ENGINE_OFF_DECAY + friction / ENGINE.inertia) * h);
      if (Math.abs(s.omegaE) < 0.05) s.omegaE = 0;
    } else {
      const net = gas - friction + starter - loadE;
      s.omegaE += (net / ENGINE.inertia) * h;
      if (s.omegaE < 0) s.omegaE = 0;
    }
    if (s.engine === 'cranking') {
      s.crankRevs += (s.omegaE * h) / TWO_PI;
      if (rpm > 480 && s.fires > 3) {
        s.engine = 'running';
        s.sinceStart = 0;
      }
    }
    if (s.engine === 'running') {
      s.sinceStart += h;
      if (rpm < 280) s.engine = 'off'; // stalled
    }
    // count combustion events (first fire, misfire detection)
    const prevCrank = s.crank;
    s.crank += s.omegaE * h;
    for (let i = 0; i < 4; i++) {
      const sp = spark * (Math.PI / 180);
      const a = phaseDeg(i, prevCrank) * (Math.PI / 180);
      const b = phaseDeg(i, s.crank) * (Math.PI / 180);
      if (a < sp && b >= sp && s.omegaE > 0) {
        if (s.combustion[i] > 0) s.fires++;
        else if (fuelling && f.misfireCyl === i) s.misfireCount++;
      }
    }
    if (s.crank >= CYCLE) s.crank -= CYCLE;

    // ── torque to the rear axle
    const driveTorqueT = inGear ? tt + lockTorque : 0; // at the turbine/gearbox input
    const ringTorque = driveTorqueT * s.ratio * fd * GEARBOX.efficiency;
    s.wheelTorque = ringTorque;
    const reflected = DRIVE_INERTIA * Math.pow(s.ratio * fd, 2);

    // ── steering (Ackermann), within the rack's travel
    const maxWheel = STEERING.maxWheelAngle;
    s.steerWheel = Math.max(-maxWheel * P.steeringRatio, Math.min(maxWheel * P.steeringRatio, inp.steer));
    const delta = s.steerWheel / P.steeringRatio;
    const L = BODY.wheelbase;
    if (Math.abs(delta) > 1e-5) {
      const R = L / Math.tan(Math.abs(delta));
      const inner = Math.atan(L / (R - BODY.trackFront / 2));
      const outer = Math.atan(L / (R + BODY.trackFront / 2));
      const left = delta > 0;
      s.steerAngle[0] = Math.sign(delta) * (left ? inner : outer);
      s.steerAngle[1] = Math.sign(delta) * (left ? outer : inner);
    } else {
      s.steerAngle[0] = s.steerAngle[1] = 0;
    }
    s.steerAngle[2] = s.steerAngle[3] = 0;

    // ── brakes
    s.linePa = masterPressure(inp.brakeN);
    const rearK = rearPressureFactor(P.biasFront);
    const kmh = units.msToKmh(Math.abs(s.u));
    let brakePower = 0;
    const brakeT: number[] = [0, 0, 0, 0];
    let cycles = 0;
    for (let i = 0; i < 4; i++) {
      const wh = WHEELS[i];
      const line = wh.front ? s.linePa : s.linePa * rearK;
      const decel = -(s.wheelOmega[i] - s.prevOmega[i]) / h;
      const ch = this.abs[i];
      ch.step(h, line, s.slip[i], decel, kmh, !f.absDisabled);
      s.caliperPa[i] = ch.pressure;
      s.absPhase[i] = ch.phase;
      s.absCount[i] = ch.cycles;
      s.absHold[i] = ch.holdT;
      cycles += ch.cycles;
      const mu = padMu(s.rotorC[i] + (f.fadeProne ? 120 : 0), f.fadeProne ? 1.3 : 1);
      brakeT[i] = brakeTorque(wh.front, s.caliperPa[i], mu);
      brakePower += brakeT[i] * Math.abs(s.wheelOmega[i]);
    }
    s.absCycles = cycles;
    s.brakePowerW = brakePower;
    for (let i = 0; i < 4; i++) {
      const wh = WHEELS[i];
      const cap = wh.front ? BRAKES.rotorHeatCapFront : BRAKES.rotorHeatCapRear;
      const q = brakeT[i] * Math.abs(s.wheelOmega[i]) * 0.9;
      const cool = (8 + 1.6 * Math.abs(s.u)) * (s.rotorC[i] - this.road.ambientC);
      s.rotorC[i] += ((q - cool) / cap) * h;
    }
    for (let i = 0; i < 4; i++) s.prevOmega[i] = s.wheelOmega[i];

    // ── tyres: slip, loads (from the ride model), forces
    const mu = this.road.mu * P.muScale;
    const fxs = [0, 0, 0, 0];
    const fys = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const wh = WHEELS[i];
      const xr = cfg.xr[i];
      const vx = s.u + s.r * wh.z;
      const vz = s.w - s.r * xr;
      const d = s.steerAngle[i];
      const cd = Math.cos(d);
      const sd = Math.sin(d);
      // wheel frame: heading (cos d, −sin d), right (sin d, cos d)
      const vl = vx * cd - vz * sd;
      const vt = vx * sd + vz * cd;
      const kappa = slipRatio(s.wheelOmega[i], vl);
      const speed = Math.hypot(vl, vt);
      const alpha = speed > 0.3 ? Math.atan2(vt, Math.max(0.5, Math.abs(vl))) : 0;
      const fz = Math.max(0, s.fz[i]);
      const tf = tireForces(kappa, alpha, fz, mu);
      // near standstill the slip formulation is stiff: damp the force toward rest
      const low = Math.min(1, speed / 0.6);
      let fl = tf.fx;
      const ft = tf.fy * low;
      if (speed < 0.6 && Math.abs(s.wheelOmega[i] * RW - vl) < 0.05) fl *= low;
      s.slip[i] = kappa;
      s.slipAngle[i] = alpha;
      s.gripUse[i] = tf.usage;
      s.fx[i] = fl;
      s.fy[i] = ft;
      // to the car frame
      fxs[i] = fl * cd + ft * sd;
      fys[i] = -fl * sd + ft * cd;
    }

    // ── wheel spin dynamics (front free, rear through the open differential)
    // A brake is friction: it opposes the wheel's rotation; a wheel at rest stays at rest while
    // the other torques on it are within the brake's grip (no creeping, no chatter).
    const Iw = MASS.wheelInertia;
    const withBrake = (w0: number, tNet: number, tBrake: number, I: number): number => {
      if (Math.abs(w0) < 1e-6 && Math.abs(tNet) <= tBrake) return 0;
      const dir = Math.abs(w0) < 1e-6 ? Math.sign(tNet) : Math.sign(w0);
      const w1 = w0 + ((tNet - dir * tBrake) / I) * h;
      // the brake can stop the wheel but never turn it backwards
      if (tBrake > 0 && Math.sign(w1) !== dir && Math.abs(w0) > 1e-6) return 0;
      return w1;
    };
    for (const i of [0, 1]) s.wheelOmega[i] = withBrake(s.wheelOmega[i], -s.fx[i] * RW, brakeT[i], Iw);
    {
      // Open differential: the carrier (with the drivetrain's reflected inertia Id) passes a
      // torque Tc to the side gears, half to each wheel. With ωc = (ωL + ωR)/2:
      //   Id·ω̇c = Tring − Tc,   Iw·ω̇L = Tc/2 − FxL·R − BL,   Iw·ω̇R = Tc/2 − FxR·R − BR
      // so Tc = (Tring + k·(ΣFx·R + ΣB)) / (1 + k), k = Id / (2·Iw).
      const Id = reflected + s.lockup * ENGINE.inertia * Math.pow(s.ratio * fd, 2);
      const k = Id / (2 * Iw);
      const dir = (w: number) => (Math.abs(w) < 1e-6 ? 0 : Math.sign(w));
      const sumF = (s.fx[2] + s.fx[3]) * RW;
      const sumB = dir(s.wheelOmega[2]) * brakeT[2] + dir(s.wheelOmega[3]) * brakeT[3];
      const Tc = (ringTorque + k * (sumF + sumB)) / (1 + k);
      if (parked) {
        s.wheelOmega[2] = 0;
        s.wheelOmega[3] = 0;
      } else {
        for (const i of [2, 3]) s.wheelOmega[i] = withBrake(s.wheelOmega[i], Tc / 2 - s.fx[i] * RW, brakeT[i], Iw);
      }
    }
    // with the converter locked, the engine follows the turbine
    if (s.lockup > 0.98 && inGear && s.engine !== 'cranking') {
      const target = ((s.wheelOmega[2] + s.wheelOmega[3]) / 2) * fd * s.ratio;
      s.omegaE += (target - s.omegaE) * Math.min(1, h * 40 * s.lockup);
    }
    for (let i = 0; i < 4; i++) s.wheelAngle[i] = wrapBig(s.wheelAngle[i] + s.wheelOmega[i] * h);

    // ── the geartrain: every shaft from the applied elements, the input and the output speeds
    const wcNow = (s.wheelOmega[2] + s.wheelOmega[3]) / 2;
    const wOut = wcNow * fd;
    const wIn = inGear ? wOut * s.ratio : s.omegaT;
    const ap = appliedElements(s.gear, s.gearTarget, s.shift, sel);
    geartrainSpeeds(ap.engaged, wIn, wOut, this.gts);
    for (let i = 0; i < 8; i++) s.gt[i] = wrapBig(s.gt[i] + this.gts.shaft[i] * h);
    for (let i = 0; i < 4; i++) s.gtPlanet[i] = wrapBig(s.gtPlanet[i] + this.gts.planet[i] * h);
    s.turbineAngle = s.gt[0];
    s.driveshaftAngle = s.gt[7];
    {
      const imp = s.omegaE;
      const held = imp > 1 && statorHeld(Math.max(0, s.omegaT) / imp) && s.lockup < 0.5;
      s.statorAngle = wrapBig(s.statorAngle + (held ? 0 : s.omegaT * 0.92) * h);
    }
    s.carrierAngle = wrapBig(s.carrierAngle + wcNow * h);
    const dsp = ((s.wheelOmega[2] - s.wheelOmega[3]) / 2) * (DIFF.sideTeeth / DIFF.spiderTeeth);
    s.spiderAngle = wrapBig(s.spiderAngle + dsp * h);

    // ── body: longitudinal, lateral, yaw (car frame, about the centre of mass)
    const m = cfg.m;
    const drag = 0.5 * AIR_DENSITY * BODY.dragCoefficient * BODY.frontalArea * s.u * Math.abs(s.u);
    const rollRes = TIRE.rollingResistance * m * G * Math.tanh(s.u * 2);
    const Fx = fxs[0] + fxs[1] + fxs[2] + fxs[3] - drag - rollRes;
    const Fz = fys[0] + fys[1] + fys[2] + fys[3];
    let Mz = 0;
    for (let i = 0; i < 4; i++) Mz += WHEELS[i].z * fxs[i] - cfg.xr[i] * fys[i];
    const ax = Fx / m;
    const azl = Fz / m;
    s.u += (ax - s.r * s.w) * h;
    s.w += (azl + s.r * s.u) * h;
    s.r += (Mz / cfg.yawInertia) * h;
    // at walking pace and below, the tyres' slip model gives way to rolling without sliding
    if (Math.abs(s.u) < 1.2) {
      const k = 1 - Math.abs(s.u) / 1.2;
      const rKin = (s.u * Math.tan((s.steerAngle[0] + s.steerAngle[1]) / 2)) / L;
      s.r += (rKin - s.r) * Math.min(1, h * 30 * k);
      s.w += (rKin * cfg.b - s.w) * Math.min(1, h * 30 * k);
    }
    if (Math.abs(s.u) < 0.02 && Math.abs(ax) < 0.05 && brakeT.some((b) => b > 0)) {
      s.u = 0;
      s.w = 0;
      s.r = 0;
    }
    s.ax = ax;
    s.az = azl;
    // world pose
    const ch = Math.cos(s.heading);
    const sh = Math.sin(s.heading);
    s.X += (s.u * ch + s.w * sh) * h;
    s.Z += (-s.u * sh + s.w * ch) * h;
    s.heading += s.r * h;
    s.s += Math.hypot(s.u, s.w) * Math.sign(s.u || 1) * h;
    if (inp.brakeN > 0 && s.stoppingFrom === 0 && s.u > 1) {
      s.stoppingFrom = s.u;
      s.stopDistance = 0;
    }
    if (s.stoppingFrom > 0) {
      s.stopDistance += Math.abs(s.u) * h;
      if (inp.brakeN <= 0) s.stoppingFrom = 0;
    }

    // ── ride: 7 degrees of freedom
    this.ride(h, ax, azl);

    // ── systems
    const fuelKgS = share > 0 ? fuelMassFlow(airMassFlow(Math.max(rpm, 1), s.map)) * share : 0;
    const airKgS = rpm > 30 ? airMassFlow(rpm, s.map) : 0;
    s.fuelGs = fuelKgS * 1000;
    s.airGs = airKgS * 1000;
    this.cooling.step(h, rpm, fuelKgS * FUEL_LHV, Math.abs(s.u), { thermostatStuckClosed: f.thermostatStuckClosed, fanFailed: f.fanFailed, lowCoolant: f.lowCoolant }, inp.heater, this.road.ambientC);
    s.coolantC = this.cooling.coolantC;
    s.thermostat = this.cooling.thermostat;
    s.fanOn = this.cooling.fanOn;
    s.fanSpeed += ((s.fanOn ? 220 : 0) - s.fanSpeed) * Math.min(1, h * (s.fanOn ? 1.5 : 0.6));
    s.fanAngle = (s.fanAngle + s.fanSpeed * h) % TWO_PI;
    s.radiatorFlow = this.cooling.radiatorFlow;
    s.bypassFlow = this.cooling.bypassFlow;
    this.oil.step(h, rpm, s.coolantC, ax / G + 0.6 * (azl / G), { lowLevel: f.lowOil, wornBearings: f.wornBearings }, s.t);
    s.oilC = this.oil.oilC;
    s.oilBar = this.oil.pressureBar;
    s.oilStarving = this.oil.starving;
    // closed-loop fuel: the oxygen sensor sees a lean exhaust when a cylinder does not burn its
    // charge (its oxygen passes through); the ECU's trim oscillates around lambda 1 otherwise
    const misfiring = f.misfireCyl >= 0 && fuelling;
    s.lambda = misfiring ? 1.25 : 1 + 0.015 * Math.sin(s.t * TWO_PI * 1.2);
    s.fuelTrim += ((misfiring ? 18 : 2.5 * Math.sin(s.t * TWO_PI * 1.2)) - s.fuelTrim) * Math.min(1, h * 2);
    // flows advance with their modelled rates (drawn as moving particles; still when zero)
    const ph = s.phase;
    ph.air += (airKgS / 0.08) * h;
    ph.fuel += (fuelKgS / 0.006) * h;
    ph.exhaust += ((airKgS + fuelKgS) / 0.06) * h;
    ph.oil += (this.oil.flow / 50) * h;
    ph.coolant += ((s.radiatorFlow * this.cooling.pumpFlow) / 120) * h;
    ph.bypass += ((s.bypassFlow * this.cooling.pumpFlow) / 120) * h;
    ph.heater += (inp.heater ? this.cooling.pumpFlow / 160 : 0) * h;
    ph.power += ((Math.abs(s.batteryAmps) + s.alternatorAmps) / 120) * h;
    ph.signal += (s.ecuPowered ? 1 : 0) * h;
    ph.brake += (s.linePa / 8e6) * h;
    // the converter's fluid circulates as fast as the impeller outruns the turbine
    ph.converter += Math.min(3, Math.abs(s.omegaE - s.omegaT) / 60) * h;
    // air through the radiator: ram air with road speed, plus the fans
    ph.radiatorAir += (Math.abs(s.u) * 0.08 + s.fanSpeed / 220 * 0.6) * h;
    // torque chevrons move with the power being carried
    ph.torque += Math.min(2.5, (Math.abs(s.wheelTorque) * Math.abs(wcNow) + Math.max(0, s.engineTorque) * s.omegaE * (inGear ? 0 : 0.2)) / 40000) * h;
    // illustrative (no model of the air conditioning or the blower): steady while they would run
    ph.refrigerant += (s.engine === 'running' ? 0.25 : 0) * h;
    ph.cabinAir += (inp.ignition ? 0.5 : 0) * h;
    for (const k of Object.keys(ph) as (keyof typeof ph)[]) if (ph[k] > 1e4) ph[k] %= 1;
    // warnings
    s.warnings.engine = s.misfireCount > 3 && f.misfireCyl >= 0;
    s.warnings.oil = this.oil.warning && s.engine === 'running';
    s.warnings.battery = inp.ignition && (s.engine !== 'running' || s.alternatorAmps < 1 || s.volts < 12.2);
    s.warnings.temp = s.coolantC > 115;
    s.warnings.abs = f.absDisabled;
    s.warnings.brake = s.rotorC.some((c) => c > 550);
  }

  /** Heave, pitch, roll and the four wheels on their springs and tyres. */
  private ride(h: number, ax: number, azl: number) {
    const s = this.s;
    const P = this._params;
    const cfg = this.config;
    const road = this.road.height;
    const Fsus = [0, 0, 0, 0];
    const dis = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const wh = WHEELS[i];
      const zc = s.heave + wh.x * s.pitch - wh.z * s.roll;
      const zcV = s.heaveV + wh.x * s.pitchV - wh.z * s.rollV;
      dis[i] = s.wheelZ[i] - zc;
      const k = wh.front ? P.wheelRateFront : P.wheelRateRear;
      let c = wh.front ? P.dampingFront : P.dampingRear;
      if (this.faults.wornDamper === i) c *= 0.12;
      // dampers are stiffer in rebound than in bump (typical)
      const dv = s.wheelZV[i] - zcV;
      const cEff = dv > 0 ? c * 0.75 : c * 1.25;
      let F = k * dis[i] + cEff * dv;
      // bump stops: progressive beyond the travel
      const over = dis[i] - SUSPENSION.travelBump;
      if (over > 0) F += 400000 * over * over * 10 + 20000 * over;
      const under = -dis[i] - SUSPENSION.travelRebound;
      if (under > 0) F -= 200000 * under;
      Fsus[i] = F;
    }
    // anti-roll bars
    const arb = (a: number, b: number, K: number, t: number) => {
      const F = (K / (t * t)) * (dis[a] - dis[b]);
      Fsus[a] += F;
      Fsus[b] -= F;
    };
    arb(0, 1, SUSPENSION.antiRollFront, BODY.trackFront);
    arb(2, 3, SUSPENSION.antiRollRear, BODY.trackRear);
    // body: moments about the centre of mass
    let Fz = 0;
    let Mp = cfg.m * ax * cfg.hCg;
    let Mr = -cfg.m * azl * (cfg.hCg - 0.09);
    for (let i = 0; i < 4; i++) {
      Fz += Fsus[i];
      Mp += cfg.xr[i] * Fsus[i];
      Mr += -WHEELS[i].z * Fsus[i];
    }
    s.heaveV += (Fz / cfg.ms) * h;
    s.pitchV += (Mp / cfg.pitchInertia) * h;
    s.rollV += (Mr / cfg.rollInertia) * h;
    s.heave += s.heaveV * h;
    s.pitch += s.pitchV * h;
    s.roll += s.rollV * h;
    // wheels on their tyres
    for (let i = 0; i < 4; i++) {
      const wh = WHEELS[i];
      const mu = wh.front ? MASS.unsprungFront : MASS.unsprungRear;
      const side: -1 | 1 = wh.z < 0 ? -1 : 1;
      const zr = road ? road(s.s + wh.x, side) : 0;
      const fz0 = cfg.fzStatic[i];
      // tyre: a spring that can only push (the wheel may leave the road)
      const comp = zr - s.wheelZ[i];
      const Ft = Math.max(-fz0, TIRE.verticalStiffness * comp + 350 * (0 - s.wheelZV[i]) * (comp > -fz0 / TIRE.verticalStiffness ? 1 : 0));
      s.fz[i] = fz0 + Ft;
      s.wheelZV[i] += ((Ft - Fsus[i]) / mu) * h;
      s.wheelZ[i] += s.wheelZV[i] * h;
    }
  }

  // ─────────────────────────────── helpers ───────────────────────────────
  get rpm(): number {
    return units.radToRpm(this.s.omegaE);
  }
  get kmh(): number {
    return units.msToKmh(this.s.u);
  }
  /** Applied shift elements (the shared ones during a shift, with the one applying and the one releasing). */
  elements(): { engaged: Element[]; applying: Element | null; releasing: Element | null } {
    const s = this.s;
    return appliedElements(s.gear, s.gearTarget, s.shift, s.selector);
  }
  /** The geartrain's speeds this step (shafts, planets, element slip), rad/s. */
  get geartrain(): GeartrainSpeeds {
    return this.gts;
  }
  get statorLocked(): boolean {
    const imp = this.s.omegaE;
    return imp > 1 && statorHeld(Math.max(0, this.s.omegaT) / imp);
  }
  get fullLoadTorque(): number {
    return fullLoadTorque(this.rpm);
  }
}

// ─────────────────────────── canonical starting states ───────────────────────────

/** A warm engine idling in Park. */
export function presetIdle(): CarState {
  const s = initialState();
  s.engine = 'running';
  s.omegaE = units.rpmToRad(ENGINE.idleRpm);
  s.omegaT = s.omegaE * 0.95;
  s.sinceStart = 30;
  s.coolantC = 90;
  s.oilC = 92;
  s.thermostat = 0.15;
  s.oilBar = 1.6;
  s.volts = 14.1;
  s.soc = 0.9;
  s.ecuPowered = true;
  s.throttleEff = 0.035;
  return s;
}

/** Cruising in a gear at a steady speed (converter locked from 3rd), engine warm. */
export function presetCruise(kmh: number, gear?: number, params: Params = defaultParams()): CarState {
  const s = presetIdle();
  const v = units.kmhToMs(kmh);
  const wheel = v / RW;
  let g = gear ?? 1;
  if (gear === undefined) {
    for (let k = 8; k >= 1; k--) {
      const rpm = units.radToRpm(wheel * params.finalDrive * gearRatio(k));
      if (rpm >= 1300) {
        g = k;
        break;
      }
    }
  }
  s.selector = 'D';
  s.gear = g;
  s.gearTarget = g;
  s.shift = 1;
  s.ratio = gearRatio(g);
  s.u = v;
  s.wheelOmega = [wheel, wheel, wheel, wheel];
  s.prevOmega = [wheel, wheel, wheel, wheel];
  s.omegaT = wheel * params.finalDrive * s.ratio;
  s.lockup = g >= 3 && kmh > CONVERTER.lockupKmh ? 1 : 0;
  s.omegaE = s.lockup ? s.omegaT : Math.max(s.omegaT * 1.05, units.rpmToRad(ENGINE.idleRpm));
  return s;
}

/** Engine off, cold, in Park. */
export function presetCold(): CarState {
  return initialState();
}
