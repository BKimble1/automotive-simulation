/**
 * The four clocks the simulation runs on, derived each frame from the frame clock
 * (src/scene/time.ts) so that pausing one never disturbs another:
 *
 *   presentation   lesson and narration time. Stops when the visitor pauses; seeking sets it.
 *   mechanical     simulated time of the car's models: presentation time × the time scale
 *                  (slow motion for the four-stroke cycle) during guided lessons, real time ×
 *                  the time scale in the free modes. The models step it in fixed 1 ms steps.
 *   camera         authored camera moves run on presentation time (they stop with a pause);
 *                  the visitor's own orbit and its inertia run on real time.
 *   ambient        the studio's own life (light breathing): real time, never paused.
 *
 * All four start from the same frame step, which is clamped (a stall never jumps a move) and
 * is exactly 1/30 s on the frame-stepped test clock.
 */
export class Clocks {
  /** Real (wall) time of this frame, s. */
  real = 0;
  realDt = 0;
  /** Presentation time and its step this frame. */
  presentation = 0;
  presentationDt = 0;
  paused = false;
  /** Mechanical time scale (1 real time, 0.02 for a 50× slow motion). */
  timeScale = 1;
  mechanicalDt = 0;
  /** Whether the mechanical clock follows presentation time (guided) or real time (free). */
  guided = false;
  ambient = 0;
  ambientDt = 0;
  /** Camera move time step (presentation) and input step (real). */
  cameraDt = 0;
  inputDt = 0;

  tick(dt: number) {
    this.realDt = dt;
    this.real += dt;
    this.presentationDt = this.paused ? 0 : dt;
    this.presentation += this.presentationDt;
    this.mechanicalDt = (this.guided ? this.presentationDt : this.paused ? 0 : dt) * this.timeScale;
    this.ambientDt = dt;
    this.ambient += dt;
    this.cameraDt = this.presentationDt;
    this.inputDt = dt;
  }

  /** Seek presentation time (a lesson's or the film's); the next frame continues from there. */
  seek(t: number) {
    this.presentation = t;
  }
}
