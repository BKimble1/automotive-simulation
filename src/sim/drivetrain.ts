/**
 * The drivetrain's models: the torque converter, the eight-speed automatic's ratios and shift
 * schedule, a single planetary gearset (the teaching view that explains how one gearset makes
 * several ratios; the real geartrain is geartrain.ts), the final drive and the open
 * differential.
 *
 * Rotation directions (vehicle coordinates: x forward, y up, z right):
 *   - the crankshaft turns clockwise seen from the front: its angular velocity points along −x;
 *   - in forward gears the transmission output and the driveshaft turn the same way;
 *   - the pinion drives the ring gear from the ring gear's left (−z) side, so the ring gear, the
 *     half shafts and the rear wheels turn about −z when the car moves forward (+x);
 *   - wheel spin angle φ: positive φ is forward rolling (the mesh rotates by −φ about z).
 * Every drawn shaft follows these signs (tested).
 */
import { CONVERTER, GEARBOX } from '../spec/vehicle';

// ─────────────────────────── torque converter ───────────────────────────

/** Torque ratio (turbine / impeller torque) at a speed ratio (turbine / impeller speed). */
export function converterTorqueRatio(sr: number): number {
  const s = Math.max(0, Math.min(1, sr));
  if (s >= CONVERTER.couplingPoint) return 1;
  return CONVERTER.stallTorqueRatio - ((CONVERTER.stallTorqueRatio - 1) * s) / CONVERTER.couplingPoint;
}

/**
 * Capacity factor K (rpm/√(N·m)) at a speed ratio: the impeller absorbs T = (N/K)². K rises
 * steeply toward a speed ratio of 1, where no fluid circulates and no torque is passed.
 */
export function converterK(sr: number): number {
  const s = Math.max(0, Math.min(0.995, sr));
  const base = CONVERTER.kStall * (1 + 0.15 * s);
  return base / Math.sqrt(Math.max(1e-4, 1 - Math.pow(s, 6)));
}

/** Impeller torque (load on the engine), N·m, for impeller and turbine speeds in rpm. */
export function impellerTorque(impRpm: number, turbRpm: number): number {
  if (impRpm <= 1) return 0;
  const sr = turbRpm / impRpm;
  if (sr >= 1) {
    // overrun (the wheels drive the engine): the converter passes torque back, weakly
    const k = CONVERTER.kStall * 1.6;
    return -Math.min(400, Math.pow((turbRpm - impRpm) / k, 2) * 4);
  }
  const k = converterK(sr);
  return Math.pow(impRpm / k, 2);
}

/** Is the stator held by its one-way clutch (multiplying torque) or freewheeling (coupling)? */
export function statorHeld(sr: number): boolean {
  return sr < CONVERTER.couplingPoint;
}

// ─────────────────────────── eight-speed automatic ───────────────────────────

/**
 * Shift elements and the geartrain that uses them live in geartrain.ts (four gearsets, five
 * elements, eight shafts); the ratios here are derived from its tooth counts.
 */
export { ELEMENTS, SHIFT_TABLE, ELEMENT_DEFS, type Element } from './geartrain';

export function gearRatio(gear: number): number {
  if (gear === -1) return GEARBOX.reverse;
  if (gear <= 0) return 0;
  return GEARBOX.ratios[Math.min(GEARBOX.ratios.length, gear) - 1];
}

/** Overall ratio from engine to wheels in a gear (transmission × final drive). */
export function overallRatio(gear: number): number {
  return gearRatio(gear) * GEARBOX.finalDrive;
}

/**
 * Shift schedule: the engine speed at which to change up, from throttle (light throttle
 * changes early, full throttle near the red line), and the one at which to change down.
 */
export function upshiftRpm(throttle: number): number {
  const t = Math.max(0, Math.min(1, throttle));
  return GEARBOX.upshiftLight + (GEARBOX.upshiftFull - GEARBOX.upshiftLight) * Math.pow(t, 1.4);
}
export function downshiftRpm(throttle: number): number {
  const t = Math.max(0, Math.min(1, throttle));
  return GEARBOX.downshift + 2400 * Math.pow(t, 2);
}

// ─────────────── one planetary gearset (the teaching view, not the S-1's geartrain) ───────────────

/** Tooth counts of the lesson's planetary gearset: ring = sun + 2 × planet. */
export const PLANETARY = { sun: 30, planet: 24, ring: 78 } as const;

/**
 * Willis' equation for a simple planetary gearset: S·ωs + R·ωr = (S + R)·ωc. Given two of the
 * three speeds (pass undefined for the unknown), returns all three.
 */
export function planetarySpeeds(known: { sun?: number; ring?: number; carrier?: number }): { sun: number; ring: number; carrier: number; planet: number } {
  const S = PLANETARY.sun;
  const R = PLANETARY.ring;
  const P = PLANETARY.planet;
  let { sun, ring, carrier } = known;
  if (carrier === undefined) carrier = (S * sun! + R * ring!) / (S + R);
  else if (ring === undefined) ring = ((S + R) * carrier - S * sun!) / R;
  else if (sun === undefined) sun = ((S + R) * carrier - R * ring) / S;
  // each planet spins on its pin, relative to the carrier: ωp = (ωr − ωc)·R/P
  const planet = ((ring! - carrier) * R) / P;
  return { sun: sun!, ring: ring!, carrier, planet };
}

/** The lesson's four ways to use one gearset: what is held, what drives, what is driven. */
export type PlanetaryMode = 'reduction' | 'overdrive' | 'reverse' | 'direct';
export const PLANETARY_MODES: Record<PlanetaryMode, { input: 'sun' | 'ring' | 'carrier'; held: 'sun' | 'ring' | 'carrier' | 'locked'; output: 'sun' | 'ring' | 'carrier'; label: string }> = {
  reduction: { input: 'sun', held: 'ring', output: 'carrier', label: 'Sun drives, ring held, carrier out: low gear' },
  overdrive: { input: 'carrier', held: 'sun', output: 'ring', label: 'Carrier drives, sun held, ring out: overdrive' },
  reverse: { input: 'sun', held: 'carrier', output: 'ring', label: 'Sun drives, carrier held, ring out: reverse' },
  direct: { input: 'sun', held: 'locked', output: 'carrier', label: 'Two members locked together: direct drive (1:1)' },
};

/** Speeds of every member for an input speed in a mode. */
export function planetaryMode(mode: PlanetaryMode, inputSpeed: number) {
  const m = PLANETARY_MODES[mode];
  if (m.held === 'locked') return { sun: inputSpeed, ring: inputSpeed, carrier: inputSpeed, planet: 0 };
  const known: { sun?: number; ring?: number; carrier?: number } = {};
  known[m.input] = inputSpeed;
  known[m.held] = 0;
  return planetarySpeeds(known);
}

/** Gear ratio (input speed / output speed) of a mode. */
export function planetaryRatio(mode: PlanetaryMode): number {
  const s = planetaryMode(mode, 1);
  const out = s[PLANETARY_MODES[mode].output];
  return 1 / out;
}

// ─────────────────────────── final drive and differential ───────────────────────────

/**
 * Open differential: the carrier (with the ring gear) turns at the average of the two wheel
 * speeds; each side gets half the torque. The spider gears spin on their cross pin at
 * (ωL − ωR)/2 × (side-gear teeth / spider-gear teeth).
 */
export const DIFF = { sideTeeth: 18, spiderTeeth: 11 } as const;

export function diffSpeeds(carrier: number, left: number | undefined, right: number | undefined): { left: number; right: number; spider: number } {
  let l = left;
  let r = right;
  if (l === undefined) l = 2 * carrier - r!;
  if (r === undefined) r = 2 * carrier - l;
  const spider = ((l - r) / 2) * (DIFF.sideTeeth / DIFF.spiderTeeth);
  return { left: l, right: r, spider };
}

/** Wheel speeds in a steady turn of radius R (to the car's centre line) at speed v: inner slower. */
export function cornerWheelSpeeds(v: number, radius: number, track: number, rollingRadius: number, turnLeft: boolean) {
  const inner = (v * (radius - track / 2)) / radius / rollingRadius;
  const outer = (v * (radius + track / 2)) / radius / rollingRadius;
  return turnLeft ? { left: inner, right: outer } : { left: outer, right: inner };
}
