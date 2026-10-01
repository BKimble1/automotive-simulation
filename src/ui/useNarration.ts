/**
 * Plays the film's bundled narration in step with the presentation clock: the segment of the
 * beat on screen, from the beat's local time. The presentation clock is the one timing
 * authority; the audio follows it: it is moved to the right place on every seek, re-synchronised
 * if it drifts more than a fifth of a second (a slow frame, a stall, audio still buffering), and
 * paused whenever the clock holds (the pause, a beat waiting for its view, a sought state being
 * computed). The clock never waits for the audio.
 *
 * Muted by default; the header's sound button turns it on. If the browser refuses to play
 * (autoplay policy), it is not retried every frame: the sound button shows that a tap is needed,
 * and the next gesture plays it from inside the gesture's own handler (what stricter browsers
 * require), then the frame loop keeps it in step again.
 */
import { useEffect, useRef } from 'react';
import { useApp, usePlayer } from '../state/store';
import { NARRATION } from '../content/film';
import type { World } from '../world/world';

const BASE = `${import.meta.env.BASE_URL}narration/${NARRATION.version ?? ''}/`;

/** What should be sounding now: a segment and the time in it, or null for silence. */
function wanted(world: World): { id: string; file: string; local: number } | null {
  const p = world.player;
  if (!useApp.getState().sound || p.seq?.id !== 'film' || !p.beat) return null;
  const b = p.beat;
  const seg = NARRATION.segments.find((s) => s.id === b.beat.narration);
  if (!seg) return null;
  const local = p.t - b.start;
  if (!p.playing || p.hold || world.paused || local >= seg.durationMs / 1000) return null;
  return { id: seg.id, file: seg.file, local };
}

export function useNarration(world: World | null) {
  const sound = useApp((s) => s.sound);
  const audio = useRef<HTMLAudioElement | null>(null);
  const segment = useRef<string | null>(null);
  const blocked = useRef(false);
  const trying = useRef(false);

  useEffect(() => {
    if (!world || !NARRATION.version) return;
    if (!audio.current) {
      audio.current = new Audio();
      audio.current.preload = 'auto';
      // the tests check what the narration is doing
      (window as unknown as { __fabNarration?: HTMLAudioElement }).__fabNarration = audio.current;
    }
    const a = audio.current;
    /** Put the right segment at the right time; `play` asks the element to sound. */
    const follow = (play: boolean) => {
      const w = wanted(world);
      if (!w) {
        if (!a.paused) a.pause();
        if (!world.player.beat) segment.current = null;
        return;
      }
      if (segment.current !== w.id) {
        segment.current = w.id;
        a.src = BASE + w.file;
      }
      if (Math.abs(a.currentTime - w.local) > 0.2 && a.readyState >= 1) a.currentTime = w.local;
      if (play && a.paused && !trying.current) {
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
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      follow(!blocked.current);
    };
    raf = requestAnimationFrame(tick);
    // a gesture lets the browser play again: play from inside its handler
    const gesture = () => {
      if (!blocked.current) return;
      blocked.current = false;
      useApp.setState({ soundBlocked: false });
      follow(true);
    };
    window.addEventListener('pointerup', gesture, true);
    window.addEventListener('keydown', gesture, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerup', gesture, true);
      window.removeEventListener('keydown', gesture, true);
      a.pause();
    };
  }, [world, sound]);

  // a sequence change drops the current segment
  useEffect(
    () =>
      usePlayer.subscribe((s, prev) => {
        if (s.id !== prev.id) segment.current = null;
      }),
    [],
  );
}
