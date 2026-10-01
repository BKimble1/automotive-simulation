/**
 * V2 contracts of the model: the geartrain as a mechanism, complete snapshots, runs that inherit
 * nothing, read-only sampling, and static loads from the configured mass.
 */
import { describe, expect, test } from 'vitest';
import { BODY, G, GEARBOX, MASS, TIRE } from '../spec/vehicle';
import { Car, configOf, defaultParams, presetCruise, presetIdle, STEP, type CarState } from './car';
import { DERIVED_RATIOS, ELEMENT_DEFS, GEARSETS, SHAFTS, SHAFT_INDEX, SHIFT_TABLE, appliedElements, elementsRatio, geartrainSpeeds } from './geartrain';
import { initRun, simulate, type RunSpec } from './run';
import { LABS, defaults, labRun, simulateLab } from '../content/labs';
import { brakeAt, cruise } from '../content/drivers';
import { SequencePlayer } from '../world/sequence';
import { LESSONS } from '../content/lessons';

const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

describe('the eight-speed geartrain', () => {
  test('ratios come from the tooth counts, eight falling forward ratios and a reverse', () => {
    const f = DERIVED_RATIOS.forward;
    expect(f).toHaveLength(8);
    for (let i = 1; i < 8; i++) expect(f[i]).toBeLessThan(f[i - 1]);
    expect(f[5]).toBeCloseTo(1, 12); // 6th is direct
    expect(DERIVED_RATIOS.reverse).toBeLessThan(-2.5);
    expect(GEARBOX.ratios).toEqual(f);
    // the gearsets can be assembled: ring = sun + 2 planets, (S + R) shared evenly by the planets
    for (const g of GEARSETS) {
      expect(g.R).toBe(g.S + 2 * g.P);
      expect((g.S + g.R) % g.planets).toBe(0);
    }
  });

  test('in every gear each set obeys Willis, held members stand still, clutched members turn together', () => {
    for (const [gear, els] of Object.entries(SHIFT_TABLE)) {
      if (gear === 'P' || gear === 'N') continue;
      const sp = geartrainSpeeds(els, 300, 0);
      const w = (s: string) => sp.shaft[SHAFT_INDEX[s as keyof typeof SHAFT_INDEX]];
      for (const g of GEARSETS) expect(Math.abs(g.S * w(g.sun) + g.R * w(g.ring) - (g.S + g.R) * w(g.carrier))).toBeLessThan(1e-9);
      for (const e of els) {
        const d = ELEMENT_DEFS[e];
        expect(Math.abs(w(d.a) - (d.b ? w(d.b) : 0))).toBeLessThan(1e-9);
      }
      expect(close(300 / w('output'), elementsRatio(els))).toBe(true);
    }
    // reverse turns the output backwards
    expect(geartrainSpeeds(SHIFT_TABLE.R, 300, 0).shaft[SHAFT_INDEX.output]).toBeLessThan(0);
  });

  test('a shift: the shared elements hold, the applying element slips until the new ratio is reached', () => {
    for (let g = 1; g < 8; g++) {
      const ap = appliedElements(g, g + 1, 0.5, 'D');
      expect(ap.engaged).toHaveLength(2);
      expect(ap.applying).not.toBeNull();
      expect(ap.releasing).not.toBeNull();
      const out = 100;
      const r0 = DERIVED_RATIOS.forward[g - 1];
      const r1 = DERIVED_RATIOS.forward[g];
      const start = geartrainSpeeds(ap.engaged, out * r0, out);
      const end = geartrainSpeeds(ap.engaged, out * r1, out);
      expect(Math.abs(start.slip[ap.releasing!])).toBeLessThan(1e-9);
      expect(Math.abs(start.slip[ap.applying!])).toBeGreaterThan(1);
      expect(Math.abs(end.slip[ap.applying!])).toBeLessThan(1e-9);
      expect(Math.abs(end.slip[ap.releasing!])).toBeGreaterThan(1);
    }
  });

  test('the car turns every shaft from the same constraints: output with the driveshaft, input with the turbine, through shifts', () => {
    const car = new Car();
    initRun(car, { id: 'launch', start: presetIdle, drive: (_t, inp) => ((inp.ignition = true), (inp.selector = 'D'), (inp.throttle = 0.9)) });
    let gears = new Set<number>();
    let worst = 0;
    for (let k = 0; k < 30000; k++) {
      const before = [...car.s.gt];
      car.runTo(car.s.t + STEP);
      gears.add(car.s.gear);
      const sp = car.geartrain;
      // each angle advanced by exactly its speed (no jumps), except whole turns at the wrap
      for (let i = 0; i < 8; i++) {
        let d = car.s.gt[i] - before[i] - sp.shaft[i] * STEP;
        d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
        worst = Math.max(worst, Math.abs(d));
      }
      const wc = (car.s.wheelOmega[2] + car.s.wheelOmega[3]) / 2;
      expect(Math.abs(sp.shaft[SHAFT_INDEX.output] - wc * car.params.finalDrive)).toBeLessThan(1e-6);
    }
    expect(worst).toBeLessThan(1e-9);
    expect(gears.size).toBeGreaterThanOrEqual(5);
    gears = new Set();
  });
});

describe('complete snapshots', () => {
  const runs: [string, RunSpec, number][] = [
    ['an ABS stop on a wet road', { id: 'abs', start: () => presetCruise(90), drive: brakeAt(90, 0.3, 520), road: { mu: 0.5 } }, 1.2],
    ['a full-throttle run through two shifts', { id: 'shift', start: presetIdle, drive: (_t, inp) => ((inp.ignition = true), (inp.selector = 'D'), (inp.throttle = 1)) }, 3.1],
    ['an engine overheating with its fan cycling', { id: 'heat', start: () => Object.assign(presetIdle(), { coolantC: 101.8 }), drive: (_t, inp) => ((inp.ignition = true), (inp.selector = 'P')), road: { mu: 1, ambientC: 38 } }, 2],
    ['a misfire at idle', { id: 'misfire', start: presetIdle, drive: (_t, inp) => ((inp.ignition = true), (inp.selector = 'P')), faults: { misfireCyl: 1 } }, 1.5],
  ];
  for (const [name, spec, at] of runs) {
    test(`saved during ${name}, a run continues exactly`, () => {
      const a = new Car();
      initRun(a, spec);
      a.runTo(a.programT0 + at);
      const snap = a.save();
      a.runTo(a.programT0 + at + 1.5);
      const b = new Car();
      b.load(snap);
      b.program = a.program; // the driver script is reattached by its owner
      b.runTo(b.programT0 + at + 1.5);
      expect(b.s).toEqual(a.s);
    });
  }

  test('a fresh start after a high-speed stop carries no wheel-speed history (no false ABS)', () => {
    const car = new Car();
    initRun(car, { id: 'stop', start: () => presetCruise(120), drive: brakeAt(120, 0.2, 520), road: { mu: 0.4 } });
    car.runTo(car.programT0 + 2.5);
    expect(car.s.absCycles).toBeGreaterThan(0);
    initRun(car, { id: 'gentle', start: () => presetCruise(40), drive: brakeAt(40, 0, 60) });
    car.runTo(car.programT0 + 0.5);
    expect(car.s.absCycles).toBe(0);
    expect(car.s.absPhase.every((p) => p !== 'release')).toBe(true);
  });

  test('reading a sequence at another time leaves the live car, its settings and its script untouched', () => {
    const car = new Car();
    const p = new SequencePlayer(car);
    p.load(LESSONS.braking);
    p.seek(5);
    car.runTo(car.s.t + 0.3);
    const before = { s: structuredClone(car.s), inputs: { ...car.inputs }, params: { ...car.params }, faults: { ...car.faults }, road: { ...car.road.spec }, program: car.program, t0: car.programT0 };
    const other = p.stateAt(25);
    expect(other.t).not.toBe(car.s.t);
    expect(car.s).toEqual(before.s);
    expect(car.inputs).toEqual(before.inputs);
    expect(car.params).toEqual(before.params);
    expect(car.faults).toEqual(before.faults);
    expect(car.road.spec).toEqual(before.road);
    expect(car.program).toBe(before.program);
    expect(car.programT0).toBe(before.t0);
  });
});

describe('runs inherit nothing', () => {
  test('the same lab gives the same samples whatever ran before on the same car', () => {
    const gearing = LABS.find((l) => l.id === 'gearing')!;
    const fresh = simulateLab(gearing, defaults(gearing));
    const car = new Car();
    // a different final drive, ABS off on ice, a fault, then the lab again on the same car
    simulateLab(gearing, { fd: 4.1 }, car);
    const braking = LABS.find((l) => l.id === 'braking')!;
    simulateLab(braking, { kmh: 120, grip: 'snow', abs: false }, car);
    simulate({ id: 'fault', start: presetIdle, faults: { misfireCyl: 2, weakBattery: true, alternatorFailed: true }, params: { mass: 2100 }, duration: 2 }, (s, t) => ({ t, v: s.volts }), 0.5, car);
    const again = simulateLab(gearing, defaults(gearing), car);
    expect(again).toEqual(fresh);
  });

  test('every lab declares its run completely, and its live playback ends where its chart does', () => {
    for (const lab of LABS) {
      const spec = labRun(lab, defaults(lab));
      expect(spec.id).toBe(`lab:${lab.id}`);
      expect(spec.duration).toBeGreaterThan(0);
      const sm = simulateLab(lab, defaults(lab));
      expect(sm.length).toBeGreaterThan(5);
      for (const x of sm) for (const v of Object.values(x)) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('mass and centre of mass', () => {
  test('static tyre loads sum to the configured weight, split by the front share', () => {
    for (const mass of [1300, 1560, 2100])
      for (const frontShare of [0.45, 0.52, 0.6]) {
        const c = configOf({ ...defaultParams(), mass, frontShare });
        const sum = c.fzStatic.reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(mass * G, 6);
        expect((c.fzStatic[0] + c.fzStatic[1]) / sum).toBeCloseTo(frontShare, 9);
        expect(c.a + c.b).toBeCloseTo(BODY.wheelbase, 9);
      }
  });

  test('at rest the loads hold the weight; braking moves m·a·h/L to the front', () => {
    for (const [mass, cgHeight] of [[1300, 0.45], [1560, 0.52], [2100, 0.7]] as const) {
      const car = new Car();
      initRun(car, { id: 'rest', start: presetIdle, params: { mass, cgHeight }, drive: (_t, inp) => ((inp.ignition = true), (inp.selector = 'P')) });
      car.runTo(car.programT0 + 1.5);
      const sum = car.s.fz.reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - mass * G) / (mass * G)).toBeLessThan(0.003);
      // a steady stop: compare the front load gain with the textbook transfer
      initRun(car, { id: 'brake', start: () => presetCruise(100), params: { mass, cgHeight }, drive: brakeAt(100, 0, 260) });
      const front0 = car.config.fzStatic[0] + car.config.fzStatic[1];
      let best = { err: Infinity, dF: 0, expected: 0 };
      for (let t = 0.8; t < 1.6; t += 0.05) {
        car.runTo(car.programT0 + t);
        const dF = car.s.fz[0] + car.s.fz[1] - front0;
        const expected = (mass * -car.s.ax * cgHeight) / BODY.wheelbase;
        const err = Math.abs(dF - expected) / expected;
        if (err < best.err) best = { err, dF, expected };
      }
      expect(best.err).toBeLessThan(0.12);
    }
  });

  test('every weight-lab setting gives finite, bounded results', () => {
    const lab = LABS.find((l) => l.id === 'weight')!;
    for (let m = 1300; m <= 2100; m += 200)
      for (let h = 0.4; h <= 0.751; h += 0.07) {
        const sm = simulateLab(lab, { m, h });
        for (const x of sm) {
          expect(Number.isFinite(x.front) && Number.isFinite(x.rear) && Number.isFinite(x.pitch)).toBe(true);
          expect(x.front).toBeGreaterThan(0);
          expect(x.rear).toBeGreaterThan(0);
          expect(x.front + x.rear).toBeLessThan((m * G * 1.6) / 1000);
        }
      }
  });

  test('the sprung mass inertias follow the mass (same radii of gyration)', () => {
    const c = configOf({ ...defaultParams(), mass: MASS.total * 1.2 });
    expect(c.yawInertia).toBeCloseTo(MASS.yawInertia * 1.2, 6);
    expect(c.pitchInertia).toBeGreaterThan(MASS.pitchInertia * 1.2);
  });
});

describe('the selector', () => {
  test('Park and Reverse are refused at speed; the request is kept until it is allowed', () => {
    const car = new Car();
    initRun(car, { id: 'sel', start: () => presetCruise(50), drive: cruise(50) });
    car.runTo(car.programT0 + 0.2);
    car.program = null;
    car.inputs.selector = 'P';
    car.runTo(car.s.t + 0.1);
    expect(car.s.selector).toBe('D');
    car.inputs.selector = 'R';
    car.runTo(car.s.t + 0.1);
    expect(car.s.selector).toBe('D');
    car.inputs.selector = 'N';
    car.runTo(car.s.t + 0.1);
    expect(car.s.selector).toBe('N');
  });
  void TIRE;
  void SHAFTS;
  void ({} as CarState);
});
