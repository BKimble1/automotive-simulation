/**
 * The engine's mechanism and combustion, as functions of crank angle (no rendering, no state).
 *
 * Crank angle θ is in radians and grows while the engine turns; one four-stroke cycle is 4π
 * (720°). For each cylinder, its *phase* φ (degrees, 0 … 720) is where it is in its own cycle:
 * 0° top dead centre (TDC) at the start of the intake stroke, 180° bottom dead centre, 360°
 * TDC of combustion, 540° BDC, 720° = 0°. Cylinder 1's phase equals the crank angle; the others
 * follow the firing order 1-3-4-2, 180° apart.
 *
 * Every moving part of the drawn engine is derived from these functions, so the piston, the
 * rod, the crank throw, the cams, the valves, the spark, the injector and the gas always agree.
 */
import { ENGINE, VALVES } from '../spec/vehicle';

const DEG = Math.PI / 180;
export const CYCLE = 4 * Math.PI;

/** Crank radius and rod length, m. */
export const CRANK_R = ENGINE.strokeMm / 2000;
export const ROD_L = ENGINE.rodMm / 1000;
export const BORE = ENGINE.boreMm / 1000;
export const PISTON_AREA = (Math.PI / 4) * BORE * BORE;
/** Clearance volume and swept volume of one cylinder, m³. */
export const SWEPT = PISTON_AREA * 2 * CRANK_R;
export const CLEARANCE = SWEPT / (ENGINE.compressionRatio - 1);

/**
 * Phase offset of each cylinder (degrees): the crank angle at which it is at intake TDC.
 * Firing order 1-3-4-2: each fires 180° after the one before.
 */
export const CYL_OFFSET_DEG: readonly number[] = (() => {
  const off = [0, 0, 0, 0];
  ENGINE.firingOrder.forEach((cyl, i) => (off[cyl - 1] = i * 180));
  return off;
})();

/** The angle of cylinder i's crank throw (degrees, 0 = up at θ = 0): 1 and 4 together, 2 and 3 opposite. */
export function throwAngleDeg(i: number): number {
  return CYL_OFFSET_DEG[i] % 360;
}

/** Phase of cylinder i (0-based) at crank angle θ (radians), degrees in [0, 720). */
export function phaseDeg(i: number, theta: number): number {
  const d = (theta / DEG - CYL_OFFSET_DEG[i]) % 720;
  return d < 0 ? d + 720 : d;
}

/** Wrap a phase into [0, 720). */
export function wrap720(d: number): number {
  const r = d % 720;
  return r < 0 ? r + 720 : r;
}

/**
 * Piston position: distance of the wrist pin below its TDC position, m (0 at TDC, 2r at BDC),
 * from the slider-crank: x = r cos α + √(l² − r² sin² α), with α the throw angle from TDC.
 */
export function pistonDrop(alphaRad: number): number {
  const r = CRANK_R;
  const l = ROD_L;
  const s = Math.sin(alphaRad);
  const x = r * Math.cos(alphaRad) + Math.sqrt(l * l - r * r * s * s);
  return r + l - x;
}

/** Rate of change of piston drop with crank angle, m/rad (for gas torque). */
export function pistonDropRate(alphaRad: number): number {
  const r = CRANK_R;
  const l = ROD_L;
  const s = Math.sin(alphaRad);
  const c = Math.cos(alphaRad);
  return r * s + (r * r * s * c) / Math.sqrt(l * l - r * r * s * s);
}

/** Connecting rod angle from the cylinder axis, rad (sign: toward the throw). */
export function rodAngle(alphaRad: number): number {
  return Math.asin((CRANK_R * Math.sin(alphaRad)) / ROD_L);
}

/** Cylinder volume at a phase, m³. */
export function cylinderVolume(phase: number): number {
  return CLEARANCE + PISTON_AREA * pistonDrop(phase * DEG);
}

/** Is a phase inside the window [open, close] (degrees, may wrap past 720)? Returns progress 0…1 or −1. */
export function windowProgress(phase: number, open: number, close: number): number {
  const len = close - open;
  const d = wrap720(phase - open);
  return d <= len ? d / len : -1;
}

/**
 * Valve lift as a fraction of maximum (0 … 1) at a phase. The cam's lift curve: gentle ramps
 * and a rounded nose (a sin² profile), between the timing events.
 */
export function intakeLift(phase: number): number {
  const u = windowProgress(phase, VALVES.intakeOpen, VALVES.intakeClose);
  if (u < 0) return 0;
  const s = Math.sin(Math.PI * u);
  return s * s;
}

export function exhaustLift(phase: number): number {
  const u = windowProgress(phase, VALVES.exhaustOpen, VALVES.exhaustClose);
  if (u < 0) return 0;
  const s = Math.sin(Math.PI * u);
  return s * s;
}

/** Phase at which a valve's lift peaks (degrees): where its cam lobe points at the follower. */
export const INTAKE_PEAK = (VALVES.intakeOpen + VALVES.intakeClose) / 2;
export const EXHAUST_PEAK = (VALVES.exhaustOpen + VALVES.exhaustClose) / 2;

/**
 * The stroke a cylinder is on, by phase (the valve events overlap the ends: this is the
 * piston's stroke, TDC to BDC).
 */
export type Stroke = 'intake' | 'compression' | 'power' | 'exhaust';
export function strokeOf(phase: number): Stroke {
  if (phase < 180) return 'intake';
  if (phase < 360) return 'compression';
  if (phase < 540) return 'power';
  return 'exhaust';
}

/** Ignition advance, degrees before compression TDC, by load (0 … 1) and speed. */
export function sparkAdvance(load: number, rpm: number): number {
  const base = VALVES.sparkAdvanceIdle + (VALVES.sparkAdvanceLoad - VALVES.sparkAdvanceIdle) * Math.min(1, Math.max(0, (rpm - 800) / 3200));
  // less advance at high load (knock margin)
  return base - 6 * Math.max(0, load - 0.6);
}

/** The phase at which the plug fires. */
export function sparkPhase(load: number, rpm: number): number {
  return 360 - sparkAdvance(load, rpm);
}

/** Burn duration, degrees (typical 10–90 % burn plus ignition delay). */
export const BURN_DEG = 55;
export const IGNITION_DELAY_DEG = 8;

/** Mass fraction burned (Wiebe function) at a phase, given the spark phase. */
export function burnFraction(phase: number, spark: number): number {
  const start = spark + IGNITION_DELAY_DEG;
  if (phase < start) return 0;
  const x = (phase - start) / BURN_DEG;
  if (x >= 1.6) return 1;
  return 1 - Math.exp(-5 * Math.pow(x, 3));
}

/**
 * Cylinder pressure (absolute, Pa) at a phase, for a given intake manifold pressure and
 * combustion strength (0 = misfire or motoring, 1 = full). A polytropic compression and
 * expansion (n = 1.32) from the trapped charge, with the combustion's pressure rise added in
 * proportion to the burned fraction; exhaust and intake strokes near their manifold pressures.
 */
export function cylinderPressure(phase: number, manifoldPa: number, combustion: number, spark: number): number {
  const n = 1.32;
  if (phase < VALVES.intakeClose && phase >= 0) return manifoldPa;
  if (phase >= VALVES.exhaustOpen) {
    // blowdown, then the exhaust stroke near exhaust back-pressure
    const u = (phase - VALVES.exhaustOpen) / 40;
    const pe = 1.08e5;
    if (u >= 1) return pe;
    const pEvo = cylinderPressure(VALVES.exhaustOpen - 0.01, manifoldPa, combustion, spark);
    return pe + (pEvo - pe) * Math.pow(1 - u, 2);
  }
  // closed cycle: trapped at intake valve closing
  const pIvc = manifoldPa;
  const vIvc = cylinderVolume(VALVES.intakeClose);
  const v = cylinderVolume(phase);
  const motored = pIvc * Math.pow(vIvc / v, n);
  const xb = burnFraction(phase, spark);
  // the heat released multiplies the motored pressure in proportion to the burned fraction, and
  // the factor is carried through the expansion (the gas stays hot)
  return motored * (1 + combustion * xb * 3.1);
}

/** Full-load torque curve, N·m, at engine speed (rpm). Peak 255 N·m at 4400, 152 kW at 6400. */
export function fullLoadTorque(rpm: number): number {
  const pts: [number, number][] = [
    [0, 120],
    [600, 150],
    [1000, 178],
    [1500, 200],
    [2500, 230],
    [3500, 248],
    [4400, 255],
    [5500, 245],
    [6400, 227],
    [7000, 196],
    [7500, 150],
  ];
  if (rpm <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (rpm <= pts[i][0]) {
      const [a, ta] = pts[i - 1];
      const [b, tb] = pts[i];
      const u = (rpm - a) / (b - a);
      const s = u * u * (3 - 2 * u);
      return ta + (tb - ta) * s;
    }
  }
  return pts[pts.length - 1][1];
}

/** Friction and pumping torque, N·m (always positive, opposing rotation). */
export function frictionTorque(rpm: number, oilTempC = 90): number {
  // cold oil is thicker: up to 60 % more friction at 20 °C
  const cold = 1 + 0.6 * Math.max(0, Math.min(1, (90 - oilTempC) / 70));
  return (11 + 0.0028 * rpm + 0.0000006 * rpm * rpm) * cold;
}

/**
 * Manifold absolute pressure from throttle (0 … 1) and speed: a throttled engine draws the
 * manifold down; wide open it is near atmospheric. Pa.
 */
export function manifoldPressure(throttle: number, rpm: number): number {
  const t = Math.max(0, Math.min(1, throttle));
  // effective throttle area against the engine's pumping demand
  const area = 0.012 + 0.988 * Math.pow(t, 1.5);
  const demand = Math.max(0.2, rpm / 3000);
  const ratio = area / Math.sqrt(area * area + 0.06 * demand * demand);
  return 1.013e5 * Math.max(0.25, Math.min(0.99, ratio));
}

/** Indicated (gross) torque from manifold pressure, N·m: full-load torque scaled by charge density. */
export function indicatedTorque(rpm: number, mapPa: number, combustionShare = 1): number {
  const load = Math.max(0, (mapPa - 0.2e5) / (0.99e5 - 0.2e5));
  return (fullLoadTorque(rpm) + frictionTorque(rpm)) * load * combustionShare;
}

/** Volumetric efficiency (typical NA engine, peaks at the torque peak). */
export function volumetricEfficiency(rpm: number): number {
  return 0.86 * (fullLoadTorque(rpm) / 255) + 0.04;
}

/** Air mass flow into the engine, kg/s. */
export function airMassFlow(rpm: number, mapPa: number): number {
  const rho = mapPa / (287 * 318); // intake air at about 45 °C
  return volumetricEfficiency(rpm) * rho * ENGINE.displacement * (rpm / 120);
}

/** Fuel mass flow at stoichiometric mixture (14.7:1), kg/s. */
export function fuelMassFlow(airKgS: number, lambda = 1): number {
  return airKgS / (14.7 * lambda);
}

/** Lower heating value of gasoline, J/kg. */
export const FUEL_LHV = 43e6;

/**
 * The gas torque of one cylinder at a phase: (cylinder pressure − crankcase pressure) × piston
 * area × the piston's lever on the crank (dx/dθ). Positive drives the crank. N·m.
 */
export function gasTorque(phase: number, manifoldPa: number, combustion: number, spark: number): number {
  const p = cylinderPressure(phase, manifoldPa, combustion, spark);
  const alpha = (phase % 360) * DEG;
  return (p - 1.0e5) * PISTON_AREA * pistonDropRate(alpha);
}

/**
 * The shape of the engine's instantaneous torque through one cycle, normalised so its mean
 * equals `meanTorque`: the four cylinders' gas torques summed (a misfiring cylinder adds none).
 * Used to draw the firing pulses and the crank's speed ripple; the vehicle model uses the mean.
 * Returns a function of crank angle (rad).
 */
export function torqueRipple(manifoldPa: number, spark: number, combustion: readonly number[], meanTorque: number): (theta: number) => number {
  const N = 720;
  const tab = new Float64Array(N);
  let sum = 0;
  for (let k = 0; k < N; k++) {
    const theta = k * DEG;
    let t = 0;
    for (let i = 0; i < 4; i++) t += gasTorque(phaseDeg(i, theta), manifoldPa, combustion[i], spark);
    tab[k] = t;
    sum += t;
  }
  const mean = sum / N;
  const scale = Math.abs(mean) > 1e-6 ? meanTorque / mean : 0;
  return (theta: number) => {
    const d = ((theta / DEG) % 720 + 720) % 720;
    const i = Math.floor(d);
    const a = d - i;
    return (tab[i] * (1 - a) + tab[(i + 1) % N] * a) * (scale || 0) + (scale ? 0 : meanTorque);
  };
}
