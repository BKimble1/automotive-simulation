/**
 * The vehicle: one generic modern gasoline sport sedan, designed for this simulation (not a
 * product). Front engine, rear-wheel drive, a longitudinal 2.5 L inline-four with direct
 * injection, an 8-speed planetary automatic, an open differential and independent suspension.
 *
 * This file is the single source of truth for every dimension and constant the models and the
 * geometry use. SI units throughout (m, kg, s, N, N·m, rad, W, Pa, K) unless a name says
 * otherwise (…Deg, …Rpm, …Bar, …C, …Kmh). Each group says where its values come from:
 *
 *   design    chosen for this vehicle, inside the range of real cars of its class
 *   derived   calculated from other values here
 *   typical   a representative value for components of this kind (not a measurement)
 *
 * Coordinates (metres): x forward, y up, z to the car's right. The origin is on the ground,
 * on the centreline, halfway between the axles. The driver sits on the left (−z).
 */

import { DERIVED_RATIOS } from '../sim/geartrain';

export const NAME = 'S-1';

/** Body and package (design: a mid-size four-door sport sedan). */
export const BODY = {
  length: 4.72,
  width: 1.84,
  height: 1.42,
  wheelbase: 2.85,
  trackFront: 1.58,
  trackRear: 1.6,
  overhangFront: 0.83,
  overhangRear: 1.04,
  groundClearance: 0.135,
  /** Front axle x and rear axle x (derived from the wheelbase). */
  xFront: 1.425,
  xRear: -1.425,
  /** Bumper extremes (derived). */
  xNose: 2.255,
  xTail: -2.465,
  /** Firewall (bulkhead between engine bay and cabin). */
  xFirewall: 0.95,
  dragCoefficient: 0.27,
  frontalArea: 2.2,
} as const;

/** Mass and inertia (design; distribution typical of a front-mid-engine RWD sedan). */
export const MASS = {
  /** Curb mass plus a 75 kg driver. */
  total: 1560,
  frontShare: 0.52,
  cgHeight: 0.52,
  /** Yaw moment of inertia, kg·m² (typical: about m·(0.43·L)²·… for this size). */
  yawInertia: 2550,
  /** Pitch and roll inertia of the sprung mass, kg·m². */
  pitchInertia: 2300,
  rollInertia: 560,
  /** Unsprung mass per corner (wheel, tyre, brake, upright, half the links), kg. */
  unsprungFront: 42,
  unsprungRear: 45,
  /** Rotating inertia of one wheel and tyre about its axle, kg·m². */
  wheelInertia: 1.15,
} as const;

/** Tyres: 245/40 R18 (design). */
export const TIRE = {
  widthMm: 245,
  aspect: 0.4,
  rimIn: 18,
  /** Unloaded radius: rim/2 + sidewall (derived: 0.2286 + 0.098). */
  radius: 0.3266,
  /** Loaded (rolling) radius used for speed and torque (typical: about 97 % of unloaded). */
  rollingRadius: 0.318,
  /** Vertical stiffness, N/m (typical for this size at 2.4 bar). */
  verticalStiffness: 260000,
  pressureBar: 2.4,
  /** Rolling resistance coefficient (typical). */
  rollingResistance: 0.011,
  /** Peak friction coefficient on dry asphalt (typical summer tyre). */
  muDry: 1.05,
  muWet: 0.7,
  muSnow: 0.3,
  muIce: 0.1,
  /** Longitudinal slip at peak friction (typical). */
  peakSlip: 0.12,
  /** Cornering stiffness per axle, N/rad (typical; front a little lower, so the car understeers gently). */
  corneringStiffnessFront: 125000,
  corneringStiffnessRear: 140000,
} as const;

/** Wheel centre height at rest (derived). */
export const WHEEL_Y = TIRE.rollingRadius;

/**
 * The engine: 2.5 L naturally aspirated inline-four, twin overhead camshafts, four valves per
 * cylinder, gasoline direct injection, longitudinal, cylinder 1 at the front (design).
 */
export const ENGINE = {
  cylinders: 4,
  boreMm: 89,
  strokeMm: 100,
  /** Connecting rod centre-to-centre length, mm (typical rod ratio 1.55). */
  rodMm: 155,
  compressionRatio: 13,
  /** Bore spacing, mm (typical: bore + 9 mm of wall and water jacket). */
  boreSpacingMm: 98,
  /** Firing order (typical for an inline-four). */
  firingOrder: [1, 3, 4, 2] as const,
  idleRpm: 750,
  redlineRpm: 6800,
  /** Fuel cut-off (rev limiter), and the lower one with no gear engaged (P or N) (typical). */
  limiterRpm: 7000,
  limiterNeutralRpm: 4500,
  /** Peak torque and power (design). */
  peakTorque: 255,
  peakTorqueRpm: 4400,
  peakPowerKw: 152,
  peakPowerRpm: 6400,
  /** Rotating inertia of the crankshaft, flywheel/flexplate and torque converter impeller, kg·m². */
  inertia: 0.24,
  /** Crankshaft centre line, in vehicle coordinates: from cylinder 1 (front) back. */
  crankY: 0.4,
  /** x of cylinder 1's axis (derived from the layout: engine behind the front axle). */
  xCyl1: 1.5,
  /** Cylinder tilt from vertical, rad (0: upright). */
  tilt: 0,
  /** Displacement, m³ (derived). */
  get displacement() {
    const b = this.boreMm / 1000;
    const s = this.strokeMm / 1000;
    return this.cylinders * (Math.PI / 4) * b * b * s;
  },
} as const;

/**
 * Valve timing in crank degrees within the 720° cycle, where 0° is top dead centre at the start
 * of the intake stroke (so 360° is TDC of combustion). Typical for a modern DOHC engine at idle
 * with its cam phasers parked (design).
 */
export const VALVES = {
  /** Intake opens 8° before TDC, closes 52° after BDC. */
  intakeOpen: -8,
  intakeClose: 232,
  /** Exhaust opens 48° before BDC (of the power stroke), closes 6° after TDC. */
  exhaustOpen: 492,
  exhaustClose: 726,
  intakeLiftMm: 10.5,
  exhaustLiftMm: 9.8,
  intakeHeadMm: 35,
  exhaustHeadMm: 29,
  /** Ignition advance at idle and at full load, degrees before TDC (typical). */
  sparkAdvanceIdle: 12,
  sparkAdvanceLoad: 24,
  /** Direct injection during the intake stroke (start and end, crank degrees after intake TDC). */
  injectStart: 60,
  injectEnd: 130,
} as const;

/**
 * Transmission: 8-speed planetary automatic with a lock-up torque converter (design: ratios of
 * the kind modern eight-speeds use).
 */
export const GEARBOX = {
  /** Ratios of 1st … 8th and reverse, derived from the gearsets' tooth counts (sim/geartrain.ts). */
  ratios: DERIVED_RATIOS.forward as readonly number[],
  reverse: DERIVED_RATIOS.reverse,
  /** Final drive (ring and pinion). */
  finalDrive: 3.15,
  /** Efficiency of the gearbox and final drive together (typical). */
  efficiency: 0.92,
  /** Shift time (torque phase plus inertia phase), s (typical). */
  shiftTime: 0.35,
  /** Up-shift speeds at light throttle and at full throttle, engine rpm (design). */
  upshiftLight: 2100,
  upshiftFull: 6500,
  /** Down-shift when the engine would fall below this, rpm. */
  downshift: 1200,
} as const;

/** Torque converter (typical for a 2.5 L engine). */
export const CONVERTER = {
  /** Torque ratio at stall (turbine stopped). */
  stallTorqueRatio: 1.9,
  /** Speed ratio where the stator freewheels (coupling point). */
  couplingPoint: 0.86,
  /** Capacity factor K = N / sqrt(T) at stall, rpm/√(N·m) (sets stall speed ≈ 2300 rpm at full torque). */
  kStall: 145,
  /** Lock-up clutch engages above this road speed in gears 3 and up, km/h. */
  lockupKmh: 38,
} as const;

/** Suspension (design: double wishbone front, multi-link rear, coil springs, twin-tube dampers). */
export const SUSPENSION = {
  /** Wheel rate (spring rate at the wheel), N/m. */
  wheelRateFront: 30000,
  wheelRateRear: 34000,
  /** Damping at the wheel, N·s/m (about 0.3 of critical for the sprung corner mass). */
  dampingFront: 2900,
  dampingRear: 3200,
  /** Anti-roll bars, N·m/rad of body roll. */
  antiRollFront: 32000,
  antiRollRear: 18000,
  /** Static ride height above the wheel centre of the body reference, m. */
  travelBump: 0.085,
  travelRebound: 0.1,
  /** Roll centre heights, m (typical). */
  rollCentreFront: 0.07,
  rollCentreRear: 0.12,
} as const;

/** Steering (design: electric power-assisted rack and pinion). */
export const STEERING = {
  /** Overall ratio: steering-wheel angle / road-wheel angle. */
  ratio: 14.5,
  /** Lock to lock, turns. */
  lockToLock: 2.6,
  /** Maximum road-wheel angle, rad (derived from ratio and lock). */
  get maxWheelAngle() {
    return ((this.lockToLock / 2) * 2 * Math.PI) / this.ratio;
  },
  /** Rack travel per pinion revolution, m (typical). */
  rackPerRev: 0.052,
  /** Kingpin inclination and caster, rad (typical). */
  kingpin: (12 * Math.PI) / 180,
  caster: (7 * Math.PI) / 180,
} as const;

/** Brakes (design: four-wheel discs, vacuum-free electric booster modelled as a fixed boost). */
export const BRAKES = {
  pedalRatio: 3.4,
  /** Booster assist ratio (output force / input force), and its run-out (maximum output), N. */
  boost: 3.2,
  boostRunout: 7200,
  /** Master cylinder bore, m. */
  masterBore: 0.0238,
  /** Caliper piston area per caliper, m² (front: four 38 mm pistons, two per side → clamp from two). */
  caliperAreaFront: 2 * Math.PI * 0.019 * 0.019,
  caliperAreaRear: 2 * Math.PI * 0.0165 * 0.0165,
  /** Effective (mean) friction radius, m. */
  radiusFront: 0.148,
  radiusRear: 0.138,
  /** Rotor diameters, m. */
  rotorFront: 0.348,
  rotorRear: 0.33,
  /** Pad friction coefficient when cool (typical road pad). */
  padMu: 0.42,
  /** Rotor thermal mass per front / rear rotor, J/K (mass × c ≈ 9.5 kg × 460). */
  rotorHeatCapFront: 4400,
  rotorHeatCapRear: 3600,
  /** Pad friction starts to fall above this rotor temperature (fade), °C (typical road pad). */
  fadeStartC: 450,
  fadeFullC: 700,
  /** Fixed front share of braking torque (bias), by the hydraulic proportioning. */
  biasFront: 0.68,
} as const;

/** ABS (typical): target slip window and the hydraulic modulator's cycle. */
export const ABS = {
  /** Slip above which pressure is released. */
  releaseSlip: 0.18,
  /** Slip below which pressure is re-applied. */
  applySlip: 0.08,
  /** Pressure rise (re-apply) and fall (dump) rates of the modulator, bar/s. */
  applyRate: 320,
  releaseRate: 1400,
  /** ABS works above this speed, km/h. */
  minKmh: 6,
} as const;

/** Cooling (typical lumped values for a 2.5 L engine). */
export const COOLING = {
  /** Thermostat starts to open and is fully open, °C. */
  thermostatOpenC: 88,
  thermostatFullC: 100,
  /** Electric fan switches on and off (hysteresis), °C. */
  fanOnC: 102,
  fanOffC: 97,
  /** Coolant plus metal thermal capacity, J/K. */
  heatCapacity: 42000,
  /** Radiator conductance at full coolant flow, W/K: still air, ram air at 100 km/h, fan alone. */
  radiatorUA: 90,
  radiatorUARam: 1500,
  radiatorUAFan: 700,
  /** Share of fuel energy that reaches the coolant (typical gasoline engine). */
  heatToCoolant: 0.3,
  /** Heat lost from the block to the air without coolant flow, W/K. */
  blockLossUA: 35,
  ambientC: 25,
  /** Overheat warning, °C. */
  warnC: 115,
} as const;

/** Lubrication (typical). */
export const OIL = {
  /** Oil pressure at idle (hot) and at 4000 rpm, bar. */
  pressureIdleBar: 1.6,
  pressureHighBar: 4.6,
  /** Relief valve opens, bar. */
  reliefBar: 5.0,
  /** Low oil pressure warning, bar. */
  warnBar: 0.5,
  capacityLitres: 5.5,
} as const;

/** Electrical system (typical 12 V). */
export const ELECTRICAL = {
  /** Battery: 70 A·h, open-circuit voltage at full charge, internal resistance. */
  capacityAh: 70,
  ocvFull: 12.72,
  ocvEmpty: 11.9,
  internalOhm: 0.0105,
  /** Starter: current draw while cranking, A; cranking speed with a healthy battery, rpm. */
  starterAmps: 200,
  crankRpm: 220,
  /** Below this battery voltage during cranking the ECU cannot run (resets), V. */
  ecuMinVolts: 7.5,
  /** Alternator regulated voltage and its maximum current at engine speed, A (at 2000 rpm and above). */
  regulatedVolts: 14.2,
  alternatorMaxAmps: 150,
  /** Alternator pulley ratio to the crankshaft. */
  alternatorPulley: 2.8,
  /** Base electrical load with the engine running (ECU, pumps, ignition), A. */
  baseLoadAmps: 28,
} as const;

/** Physical constants. */
export const G = 9.81;
export const AIR_DENSITY = 1.2;

/** Unit helpers (one place, so a conversion is never repeated with a different factor). */
export const units = {
  rpmToRad: (rpm: number) => (rpm * 2 * Math.PI) / 60,
  radToRpm: (w: number) => (w * 60) / (2 * Math.PI),
  kmhToMs: (kmh: number) => kmh / 3.6,
  msToKmh: (ms: number) => ms * 3.6,
  barToPa: (bar: number) => bar * 1e5,
  paToBar: (pa: number) => pa / 1e5,
  deg: (d: number) => (d * Math.PI) / 180,
  toDeg: (r: number) => (r * 180) / Math.PI,
};

/** Static axle loads, N (derived). */
export const STATIC = {
  frontAxle: MASS.total * MASS.frontShare * G,
  rearAxle: MASS.total * (1 - MASS.frontShare) * G,
  /** Distance from the centre of mass to the front and rear axles, m (derived). */
  a: BODY.wheelbase * (1 - MASS.frontShare),
  b: BODY.wheelbase * MASS.frontShare,
  /** x of the centre of mass (derived). */
  xCg: BODY.xFront - BODY.wheelbase * (1 - MASS.frontShare),
} as const;
