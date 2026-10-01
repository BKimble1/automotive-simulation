import { describe, expect, it } from 'vitest';
import { LABS, defaults, simulateLab } from './labs';
import { VIEWS } from '../world/views';

describe('engineer labs', () => {
  it('has eight labs with views that exist', () => {
    expect(LABS.length).toBe(8);
    for (const l of LABS) expect(VIEWS[l.view], l.view).toBeDefined();
  });

  for (const lab of LABS)
    it(`${lab.id}: runs deterministically and gives finite results`, () => {
      const v = defaults(lab);
      const a = simulateLab(lab, v);
      const b = simulateLab(lab, v);
      expect(a.length).toBeGreaterThan(10);
      expect(a).toEqual(b);
      for (const r of lab.results(a, v)) expect(r.value, `${lab.id} ${r.label}`).not.toMatch(/NaN|Infinity/);
    });

  it('answers its questions the way physics says', () => {
    const lab = (id: string) => LABS.find((l) => l.id === id)!;
    const stop = (v: Record<string, unknown>) => Math.max(...simulateLab(lab('braking'), v as never).map((s) => s.d));
    // twice the speed, about four times the distance; wet longer than dry; ABS shorter than locked
    const d40 = stop({ kmh: 40, grip: 'dry', abs: true });
    const d80 = stop({ kmh: 80, grip: 'dry', abs: true });
    expect(d80 / d40).toBeGreaterThan(3.2);
    expect(d80 / d40).toBeLessThan(4.8);
    expect(stop({ kmh: 80, grip: 'wet', abs: true })).toBeGreaterThan(d80 * 1.4);
    expect(stop({ kmh: 80, grip: 'wet', abs: false })).toBeGreaterThan(stop({ kmh: 80, grip: 'wet', abs: true }));
    // a shorter final drive accelerates harder
    const t100 = (fd: number) => {
      const sm = simulateLab(lab('gearing'), { fd });
      return sm.find((s) => s.kmh >= 100)!.t;
    };
    expect(t100(3.9)).toBeLessThan(t100(2.8));
    // a higher centre of gravity moves more load forward
    const front = (h: number) => Math.max(...simulateLab(lab('weight'), { m: 1560, h }).map((s) => s.front));
    expect(front(0.7)).toBeGreaterThan(front(0.45));
  });
});
