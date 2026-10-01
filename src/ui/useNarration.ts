/**
 * Plays the film's bundled narration in step with the presentation clock: the segment of the
 * beat on screen, from the beat's local time. The presentation clock is the one timing
 * authority; the audio follows it: it is moved to the right place on every seek, re-synchronised
 * if it drifts more than a fifth of a second (a slow frame, a stall), and paused whenever the
 * clock holds (the pause, a beat waiting for its view, a sought state being computed).
 *
 * Muted by default; the header's sound button (a user gesture) turns it on. If the browser
 * refuses to play (autoplay policy), it is not retried every frame: the sound button shows that
 * a tap is needed, and the next gesture tries again.
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
  const blocked = useRef(false);
  const trying = useRef(false);

  // any gesture lets the browser play again
  useEffect(() => {
    const unblock = () => {
      if (!blocked.current) return;
      blocked.current = false;
      useApp.setState({ soundBlocked: false });
    };
    window.addEventListener('pointerdown', unblock, true);
    window.addEventListener('keydown', unblock, true);
    return () => {
      window.removeEventListener('pointerdown', unblock, true);
      window.removeEventListener('keydown', unblock, true);
    };
  }, []);

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
      if (!p.playing || p.hold || world.paused || local >= end) {
        if (!a.paused) a.pause();
        return;
      }
      if (Math.abs(a.currentTime - local) > 0.2 && a.readyState >= 1) a.currentTime = local;
      if (a.paused && !blocked.current && !trying.current) {
        trying.current = true;
        a.play()
          .then(() => {
            trying.current = false;
          })
          .catch((err: DOMException) => {
            trying.current = false;
            // the browser wants a gesture: stop asking until the visitor gives one
            if (err?.name === 'NotAllowedError') {
              blocked.current = true;
              useApp.setState({ soundBlocked: true });
            }
          });
      }
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
