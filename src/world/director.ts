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
 *   paused          the presentation is paused (camera holds, channels and the mechanism stop;
 *                   the visitor may still look around). The pause belongs to the world (one
 *                   owner); a view requested while paused is a paused navigation: the camera
 *                   and the channels move there, the mechanism, the model and the narration stay
 *                   frozen, and the state returns to paused on arrival. Nothing here resumes.
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
  /** What the director is doing, before the pause is taken into account. */
  private phase: DirectorState = 'idle';
  /** The state shown: 'paused' while the presentation is paused (unless a paused navigation is moving). */
  get state(): DirectorState {
    return this.holding && !this.pausedNavigation ? 'paused' : this.phase;
  }
  /** The view the scene is at or moving to. */
  view: View | null = null;
  /** A view waiting for its assets. */
  pending: { view: View; opts: RequestOptions } | null = null;
  /** Counts transitions started (tests and telemetry). */
  transitions = 0;
  private opts: RequestOptions = {};
  /** The presentation is paused (set by the world only). */
  private holding = false;
  /** A transition requested while paused is running (it moves on the navigation clock). */
  pausedNavigation = false;
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
    // the first picture of a visit is placed, not flown to
    if (this.view === null && !this.pending) opts = { ...opts, instant: true };
    // the view already shown or being approached: carry on
    if (!opts.instant && this.view?.id === view.id && !this.pending) {
      this.opts = { ...this.opts, ...opts };
      if (opts.demonstrating && this.phase !== 'transitioning' && this.phase !== 'returning') this.phase = 'demonstrating';
      return false;
    }
    if (this.pending?.view.id === view.id) return true;
    if (view.requires?.length && !this.hooks.ready(view.requires)) {
      // hold the picture until the destination is ready
      this.pending = { view, opts };
      this.phase = 'preparing';
      return true;
    }
    this.begin(view, opts);
    return true;
  }

  /** The state to settle in when nothing is moving. */
  private restState(): DirectorState {
    return this.opts.demonstrating ? 'demonstrating' : this.view?.free ? 'free-explore' : 'idle';
  }

  /** A transition or a wait for assets is in progress. */
  get busy(): boolean {
    return this.phase === 'transitioning' || this.phase === 'returning' || this.phase === 'preparing';
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
    this.phase = opts.returning ? 'returning' : 'transitioning';
    this.pausedNavigation = this.holding && !opts.instant;
    if (opts.instant) this.phase = this.restState();
  }

  /** The world pauses or resumes the presentation (the only owner of the pause). */
  setPaused(paused: boolean) {
    this.holding = paused;
  }

  get paused(): boolean {
    return this.holding;
  }

  /** Has the current transition finished (camera arrived, channels settled)? */
  get settled(): boolean {
    return !this.camera.moving && !this.channels.busy;
  }

  /** Sample: called every frame with the transition clock's step (0 while paused, unless a
   * paused navigation is moving). */
  update(dt: number) {
    if (this.phase === 'preparing' && this.pending && this.hooks.ready(this.pending.view.requires ?? [])) {
      const p = this.pending;
      this.begin(p.view, p.opts);
    }
    if (this.phase === 'transitioning' || this.phase === 'returning') {
      this.transitionTime += dt;
      if (this.settled) {
        this.lastTransition = this.transitionTime;
        this.pausedNavigation = false;
        this.phase = this.restState();
      }
    }
  }

  /** Who owns the camera: the visitor may orbit only when no authored move is running and the
   * shot allows it (the camera director's input handlers ask this, through the world). */
  get canOrbit(): boolean {
    return !this.busy && this.camera.shotAllowsOrbit();
  }
}
