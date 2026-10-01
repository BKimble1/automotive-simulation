/**
 * The film, “How a car becomes motion”: two opening beats, then the ten hero lessons in teaching
 * order, narrated. Each beat is one narration segment (its id); the bundled manifest gives each
 * segment's measured length and its cues' times, so the captions appear as they are spoken and a
 * beat lasts at least as long as its narration. A beat stretched to fit its narration keeps its
 * mechanical span (its time scale is slowed to match), so the car does exactly what the caption
 * describes, at any length.
 *
 * The narration is bundled audio (public/narration/<version>/), generated offline with the
 * Kokoro pipeline in tools/narration; nothing is synthesised at run time.
 */
import type { Beat, Cue, Sequence, TimeScale } from '../world/sequence';
import { HERO_ORDER, LESSONS } from './lessons';
import manifest from './narration-manifest.json';
import { presetIdle, type Inputs } from '../sim/car';

export interface NarrationManifest {
  version: string | null;
  segments: { id: string; file: string; durationMs: number; cues: { id: string; text: string; startMs: number; endMs: number }[] }[];
}
export const NARRATION = manifest as NarrationManifest;

const idleInPark = (_t: number, inp: Inputs) => {
  inp.ignition = true;
  inp.selector = 'P';
};

const INTRO: Beat[] = [
  {
    id: 'film-intro',
    title: 'How a car becomes motion',
    text: 'This is a modern petrol sedan: an engine at the front, drive to the rear wheels, and about 1,560 kilograms to move. In the next few minutes, we follow how it turns fuel into motion.',
    duration: 8,
    view: 'hero',
    program: { start: presetIdle, drive: idleInPark },
    timeScale: 1,
    chapter: 'Introduction',
  },
  {
    id: 'film-xray',
    title: 'Ten systems',
    text: 'Under the paint, ten systems work together. We start where every journey starts: with a button on the dashboard.',
    duration: 7,
    view: 'xray',
    timeScale: 1,
  },
];

/**
 * Lesson steps the film leaves out (the lessons keep them): the film tells one continuous story
 * in about six and a half minutes; Explore's lessons go deeper.
 */
const FILM_SKIP = new Set(['idle', 'four-cylinders', 'crank-throws', 'first-gear', 'susp-settle', 'brake-heat', 'abs-close', 'warm-up', 'load', 'assembled']);

/** A lesson's beats without the skipped ones; a skipped chain head hands its program on. */
function filmBeats(beats: Beat[]): Beat[] {
  const out: Beat[] = [];
  let carry: Beat['program'];
  let chapter: string | undefined;
  for (const b of beats) {
    if (FILM_SKIP.has(b.id)) {
      if (b.program) carry = b.program;
      chapter ??= b.chapter;
      continue;
    }
    const kept: Beat = { ...b };
    if (!kept.program && carry) kept.program = carry;
    if (!kept.chapter && chapter) kept.chapter = chapter;
    carry = undefined;
    chapter = undefined;
    out.push(kept);
  }
  return out;
}

/** The beats in order, before narration timing. */
export const FILM_BEATS: Beat[] = [...INTRO, ...HERO_ORDER.flatMap((id) => filmBeats(LESSONS[id].beats))];

/** Split a beat's text into cues: one sentence each. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“‘])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A time scale slowed by `k` with the same mechanical span: ∫₀^{kD} s'(t) dt = ∫₀^{D} s(u) du. */
export function stretch(ts: TimeScale | undefined, k: number): TimeScale | undefined {
  if (k === 1 || ts === undefined) return ts === undefined && k !== 1 ? 1 / k : ts;
  if (typeof ts === 'number') return ts / k;
  return { from: ts.from / k, to: ts.to / k, ramp: ts.ramp * k, delay: (ts.delay ?? 0) * k };
}

/** Fit the beats to the narration: durations, stretched time scales and spoken cues. */
export function timedFilm(beats: Beat[], narration: NarrationManifest): Beat[] {
  return beats.map((b) => {
    const seg = narration.segments.find((s) => s.id === b.id);
    if (!seg) return { ...b, narration: undefined, cues: [{ at: 0, text: b.text }] };
    const need = seg.durationMs / 1000 + 0.5;
    const duration = Math.max(b.duration, need);
    const k = duration / b.duration;
    const cues: Cue[] = seg.cues.map((c) => ({ at: c.startMs / 1000, text: c.text }));
    return { ...b, duration, timeScale: stretch(b.timeScale, k), narration: b.id, cues };
  });
}

export const FILM: Sequence = { id: 'film', title: 'How a car becomes motion', beats: timedFilm(FILM_BEATS, NARRATION) };

/** The narration script for tools/narration (kept in step with the film by a test). */
export function narrationScript(version: string) {
  return {
    version,
    voice: 'bm_george',
    speed: 1.0,
    segments: FILM_BEATS.map((b) => ({
      id: b.id,
      leadIn: 0.3,
      cues: sentences(b.text).map((text, i) => ({ id: `${b.id}-${i + 1}`, text, pauseAfter: 0.35 })),
      tail: 0.5,
    })),
  };
}
