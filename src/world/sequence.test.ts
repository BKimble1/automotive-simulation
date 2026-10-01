import { describe, expect, it } from 'vitest';
import { Car } from '../sim/car';
import { SequencePlayer } from './sequence';
import { LESSONS } from '../content/lessons';
import type { Car as CarScene } from '../scene/car/build';

describe('sequences', () => {
  for (const id of ['start', 'torque-path', 'braking']) {
    it(`${id}: playing to a moment and seeking to it give the same car, bit for bit`, () => {
      const T = Math.min(LESSONS[id].beats.reduce((a, b) => a + b.duration, 0) - 0.5, 14.3);
      const played = new Car();
      const p = new SequencePlayer(played as unknown as CarScene & Car);
      p.load(LESSONS[id]);
      p.play();
      for (let t = 0; t < T; t += 1 / 30) {
        const target = p.update(1 / 30);
        if (target !== null) played.advanceTo(target);
      }
      const seeked = new Car();
      const q = new SequencePlayer(seeked as unknown as CarScene & Car);
      q.load(LESSONS[id]);
      q.seek(p.t);
      const target = q.update(0);
      if (target !== null) seeked.advanceTo(target);
      expect(seeked.s.t).toBeCloseTo(played.s.t, 9);
      expect(seeked.s.crank).toBe(played.s.crank);
      expect(seeked.s.omegaE).toBe(played.s.omegaE);
      expect(seeked.s.u).toBe(played.s.u);
      expect(seeked.s.gear).toBe(played.s.gear);
    });
  }
});
