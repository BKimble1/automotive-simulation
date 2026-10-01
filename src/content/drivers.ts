/**
 * Driver scripts for the lessons and scenarios: small controllers that drive the model the way a
 * calm test driver would (hold a speed, follow the lane through a corner, brake hard at a mark).
 * They only read the car's state and set its inputs, at every 1 ms model step, so a lesson is as
 * deterministic as the model.
 */
import type { CarState, Inputs } from '../sim/car';
import { BODY, STEERING, units } from '../spec/vehicle';

export type Drive = (t: number, inp: Inputs, s: CarState) => void;

/** The lane the road shader draws: straight, then (optionally) an arc of radius R (left +). */
export interface Lane {
  /** Arc radius, m (positive left, negative right, 0 straight). */
  R: number;
  /** Where the arc begins (road x, m). */
  curveX: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Steering-wheel angle that keeps the car on the lane's centre line. */
export function laneSteer(s: CarState, lane: Lane): number {
  let e: number;
  let hp: number;
  let kappa: number;
  if (!lane.R || s.X <= lane.curveX) {
    e = s.Z;
    hp = 0;
    kappa = 0;
  } else {
    const R = Math.abs(lane.R);
    const sg = Math.sign(lane.R);
    // centre of the arc at (curveX, −R·sign): a left turn curves toward −Z
    const dx = s.X - lane.curveX;
    const dz = s.Z + sg * R;
    const r = Math.hypot(dx, dz);
    // outside the arc is to the right in a left turn (positive e means steer left)
    e = sg * (r - R);
    hp = sg * Math.atan2(dx, sg * dz);
    kappa = sg / R;
  }
  const delta = Math.atan(BODY.wheelbase * kappa) * 1.12 + 1.4 * wrap(hp - s.heading) + 0.22 * e;
  const max = STEERING.maxWheelAngle;
  return Math.max(-max, Math.min(max, delta)) * STEERING.ratio;
}

/** Throttle that holds a speed (km/h), gently. */
export function holdSpeed(s: CarState, kmh: number, base = 0.12): number {
  const err = kmh - units.msToKmh(s.u);
  return Math.max(0, Math.min(0.85, base + err * 0.06));
}

/** Drive: hold `kmh` (in Drive) and follow the lane. */
export function cruise(kmh: number, lane: Lane = { R: 0, curveX: 0 }, base = 0.12): Drive {
  return (_t, inp, s) => {
    inp.ignition = true;
    inp.selector = 'D';
    inp.throttle = holdSpeed(s, kmh, base);
    inp.brakeN = 0;
    inp.steer = laneSteer(s, lane);
  };
}

/** Drive at `kmh`, then brake with `force` N from `at` s until stopped. */
export function brakeAt(kmh: number, at: number, force: number): Drive {
  return (t, inp, s) => {
    inp.ignition = true;
    inp.selector = 'D';
    inp.steer = laneSteer(s, { R: 0, curveX: 0 });
    if (t < at) {
      inp.throttle = holdSpeed(s, kmh, 0.18);
      inp.brakeN = 0;
    } else {
      inp.throttle = 0;
      // the pedal goes down quickly, as in an emergency, and stays down
      inp.brakeN = Math.min(force, (t - at) * force * 6);
    }
  };
}

/** Idle in Park, then select Drive and pull away firmly, holding a speed. */
export function pullAway(drive: number, go: number, throttle = 0.5, holdKmh = 0): Drive {
  return (t, inp, s) => {
    inp.ignition = true;
    inp.selector = t >= drive ? 'D' : 'P';
    inp.brakeN = t >= drive - 0.4 && t < go ? 120 : 0;
    inp.steer = laneSteer(s, { R: 0, curveX: 0 });
    if (t < go) inp.throttle = 0;
    else if (holdKmh && units.msToKmh(s.u) > holdKmh - 3) inp.throttle = holdSpeed(s, holdKmh);
    else inp.throttle = Math.min(throttle, (t - go) * 0.8);
  };
}

/** A smooth speed bump across the lane: `H` high over `len` metres, centred at road distance `at`. */
export function bump(at: number, H = 0.07, len = 0.7): (s: number) => number {
  const half = len / 2;
  return (s: number) => {
    const d = s - at;
    return Math.abs(d) < half ? H * 0.5 * (1 + Math.cos((Math.PI * d) / half)) : 0;
  };
}
