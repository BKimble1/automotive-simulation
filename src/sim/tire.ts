/**
 * Tyre forces (a simplified "magic formula"): longitudinal force from slip ratio, lateral force
 * from slip angle, combined by a friction ellipse so the two share the grip available.
 */
import { TIRE } from '../spec/vehicle';

/** Longitudinal force coefficient (F/Fz/μ) at slip ratio κ: peaks near TIRE.peakSlip, then falls a little. */
export function longitudinalCoefficient(kappa: number): number {
  const B = 11;
  const C = 1.65;
  const E = 0.3;
  const x = B * kappa;
  return Math.sin(C * Math.atan(x - E * (x - Math.atan(x))));
}

/** Lateral force coefficient at slip angle α (rad): linear at small angles, saturating near 8°. */
export function lateralCoefficient(alpha: number): number {
  const B = 8.5;
  const C = 1.4;
  const E = -0.6;
  const x = B * alpha;
  return Math.sin(C * Math.atan(x - E * (x - Math.atan(x))));
}

/** Slip ratio: (wheel surface speed − ground speed) / ground speed, kept finite near standstill. */
export function slipRatio(wheelOmega: number, groundSpeed: number, radius = TIRE.rollingRadius): number {
  const vw = wheelOmega * radius;
  const denom = Math.max(Math.abs(groundSpeed), Math.abs(vw), 0.5);
  return (vw - groundSpeed) / denom;
}

/**
 * Combined forces: longitudinal from κ, lateral from α, scaled to stay within μ·Fz (friction
 * ellipse). Returns forces in N.
 */
export function tireForces(kappa: number, alpha: number, fz: number, mu: number): { fx: number; fy: number; usage: number } {
  if (fz <= 0) return { fx: 0, fy: 0, usage: 0 };
  let fx = mu * fz * longitudinalCoefficient(kappa);
  let fy = -mu * fz * lateralCoefficient(alpha);
  const lim = mu * fz;
  const m = Math.hypot(fx, fy);
  if (m > lim) {
    fx *= lim / m;
    fy *= lim / m;
  }
  return { fx, fy, usage: Math.min(1.2, Math.hypot(fx, fy) / lim) };
}

/** Contact patch length, m, from load and pressure (area = load / pressure, width fixed). */
export function contactPatchLength(fz: number, pressureBar = TIRE.pressureBar): number {
  const area = Math.max(0, fz) / (pressureBar * 1e5 * 0.85);
  return area / (TIRE.widthMm / 1000);
}
