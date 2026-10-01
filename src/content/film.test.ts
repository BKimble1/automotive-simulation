import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { FILM, FILM_BEATS, NARRATION, narrationScript, sentences, stretch } from './film';
import { scaledTime } from '../world/sequence';
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
