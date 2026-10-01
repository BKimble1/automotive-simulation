/**
 * The clocks the simulation runs on, derived each frame from the frame clock
 * (src/scene/time.ts) so that holding one never disturbs another:
 *
 *   presentation   lesson and narration time. Stops when the visitor pauses, and while a beat
 *                  waits for its subject (its view still arriving, its assets still compiling,
 *                  a sought state still being computed). Seeking sets it.
 *   mechanical     simulated time of the car's models: presentation time × the time scale
 *                  during guided lessons, real time × the time scale in the free modes (stopped
 *                  by the pause, and when a live run has ended). Fixed 1 ms steps.
 *   transition     authored camera moves and the scene's channels. Runs while a beat waits for
 *                  its subject (that is what it waits for); stops with the pause, except for a
 *                  paused navigation (a chapter chosen while paused moves the view there).
 *   input          the visitor's own orbit and its inertia: real time, always.
 *   ambient        the studio's own life: real time.
 *
 * All start from the same frame step, which is clamped (a stall never jumps a move) and is
 * exactly 1/30 s on the frame-stepped test clock. While the page is hidden or the graphics
 * context is lost the world does not tick at all, so nothing races to catch up afterwards.
 */
export interface ClockFlags {
  /** The visitor's pause. */
  paused: boolean;
  /** A guided sequence is waiting for its subject. */
  gated: boolean;
  /** A view requested while paused is moving. */
  navigating: boolean;
  /** A live run reached its end (its last state holds). */
  ended: boolean;
}

export class Clocks {
  /** Real (wall) time of this frame, s. */
  real = 0;
  realDt = 0;
  presentation = 0;
  presentationDt = 0;
  paused = false;
  /** Mechanical time scale (1 real time, 0.02 for a 50× slow motion). */
  timeScale = 1;
  mechanicalDt = 0;
  /** Whether the mechanical clock follows presentation time (guided) or real time (free). */
  guided = false;
  transitionDt = 0;
  ambient = 0;
  ambientDt = 0;
  /** Authored camera hold (drift, follow): with the transitions. */
  cameraDt = 0;
  inputDt = 0;

  tick(dt: number, f: ClockFlags = { paused: this.paused, gated: false, navigating: false, ended: false }) {
    this.paused = f.paused;
    this.realDt = dt;
    this.real += dt;
    this.presentationDt = f.paused || f.gated ? 0 : dt;
    this.presentation += this.presentationDt;
    this.mechanicalDt = (this.guided ? this.presentationDt : f.paused || f.ended ? 0 : dt) * this.timeScale;
    this.transitionDt = f.paused && !f.navigating ? 0 : dt;
    this.cameraDt = this.transitionDt;
    this.ambientDt = dt;
    this.ambient += dt;
    this.inputDt = dt;
  }

  /** Seek presentation time (a lesson's or the film's); the next frame continues from there. */
  seek(t: number) {
    this.presentation = t;
  }
}
