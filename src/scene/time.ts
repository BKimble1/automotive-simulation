/**
 * The frame clock. Normally wall-clock; with ?virt=1 (test and recording harness only) every
 * rendered frame advances time by exactly 1/30 s and frames are drawn on request
 * (window.__fabAdvance(n)), so transitions can be captured frame by frame on a slow software
 * renderer and still play at true speed.
 *
 * This clock only measures frames. The four clocks the simulation runs on (presentation,
 * mechanical, camera and ambient) are derived from it in src/world/clocks.ts, so pausing one
 * never disturbs another. The clock stops while the page is hidden.
 */
export const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
export const VIRTUAL_TIME = params.get('virt') === '1';
/** Test hooks (window.__fab*): in development, with ?virt=1, or with ?hooks=1. */
export const TEST_HOOKS = typeof window !== 'undefined' && (import.meta.env?.DEV || VIRTUAL_TIME || params.get('hooks') === '1');
/** Recording: keep the drawing buffer for screenshots. */
export const CAPTURE = params.get('capture') === '1';

/** The longest step any clock takes in one frame, s: a stall never jumps a move. */
export const MAX_STEP = 1 / 15;

export const frameTime = {
  virtual: VIRTUAL_TIME,
  /** Seconds since start (stopped while hidden). */
  now: 0,
  /** Duration of the current frame, s (clamped to MAX_STEP). */
  dt: 1 / 60,
  /** The real interval since the previous frame, s (not clamped: what the visitor waited). */
  raw: 1 / 60,
  frame: 0,
  step: 1 / 30,
};

let last = typeof performance !== 'undefined' ? performance.now() : 0;
let hidden = typeof document !== 'undefined' ? document.hidden : false;
if (typeof document !== 'undefined')
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    last = performance.now();
  });

/** Advance the clock for one real-time frame. */
export function tickRealtime(): number {
  const t = performance.now();
  const raw = (t - last) / 1000;
  last = t;
  const dt = hidden ? 0 : Math.min(MAX_STEP, Math.max(0, raw));
  frameTime.raw = hidden ? 0 : raw;
  frameTime.dt = dt;
  frameTime.now += dt;
  frameTime.frame++;
  return dt;
}

/** Advance the clock by one virtual frame. */
export function tickVirtual(): number {
  frameTime.raw = frameTime.step;
  frameTime.dt = frameTime.step;
  frameTime.now += frameTime.step;
  frameTime.frame++;
  return frameTime.step;
}
