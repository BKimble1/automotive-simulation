import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { FILM, FILM_BEATS, NARRATION, foldSpan, narrationScript, sentences, stretch } from './film';
import { scaledTime, SequencePlayer, type Sequence } from '../world/sequence';
import { Car } from '../sim/car';
import { LESSONS } from './lessons';
import { VIEWS } from '../world/views';

const SCRIPT = new URL('./narration.json', import.meta.url);

describe('the film', () => {
  it('uses only views that exist, with unique beat ids', () => {
    const ids = FILM_BEATS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of FILM_BEATS) expect(VIEWS[b.view], b.view).toBeDefined();
  });

  it('keeps a stretched beat’s mechanical span', () => {
    for (const ts of [0.0067, 1, { from: 1, to: 0.05, ramp: 0.6, delay: 3.6 }, { from: 0.012, to: 1, ramp: 3 }]) {
      const D = 6;
      const k = 1.7;
      expect(scaledTime(stretch(ts, k), D * k)).toBeCloseTo(scaledTime(ts, D), 9);
    }
  });

  it('a step that absorbs a skipped span plays both spans, starting faster and ending at its pace', () => {
    const ts = foldSpan(0.1, 7, 0.5);
    expect(scaledTime(ts, 7)).toBeCloseTo(0.1 * 7 + 0.5, 9);
    expect(typeof ts === 'object' && ts.to).toBe(0.1);
  });

  it('shows the upshift during its step, in the lesson and in the film, at the same mechanical moment', () => {
    const at = (seq: Sequence) => {
      const pl = new SequencePlayer(new Car());
      pl.load(seq);
      const b = pl.beats.find((x) => x.beat.id === 'upshift')!;
      const next = pl.beats[b.index + 1];
      // the shift begins between a fifth and a half of the way through the step
      const car = new Car();
      pl.sample(b.start + 0.2 * b.beat.duration, car);
      expect(car.s.gearTarget, `${seq.id}: still in first a fifth of the way in`).toBe(1);
      pl.sample(b.start + 0.5 * b.beat.duration, car);
      expect(car.s.gearTarget, `${seq.id}: changing up by half way`).toBe(2);
      return { kmh: car.s.u, mechNext: next.mechStart };
    };
    const lesson = at(LESSONS['torque-path']);
    const film = at(FILM);
    // the next step starts from the same mechanical moment in both
    expect(film.mechNext).toBeCloseTo(lesson.mechNext, 6);
  });

  it('holds the system voltage through the charging steps, as their captions say', () => {
    for (const seq of [LESSONS.electrical, FILM]) {
      const pl = new SequencePlayer(new Car());
      pl.load(seq);
      for (const id of ['charging', 'load']) {
        const b = pl.beats.find((x) => x.beat.id === id);
        if (!b) continue;
        for (let k = 1; k < 8; k++) {
          const car = new Car();
          pl.sample(b.start + (b.beat.duration * k) / 8, car);
          expect(car.s.volts, `${seq.id} ${id} at ${k}/8`).toBeGreaterThan(13.8);
          expect(car.s.batteryAmps, `${seq.id} ${id}: the battery charges`).toBeLessThan(0);
        }
      }
    }
  });

  it('splits captions into sentences', () => {
    expect(sentences('One. Two, three. 4 cylinders.')).toEqual(['One.', 'Two, three.', '4 cylinders.']);
  });

  it('has a narration script in step with its captions, and audio for every beat', () => {
    const version = NARRATION.version ?? 'film-1';
    const want = narrationScript(version);
    if (process.env.WRITE_NARRATION) writeFileSync(SCRIPT, JSON.stringify(want, null, 2) + '\n');
    expect(existsSync(SCRIPT)).toBe(true);
    const have = JSON.parse(readFileSync(SCRIPT, 'utf8'));
    expect(have.segments).toEqual(want.segments);
    // the bundled manifest has every segment, with the same cue texts
    for (const s of want.segments) {
      const m = NARRATION.segments.find((x) => x.id === s.id);
      expect(m, `narration for ${s.id}`).toBeDefined();
      expect(m!.cues.map((c) => c.text)).toEqual(s.cues.map((c: { text: string }) => c.text));
    }
  });

  it('runs five to seven minutes, every beat at least as long as its narration', () => {
    const total = FILM.beats.reduce((a, b) => a + b.duration, 0);
    expect(total).toBeGreaterThanOrEqual(300);
    expect(total).toBeLessThanOrEqual(420);
    for (const b of FILM.beats) {
      const seg = NARRATION.segments.find((s) => s.id === b.id)!;
      expect(b.duration).toBeGreaterThanOrEqual(seg.durationMs / 1000);
    }
  });
});
