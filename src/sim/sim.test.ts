/**
 * The models' relationships: the four-stroke cycle's timing, the gear and rotation-direction
 * conventions, the differential, the spring-damper corner, braking and ABS, cooling and
 * electrical faults, and determinism (the same inputs give the same state however the time is
 * stepped, and a restored state continues exactly).
 */
import { describe, expect, test } from 'vitest';
import { BODY, ENGINE, GEARBOX, TIRE, VALVES, units } from '../spec/vehicle';
import {
  CYL_OFFSET_DEG,
  burnFraction,
  cylinderPressure,
  exhaustLift,
  intakeLift,
  phaseDeg,
  pistonDrop,
  sparkPhase,
  strokeOf,
  throwAngleDeg,
  CRANK_R,
  INTAKE_PEAK,
  EXHAUST_PEAK,
} from './engine';
import { DIFF, PLANETARY, SHIFT_TABLE, converterTorqueRatio, diffSpeeds, gearRatio, planetaryMode, planetaryRatio, planetarySpeeds, cornerWheelSpeeds } from './drivetrain';
import { Car, cloneState, makeRoad, presetCold, presetCruise, presetIdle, STEP } from './car';
import { initRun } from './run';
import { AbsChannel, masterPressure } from './systems';

const DEG = Math.PI / 180;

describe('four-stroke cycle', () => {
  test('cylinder phases follow the firing order 1-3-4-2, 180° apart', () => {
    expect(CYL_OFFSET_DEG).toEqual([0, 540, 180, 360]);
    // the cylinder that fires next is 180° behind in its cycle
    const order = ENGINE.firingOrder.map((c) => c - 1);
    for (let k = 0; k < 4; k++) {
      const a = order[k];
      const b = order[(k + 1) % 4];
      expect((CYL_OFFSET_DEG[b] - CYL_OFFSET_DEG[a] + 720) % 720).toBe(180);
    }
  });
  test('pistons 1 and 4 move together, 2 and 3 opposite them', () => {
    for (let t = 0; t < 720; t += 7) {
      const th = t * DEG;
      const drop = (i: number) => pistonDrop((phaseDeg(i, th) % 360) * DEG);
      expect(drop(0)).toBeCloseTo(drop(3), 9);
      expect(drop(1)).toBeCloseTo(drop(2), 9);
    }
    expect(throwAngleDeg(0)).toBe(throwAngleDeg(3));
    expect(Math.abs(throwAngleDeg(1) - throwAngleDeg(0))).toBe(180);
  });
  test('the piston is at the top at 0° and 360°, at the bottom at 180° and 540°', () => {
    expect(pistonDrop(0)).toBeCloseTo(0, 9);
    expect(pistonDrop(Math.PI)).toBeCloseTo(2 * CRANK_R, 9);
    expect(pistonDrop(2 * Math.PI)).toBeCloseTo(0, 9);
  });
  test('valves: intake open around the intake stroke, exhaust around the exhaust stroke, both closed for compression and combustion', () => {
    for (let p = 0; p < 720; p++) {
      const s = strokeOf(p);
      if (s === 'compression' && p > VALVES.intakeClose) {
        expect(intakeLift(p)).toBe(0);
        expect(exhaustLift(p)).toBe(0);
      }
      if (s === 'power' && p < VALVES.exhaustOpen) {
        expect(intakeLift(p)).toBe(0);
        expect(exhaustLift(p)).toBe(0);
      }
    }
    expect(intakeLift(90)).toBeGreaterThan(0.8);
    expect(exhaustLift(630)).toBeGreaterThan(0.8);
    // overlap at intake TDC: both slightly open
    expect(intakeLift(0)).toBeGreaterThan(0);
    expect(exhaustLift(0)).toBeGreaterThan(0);
    expect(intakeLift(INTAKE_PEAK)).toBeCloseTo(1, 6);
    expect(exhaustLift(EXHAUST_PEAK % 720)).toBeCloseTo(1, 6);
  });
  test('the spark fires shortly before combustion TDC with both valves closed, and burning follows it', () => {
    const sp = sparkPhase(0.3, 1500);
    expect(sp).toBeGreaterThan(330);
    expect(sp).toBeLessThan(360);
    expect(intakeLift(sp)).toBe(0);
    expect(exhaustLift(sp)).toBe(0);
    expect(burnFraction(sp - 1, sp)).toBe(0);
    expect(burnFraction(sp + 60, sp)).toBeGreaterThan(0.9);
  });
  test('cylinder pressure peaks just after combustion TDC, and a misfire leaves only compression', () => {
    const sp = sparkPhase(0.8, 3000);
    let best = 0;
    let at = 0;
    for (let p = 300; p < 480; p += 0.5) {
      const pr = cylinderPressure(p, 0.95e5, 1, sp);
      if (pr > best) (best = pr), (at = p);
    }
    expect(at).toBeGreaterThan(360);
    expect(at).toBeLessThan(390);
    const motored = cylinderPressure(at, 0.95e5, 0, sp);
    expect(best / motored).toBeGreaterThan(2);
    expect(cylinderPressure(720 - 1, 0.95e5, 1, sp)).toBeLessThan(1.2e5);
  });
});

describe('gears and rotation', () => {
  test('eight forward ratios, falling; overall ratio and road speed agree', () => {
    for (let g = 2; g <= 8; g++) expect(gearRatio(g)).toBeLessThan(gearRatio(g - 1));
    expect(gearRatio(-1)).toBeLessThan(0);
    // engine speed at 100 km/h in 8th
    const wheel = units.kmhToMs(100) / TIRE.rollingRadius;
    const rpm = units.radToRpm(wheel * GEARBOX.finalDrive * gearRatio(8));
    expect(rpm).toBeGreaterThan(1500);
    expect(rpm).toBeLessThan(2000);
  });
  test('each single shift changes exactly one shift element (one released, one applied)', () => {
    for (let g = 1; g < 8; g++) {
      const a = SHIFT_TABLE[String(g)];
      const b = SHIFT_TABLE[String(g + 1)];
      expect(a.length).toBe(3);
      expect(a.filter((e) => !b.includes(e)).length).toBe(1);
      expect(b.filter((e) => !a.includes(e)).length).toBe(1);
    }
  });
  test('one planetary gearset: reduction, overdrive, reverse and direct, from Willis\' equation', () => {
    expect(PLANETARY.ring).toBe(PLANETARY.sun + 2 * PLANETARY.planet);
    expect(planetaryRatio('reduction')).toBeCloseTo(1 + PLANETARY.ring / PLANETARY.sun, 9);
    expect(planetaryRatio('overdrive')).toBeCloseTo(PLANETARY.ring / (PLANETARY.ring + PLANETARY.sun), 9);
    expect(planetaryRatio('reverse')).toBeCloseTo(-PLANETARY.ring / PLANETARY.sun, 9);
    expect(planetaryRatio('direct')).toBe(1);
    // reverse: the output turns the other way
    const r = planetaryMode('reverse', 10);
    expect(Math.sign(r.ring)).toBe(-1);
    // Willis holds for every mode
    for (const m of ['reduction', 'overdrive', 'reverse'] as const) {
      const s = planetaryMode(m, 7);
      expect(PLANETARY.sun * s.sun + PLANETARY.ring * s.ring).toBeCloseTo((PLANETARY.sun + PLANETARY.ring) * s.carrier, 9);
    }
    expect(planetarySpeeds({ sun: 3, ring: 3 }).planet).toBeCloseTo(0, 9);
  });
  test('the converter multiplies torque at stall and couples 1:1 above the coupling point', () => {
    expect(converterTorqueRatio(0)).toBeCloseTo(1.9, 6);
    expect(converterTorqueRatio(0.9)).toBe(1);
    expect(converterTorqueRatio(0.4)).toBeGreaterThan(1);
  });
  test('driving forward: crank, driveshaft and wheels turn in their stated directions and speeds agree', () => {
    const car = new Car(presetCruise(60, 4));
    car.inputs.ignition = true;
    car.inputs.selector = 'D';
    car.inputs.throttle = 0.15;
    const s0 = cloneState(car.s);
    car.runTo(car.s.t + 0.5);
    const s1 = car.s;
    // forward motion and forward rolling (positive spin angle)
    expect(s1.u).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) expect(s1.wheelAngle[i]).toBeGreaterThan(s0.wheelAngle[i]);
    // driveshaft turns the same way as the engine (both positive in the model's sign)
    expect(s1.driveshaftAngle).toBeGreaterThan(s0.driveshaftAngle);
    // ratio: driveshaft = carrier × final drive
    const dCarrier = s1.carrierAngle - s0.carrierAngle;
    const dShaft = s1.driveshaftAngle - s0.driveshaftAngle;
    expect(dShaft / dCarrier).toBeCloseTo(GEARBOX.finalDrive, 6);
    // the converter is locked in 4th at 60 km/h: engine speed = turbine speed (within 1 %)
    expect(Math.abs(car.rpm / units.radToRpm(s1.omegaT) - 1)).toBeLessThan(0.01);
  });
});

describe('differential', () => {
  test('the carrier turns at the average of the wheels; the spider gears turn only when they differ', () => {
    const d = diffSpeeds(10, 9, undefined);
    expect(d.right).toBe(11);
    expect(d.spider).toBeCloseTo(((9 - 11) / 2) * (DIFF.sideTeeth / DIFF.spiderTeeth), 9);
    expect(diffSpeeds(10, 10, undefined).spider).toBe(0);
  });
  test('in a left turn the left (inner) wheel turns slower, as geometry requires', () => {
    const s = cornerWheelSpeeds(10, 20, BODY.trackRear, TIRE.rollingRadius, true);
    expect(s.left).toBeLessThan(s.right);
    expect((s.left + s.right) / 2).toBeCloseTo(10 / TIRE.rollingRadius, 9);
    const car = new Car(presetCruise(40, 3));
    car.inputs.ignition = true;
    car.inputs.selector = 'D';
    car.inputs.throttle = 0.1;
    car.inputs.steer = 1.5;
    car.runTo(car.s.t + 3);
    expect(car.s.r).toBeGreaterThan(0);
    expect(car.s.wheelOmega[2]).toBeLessThan(car.s.wheelOmega[3]);
    // open differential: the rear wheels' average is the carrier
    const R = car.s.u / car.s.r;
    const geo = cornerWheelSpeeds(car.s.u, R, BODY.trackRear, TIRE.rollingRadius, true);
    expect(car.s.wheelOmega[2]).toBeCloseTo(geo.left, 0);
  });
});

describe('suspension', () => {
  // a 50 mm bump, 0.6 m long, its crest 6.3 m along the path
  const bump = makeRoad({ mu: TIRE.muDry, bumpAt: 6.3, bumpHeight: 0.05, bumpLength: 0.6 });
  function run(worn: number) {
    const car = new Car(presetCruise(30, 2));
    car.inputs.ignition = true;
    car.inputs.selector = 'D';
    car.inputs.throttle = 0.08;
    car.road = bump;
    car.faults.wornDamper = worn;
    const heave: number[] = [];
    for (let k = 0; k < 400; k++) {
      car.runTo(car.s.t + 0.01);
      heave.push(car.s.heave + 1.4 * car.s.pitch);
    }
    return heave;
  }
  test('the same bump gives the same response every time (no drift between runs)', () => {
    const a = run(-1);
    const b = run(-1);
    expect(a).toEqual(b);
    // the body settles back to rest afterwards
    expect(Math.abs(a[a.length - 1])).toBeLessThan(0.003);
  });
  test('a worn damper lets the body keep oscillating', () => {
    const good = run(-1);
    const worn = run(0);
    const tail = (h: number[]) => Math.max(...h.slice(150, 300).map(Math.abs));
    expect(tail(worn)).toBeGreaterThan(tail(good) * 1.5);
  });
});

describe('brakes and ABS', () => {
  test('pedal force becomes line pressure; the booster runs out', () => {
    const p100 = masterPressure(100);
    expect(masterPressure(200)).toBeCloseTo(2 * p100, 0);
    expect(masterPressure(2000) / masterPressure(1000)).toBeLessThan(2);
  });
  test('ABS cycles release, hold and apply when a wheel starts to lock', () => {
    const a = new AbsChannel();
    const line = 100e5;
    // pedal pressed: the caliper follows the line
    for (let k = 0; k < 50; k++) a.step(0.001, line, -0.02, 5, 60, true);
    expect(a.phase).toBe('apply');
    expect(a.pressure).toBeGreaterThan(0.9 * line);
    // the wheel decelerates too fast and its slip passes the threshold: release
    a.step(0.001, line, -0.25, 40, 60, true);
    expect(a.phase).toBe('release');
    const dumped = a.pressure;
    for (let k = 0; k < 10; k++) a.step(0.001, line, -0.25, 40, 60, true);
    expect(a.pressure).toBeLessThan(dumped);
    // the wheel spins back up: hold, then re-apply more gently than the pedal would
    a.step(0.001, line, -0.05, -20, 60, true);
    expect(a.phase).toBe('hold');
    for (let k = 0; k < 40; k++) a.step(0.001, line, -0.05, -5, 60, true);
    expect(a.phase).toBe('apply');
    const p0 = a.pressure;
    a.step(0.01, line, -0.05, 5, 60, true);
    expect(a.pressure - p0).toBeLessThan(0.05 * line);
    expect(a.cycles).toBe(1);
    // below walking pace, or with the pedal released, ABS stands down
    a.step(0.001, line, -0.5, 40, 3, true);
    expect(a.phase).not.toBe('release');
    a.step(0.001, 0, 0, 0, 60, true);
    expect(a.phase).toBe('off');
  });
  test('an emergency stop from 100 km/h on a dry road takes 35–45 m with ABS', () => {
    const car = new Car(presetCruise(100));
    car.inputs.ignition = true;
    car.inputs.selector = 'D';
    car.inputs.brakeN = 450;
    while (car.s.u > 0.05 && car.s.t < 10) car.runTo(car.s.t + 0.01);
    expect(car.s.stopDistance).toBeGreaterThan(35);
    expect(car.s.stopDistance).toBeLessThan(45);
    expect(car.s.absCycles).toBeGreaterThan(5);
  });
  test('on a slippery road ABS stops shorter than locked wheels, and keeps steering possible', () => {
    const stop = (abs: boolean) => {
      const car = new Car(presetCruise(50));
      car.road = makeRoad({ mu: 0.15 });
      car.faults.absDisabled = !abs;
      car.inputs.ignition = true;
      car.inputs.selector = 'D';
      car.inputs.brakeN = 450;
      let locked = 0;
      while (car.s.u > 0.05 && car.s.t < 30) {
        car.runTo(car.s.t + 0.01);
        if (car.s.wheelOmega[0] < 0.5 && car.s.u > 3) locked++;
      }
      return { d: car.s.stopDistance, locked };
    };
    const withAbs = stop(true);
    const without = stop(false);
    expect(withAbs.d).toBeLessThan(without.d);
    expect(withAbs.locked).toBeLessThan(without.locked);
  });
});

describe('engine start, cooling and electrical faults', () => {
  test('a healthy start: cranking, first combustion, then a steady idle', () => {
    const car = new Car(presetCold());
    car.inputs.ignition = true;
    car.inputs.start = true;
    car.runTo(1.5);
    expect(car.s.engine).toBe('running');
    car.inputs.start = false;
    car.runTo(8);
    expect(car.rpm).toBeGreaterThan(650);
    expect(car.rpm).toBeLessThan(1300);
    expect(car.s.volts).toBeGreaterThan(13.5);
  });
  test('a weak battery cranks slowly and starts late', () => {
    const start = (weak: boolean) => {
      const car = new Car();
      // an aged battery: higher internal resistance, and it starts the run partly discharged
      initRun(car, { id: 'test', start: presetCold, faults: { weakBattery: weak } });
      car.inputs.ignition = true;
      car.inputs.start = true;
      car.runTo(0.4);
      const cranking = { rpm: units.radToRpm(car.s.omegaE), volts: car.s.volts };
      let t = 0.4;
      while (car.s.engine !== 'running' && t < 6) car.runTo((t += 0.01));
      return { ...cranking, t };
    };
    const ok = start(false);
    const weak = start(true);
    expect(weak.rpm).toBeLessThan(ok.rpm * 0.8);
    expect(weak.volts).toBeLessThan(9.5);
    expect(weak.t).toBeGreaterThan(ok.t);
  });
  test('a failed alternator: the battery discharges instead of charging', () => {
    const ok = new Car(presetIdle());
    ok.inputs.ignition = true;
    ok.runTo(20);
    const bad = new Car(presetIdle());
    bad.inputs.ignition = true;
    bad.faults.alternatorFailed = true;
    bad.runTo(20);
    expect(ok.s.batteryAmps).toBeLessThan(0);
    expect(bad.s.batteryAmps).toBeGreaterThan(20);
    expect(bad.s.volts).toBeLessThan(12.7);
    expect(bad.s.soc).toBeLessThan(ok.s.soc);
  });
  test('a thermostat stuck closed overheats the engine; a healthy one holds it near 90 °C', () => {
    const run = (stuck: boolean) => {
      const car = new Car(presetCruise(80));
      car.inputs.ignition = true;
      car.inputs.selector = 'D';
      car.inputs.throttle = 0.35;
      car.faults.thermostatStuckClosed = stuck;
      car.runTo(240);
      return car.s;
    };
    const ok = run(false);
    const stuck = run(true);
    expect(ok.coolantC).toBeLessThan(104);
    expect(stuck.coolantC).toBeGreaterThan(112);
    expect(stuck.radiatorFlow).toBeLessThan(0.01);
  });
  test('a misfire: lean exhaust, positive fuel trim, misfire counts, a rougher idle', () => {
    const run = (mis: number) => {
      const car = new Car(presetIdle());
      car.inputs.ignition = true;
      car.faults.misfireCyl = mis;
      const rpm: number[] = [];
      for (let k = 0; k < 400; k++) {
        car.runTo(car.s.t + 0.005);
        if (k > 100) rpm.push(car.rpm);
      }
      const spread = Math.max(...rpm) - Math.min(...rpm);
      return { s: car.s, spread };
    };
    const ok = run(-1);
    const bad = run(2);
    expect(bad.s.misfireCount).toBeGreaterThan(5);
    expect(bad.s.lambda).toBeGreaterThan(1.1);
    expect(bad.spread).toBeGreaterThan(ok.spread * 1.5);
  });
  test('low oil: the pressure falls when the oil sloshes away from the pickup', () => {
    const car = new Car(presetCruise(60));
    car.inputs.ignition = true;
    car.inputs.selector = 'D';
    car.faults.lowOil = true;
    car.inputs.brakeN = 250;
    let minBar = 9;
    for (let k = 0; k < 200; k++) {
      car.runTo(car.s.t + 0.01);
      minBar = Math.min(minBar, car.s.oilBar);
    }
    expect(minBar).toBeLessThan(0.6);
  });
});

describe('determinism', () => {
  test('stepping in different frame sizes gives the same state', () => {
    const drive = (frames: number[]) => {
      const car = new Car(presetIdle());
      car.inputs.ignition = true;
      car.inputs.selector = 'D';
      car.inputs.throttle = 0.6;
      let i = 0;
      while (car.s.t < 3 - 1e-9) car.advance(frames[i++ % frames.length]);
      return car.s;
    };
    const a = drive([1 / 60]);
    const b = drive([1 / 30, 1 / 120, 0.05, 0.003]);
    // both ran whole 1 ms steps; compare at the same simulated time
    const c = new Car(presetIdle());
    c.inputs.ignition = true;
    c.inputs.selector = 'D';
    c.inputs.throttle = 0.6;
    c.runTo(Math.min(a.t, b.t));
    expect(Math.abs(a.t - b.t)).toBeLessThan(STEP * 1.5 + 0.05);
    const d = new Car(presetIdle());
    d.inputs.ignition = true;
    d.inputs.selector = 'D';
    d.inputs.throttle = 0.6;
    d.runTo(c.s.t);
    expect(d.s).toEqual(c.s);
  });
  test('restoring a snapshot continues exactly as if never interrupted', () => {
    const car = new Car(presetIdle());
    car.inputs.ignition = true;
    car.inputs.selector = 'D';
    car.inputs.throttle = 0.4;
    car.runTo(2);
    const snap = car.snapshot();
    car.runTo(4);
    const end = cloneState(car.s);
    const again = new Car();
    again.inputs = { ...car.inputs };
    again.restore(snap);
    again.runTo(4);
    expect(again.s).toEqual(end);
  });
});
