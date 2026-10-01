/**
 * The animation director: the one owner of what the scene is doing. It owns the camera (through
 * the camera director), the scene channels (ghosting, opening, taking apart, cutting, flows),
 * the focus (what stays lit) and the state of the presentation. The frame loop only *samples*
 * it (update), and a request is the only thing that starts a transition.
 *
 * States
 *   idle            the hero picture (the opening), nothing requested
 *   preparing       a view was requested whose parts are not built or compiled yet: the picture
 *                   holds (no camera move, nothing fades) until they are, then it transitions
 *   transitioning   the camera and the channels are moving to the requested view
 *   demonstrating   a lesson or the film is running (its beats request views)
 *   paused          the presentation is paused (camera moves, channels and the mechanism stop;
 *                   the visitor may still look around)
 *   returning       going back up (part → assembly → car), the same machinery in reverse
 *   free-explore    arrived at an explorable view: the visitor's orbit is enabled
 *
 * Entry conditions: the view's required asset groups are ready. Interruption policy: a new
 * request at any moment starts from what is displayed — the camera's position and velocity, the
 * channels' values and rates — never from a remembered start; asking for the view already being
 * approached does nothing. Final state: deterministic — exactly the view's channel targets and
 * its shot's framing (tested in director.test.ts).
 */
import type { Channels } from '../scene/channels';
import type { Director as CameraDirector } from '../scene/camera/director';
import type { View } from './views';

export type DirectorState = 'idle' | 'preparing' | 'transitioning' | 'demonstrating' | 'paused' | 'returning' | 'free-explore';

export interface RequestOptions {
  /** Going back up the hierarchy (the state reads 'returning' while it moves). */
  returning?: boolean;
  /** Part of a running lesson (arrival leaves the state at 'demonstrating'). */
  demonstrating?: boolean;
  /** Arrive immediately (the first frame of a visit, a reduced-motion jump). */
  instant?: boolean;
  /** Channel prefixes to leave as they are (a lesson's own channels). */
  keep?: string[];
  /** Override the camera move's duration, s. */
  duration?: number;
}

export interface DirectorHooks {
  /** Whether asset groups are ready (built and their shaders compiled). */
  ready: (groups: ('car' | 'detail')[]) => boolean;
  /** The focus changed (the looks dim the rest). */
  focus: (assemblies: string[], tint: Record<string, string>) => void;
  /** Extra channel targets a view always gets on this device (reduced motion, quality). */
  adjust?: (channels: Record<string, number>) => Record<string, number>;
}

export class AnimationDirector {
  state: DirectorState = 'idle';
  /** The view the scene is at or moving to. */
  view: View | null = null;
  /** A view waiting for its assets. */
  pending: { view: View; opts: RequestOptions } | null = null;
  /** Counts transitions started (tests and telemetry). */
  transitions = 0;
  private opts: RequestOptions = {};
  private wasPaused: DirectorState = 'idle';
  /** Time spent in the current transition, s (presentation clock). */
  transitionTime = 0;
  /** Last transition's measured length, s. */
  lastTransition = 0;

  constructor(
    private camera: CameraDirector,
    private channels: Channels,
    private hooks: DirectorHooks,
  ) {}

  /** Ask for a view. Returns true if a transition started (or is waiting for its assets). */
  request(view: View, opts: RequestOptions = {}): boolean {
    if (this.state === 'paused') this.resume();
    // the first picture of a visit is placed, not flown to
    if (this.view === null && !this.pending) opts = { ...opts, instant: true };
    // the view already shown or being approached: carry on
    if (!opts.instant && this.view?.id === view.id && !this.pending) {
      this.opts = { ...this.opts, ...opts };
      if (opts.demonstrating && this.state !== 'transitioning') this.state = 'demonstrating';
      return false;
    }
    if (this.pending?.view.id === view.id) return true;
    if (view.requires?.length && !this.hooks.ready(view.requires)) {
      // hold the picture until the destination is ready
      this.pending = { view, opts };
      this.state = 'preparing';
      return true;
    }
    this.begin(view, opts);
    return true;
  }

  private begin(view: View, opts: RequestOptions) {
    this.pending = null;
    this.view = view;
    this.opts = opts;
    this.transitions++;
    this.transitionTime = 0;
    const targets = this.hooks.adjust ? this.hooks.adjust({ ...view.channels }) : view.channels;
    this.channels.to(targets, { keep: opts.keep });
    this.camera.go(view.shot, { instant: opts.instant, duration: opts.duration });
    this.hooks.focus(view.focus ?? [], view.tint ?? {});
    if (opts.instant) {
      // the first picture of a visit: everything at its target now
      for (const [k, v] of Object.entries(targets)) this.channels.set(k, v);
      for (const k of this.channels.active()) if (!(k in targets) && !opts.keep?.some((p) => k.startsWith(p))) this.channels.set(k, 0);
    }
    this.state = opts.returning ? 'returning' : 'transitioning';
  }

  pause() {
    if (this.state === 'paused') return;
    this.wasPaused = this.state;
    this.state = 'paused';
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.wasPaused;
  }

  get paused(): boolean {
    return this.state === 'paused';
  }

  /** Has the current transition finished (camera arrived, channels settled)? */
  get settled(): boolean {
    return !this.camera.moving && !this.channels.busy;
  }

  /** Sample: called every frame with the presentation step (0 while paused). */
  update(dt: number) {
    if (this.state === 'paused') return;
    if (this.state === 'preparing' && this.pending && this.hooks.ready(this.pending.view.requires ?? [])) {
      const p = this.pending;
      this.begin(p.view, p.opts);
    }
    if (this.state === 'transitioning' || this.state === 'returning') {
      this.transitionTime += dt;
      if (this.settled) {
        this.lastTransition = this.transitionTime;
        this.state = this.opts.demonstrating ? 'demonstrating' : this.view?.free ? 'free-explore' : 'idle';
      }
    }
  }

  /** The visitor may orbit now (the shot allows it and nothing authored is moving the camera). */
  get canOrbit(): boolean {
    return (this.state === 'free-explore' || this.state === 'idle' || this.state === 'demonstrating' || this.state === 'paused') && this.camera.canOrbit();
  }
}
