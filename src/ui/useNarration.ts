/**
 * Plays the film's bundled narration in step with the presentation clock: the segment of the
 * beat on screen, from the beat's local time. The clock leads; the audio follows (it is moved
 * to the right place on every seek, and re-synchronised if it drifts more than a fifth of a
 * second). Muted by default; the header's sound button (a user gesture) turns it on.
 */
import { useEffect, useRef } from 'react';
import { useApp, usePlayer } from '../state/store';
import { NARRATION } from '../content/film';
import type { World } from '../world/world';

const BASE = `${import.meta.env.BASE_URL}narration/${NARRATION.version ?? ''}/`;

export function useNarration(world: World | null) {
  const sound = useApp((s) => s.sound);
  const audio = useRef<HTMLAudioElement | null>(null);
  const segment = useRef<string | null>(null);

  useEffect(() => {
    if (!world || !NARRATION.version) return;
    if (!audio.current) {
      audio.current = new Audio();
      audio.current.preload = 'auto';
    }
    const a = audio.current;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const p = world.player;
      const on = sound && p.seq?.id === 'film' && !!p.beat;
      if (!on) {
        if (!a.paused) a.pause();
        return;
      }
      const b = p.beat!;
      const seg = NARRATION.segments.find((s) => s.id === b.beat.narration);
      if (!seg) {
        if (!a.paused) a.pause();
        segment.current = null;
        return;
      }
      if (segment.current !== seg.id) {
        segment.current = seg.id;
        a.src = BASE + seg.file;
      }
      const local = p.t - b.start;
      const end = seg.durationMs / 1000;
      if (!p.playing || local >= end) {
        if (!a.paused) a.pause();
        return;
      }
      if (Math.abs(a.currentTime - local) > 0.2 && a.readyState >= 1) a.currentTime = local;
      if (a.paused) void a.play().catch(() => {});
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      a.pause();
    };
  }, [world, sound]);

  // a sequence change drops the current segment
  useEffect(() => usePlayer.subscribe((s, prev) => {
    if (s.id !== prev.id) segment.current = null;
  }), []);
}
