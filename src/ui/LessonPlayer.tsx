/**
 * The lesson player: the step's title and one or two sentences, a scrubber with the steps as
 * ticks, play/pause, previous/next step, replay and exit. Everything it does goes to the world
 * (pause stops the presentation; seeking reconstructs the exact state at that moment).
 */
import { useEffect, useState } from 'react';
import { useApp, usePlayer } from '../state/store';
import type { World } from '../world/world';
import { CloseIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, ReplayIcon } from './icons';
import { ReadoutChips } from './Readouts';

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function LessonPlayer({ world, onExit, exitLabel = 'Exit' }: { world: World; onExit: () => void; exitLabel?: string }) {
  const p = usePlayer();
  const captions = useApp((s) => s.captions);
  const step = p.beats[p.beat];
  const [menu, setMenu] = useState(false);
  const chapters = p.beats.map((b, i) => ({ ...b, i })).filter((b) => b.chapter);
  const chapterNow = [...chapters].reverse().find((c) => c.i <= p.beat);
  // the world coalesces seeks: dragging the scrubber never queues a calculation per event,
  // and the last position asked for is the one the car arrives at
  const seek = (t: number) => world.seek(t);
  const toggle = () => {
    if (p.ended) {
      seek(0);
      world.setPaused(false);
      return;
    }
    world.setPaused(p.playing);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      // never take keys from a field, a slider (it moves with arrows) or the workbench's controls
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT' || el?.isContentEditable) return;
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowRight' && e.shiftKey) seek(p.beats[Math.min(p.beats.length - 1, p.beat + 1)]?.start ?? p.t);
      else if (e.key === 'ArrowLeft' && e.shiftKey) seek(p.beats[Math.max(0, p.beat - 1)]?.start ?? 0);
      else if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  if (!p.id) return null;
  return (
    <>
      <section className="lesson pe" data-occludes="bottom" aria-label={p.title}>
        {captions && p.caption && (
          <div className="captions" aria-live="polite">
            {p.caption}
          </div>
        )}
        <div className="lesson__head">
          {chapters.length > 1 ? (
            <button className="lesson__chapter" aria-expanded={menu} aria-haspopup="true" onClick={() => setMenu(!menu)}>
              {chapterNow?.chapter ?? p.title}
            </button>
          ) : (
            <span className="lesson__step">
              {p.beat + 1} / {p.beats.length}
            </span>
          )}
          <h2 className="lesson__title">{step?.title ?? p.title}</h2>
        </div>
        {menu && (
          <ol className="chapters" aria-label="Chapters">
            {chapters.map((c) => (
              <li key={c.i}>
                <button
                  aria-current={c === chapterNow ? 'true' : undefined}
                  onClick={() => {
                    seek(c.start);
                    setMenu(false);
                  }}
                >
                  <span>{c.chapter}</span>
                  <span className="num">{fmt(c.start)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
        {/* the film's captions follow the narration; a lesson shows the step's whole text */}
        {!(p.id === 'film' && captions) && <p className="lesson__text">{step?.text}</p>}
        {step && <ReadoutChips ids={step.readouts ?? []} timeScale={p.scale} />}
        <div className="lesson__controls">
          <button className="pbtn" onClick={() => seek(p.beats[Math.max(0, p.beat - 1)]?.start ?? 0)} aria-label="Previous step">
            <PrevIcon />
          </button>
          <button className="pbtn pbtn--accent" onClick={toggle} aria-label={p.ended ? 'Replay' : p.playing ? 'Pause' : 'Play'}>
            {p.ended ? <ReplayIcon /> : p.playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button className="pbtn" onClick={() => seek(p.beats[Math.min(p.beats.length - 1, p.beat + 1)]?.start ?? p.t)} aria-label="Next step">
            <NextIcon />
          </button>
          <button className="pbtn" onClick={() => seek(p.beats[p.beat]?.start ?? 0)} aria-label="Replay this step">
            <ReplayIcon />
          </button>
          <div className="ticks">
            <input
              className="lesson__scrub"
              type="range"
              min={0}
              max={p.duration}
              step={0.05}
              value={p.t}
              aria-label="Position in the lesson"
              aria-valuetext={`${fmt(p.t)} of ${fmt(p.duration)}, step ${p.beat + 1}: ${step?.title ?? ''}`}
              onChange={(e) => seek(Number(e.target.value))}
            />
          </div>
          <span className="lesson__time num">
            {p.holding && p.playing ? <span className="lesson__wait" aria-label="Arriving at the next view">•••</span> : null}
            {fmt(p.t)} / {fmt(p.duration)}
          </span>
          <button className="pbtn" onClick={onExit} aria-label={exitLabel}>
            <CloseIcon />
          </button>
        </div>
      </section>
    </>
  );
}
