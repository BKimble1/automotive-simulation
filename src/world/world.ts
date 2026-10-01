/**
 * The world: the runtime that owns the scene for the whole visit. One frame loop in a fixed
 * order, and nothing else moves anything:
 *
 *   clocks → director (sample) → sequence or live run → channels → mechanism → looks
 *          → rig (baselines + offsets + explodes) → flows, cylinders, arrows, road
 *          → camera → render → readouts (10 Hz)
 *
 * Who owns what:
 *   - the pause belongs to the world alone (setPaused); the director, the sequence player, the
 *     live run and the narration read it, none of them releases it;
 *   - a run (a lab, a scenario, a fault case, the workbench, a lesson's chain) is started only
 *     through sim/run.ts's initRun, from a complete specification: nothing is inherited;
 *   - a guided beat waits for its subject: while its view is still arriving (or its assets are
 *     still compiling, or a sought state is still being computed off the page) presentation
 *     time, the model and the narration hold, and the camera and the channels move;
 *   - while the graphics context is lost, or being restored, the world does not tick at all:
 *     nothing advances, and nothing races to catch up afterwards.
 *
 * The scene is built once, progressively: the studio and the car (on the light body mesh) and
 * the materials the opening picture needs, compiled before the veil lifts; then every other
 * material variant (ghosts, sections) is compiled off screen; then the detailed body is swapped
 * in at a quiet moment where the device can afford it. The director will not move to a view whose
 * parts are not ready (it holds the picture instead), so there is never a blank frame or a
 * shader compile in the middle of a move.
 */
import { Raycaster, Vector2, Vector3, type Material, type Mesh, type Object3D, type Plane } from 'three';
import { Stage } from '../scene/stage';
import { Studio } from '../scene/studio';
import { Road } from '../scene/road';
import { Channels } from '../scene/channels';
import { Director as CameraDirector, type KeepOut } from '../scene/camera/director';
import { frameTime, params, tickRealtime, tickVirtual, VIRTUAL_TIME, TEST_HOOKS } from '../scene/time';
import { TIERS, useQuality, type Tier } from '../scene/quality';
import { loadBody } from '../scene/car/bodyData';
import { splitPanels } from '../scene/car/body';
import { buildCar, type Car as CarScene } from '../scene/car/build';
import { Flows } from '../scene/viz/flows';
import { ArrowSet } from '../scene/viz/arrows';
import { EngineViz } from '../scene/viz/engineViz';
import { disposeTree } from '../scene/dispose';
import { Car, makeRoad, presetIdle, type CarState, type Faults } from '../sim/car';
import { initRun, type RunSpec } from '../sim/run';
import { TIRE, units } from '../spec/vehicle';
import { Clocks } from './clocks';
import { AnimationDirector } from './director';
import { Looks } from './looks';
import { Mechanism, emptyView, interpolate } from './mechanism';
import { scaleAt, SequencePlayer, type Sequence } from './sequence';
import { SeekCache } from './seekCache';
import { SimJobs } from './jobs';
import { KEEP_OUT, VIEWS, type View } from './views';
import { Driver } from './driver';
import { FLOW_DEFS } from './flowDefs';
import { LabelLayer } from '../scene/labels';
import { labelDefs } from './labelDefs';
import { usePlayer, useReadouts, useApp, useRun } from '../state/store';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** The longest a beat waits for its view before it carries on regardless, s. */
const GATE_MAX = 2.5;
/** A sought moment this close to its chain's start is computed on the page at once (simulated s). */
const SEEK_INLINE = 0.6;

export interface Telemetry {
  on: boolean;
  frames: {
    t: number;
    cam: number[];
    target: number[];
    fov: number;
    state: string;
    transitions: number;
    camMove: number;
    clamps: number;
    modelT: number;
    presT: number;
    run: string | null;
    paused: boolean;
    gated: boolean;
    input: 'visitor' | 'authored' | 'none';
  }[];
}

export class World {
  stage: Stage;
  studio = new Studio();
  road = new Road();
  channels = new Channels();
  clocks = new Clocks();
  camera: CameraDirector;
  director: AnimationDirector;
  model = new Car(presetIdle());
  player: SequencePlayer;
  jobs: SimJobs;
  car!: CarScene;
  labels: LabelLayer | null = null;
  looks!: Looks;
  mech!: Mechanism;
  flows!: Flows;
  arrows!: ArrowSet;
  engineViz!: EngineViz;
  private view = emptyView();
  private readyGroups = new Set<string>();
  private running = false;
  private raf = 0;
  private lastPublish = 0;
  private detachInput: (() => void) | null = null;
  /** The live run (free modes, labs, scenarios, fault cases, the workbench). */
  live: RunSpec | null = null;
  /** The live run reached its duration (or its end condition): its last state holds. */
  liveEnded = false;
  /** True while a sequence (lesson or film) drives the car. */
  guided = false;
  /** The visitor's pause: the one owner. */
  paused = false;
  /** The driving workbench's controls (they drive the live run when it has no script). */
  driver: Driver;
  /** Set when the world is gone: background work that finishes later does nothing. */
  disposed = false;
  /** The graphics context came back and the scene's programs are being rebuilt. */
  private restoring = false;
  /** A beat waiting for its view (when it started waiting, on the real clock). */
  private gate: { since: number } | null = null;
  /** A sought sequence state being computed off the page. */
  private seekPending: { id: number; t: number } | null = null;
  private seekSerial = 0;
  private seekCache = new SeekCache();
  /** Road settings of the current run (for drawing). */
  roadOpts: { curve?: number; curveX?: number; bumpAt?: number; bumpHeight?: number; bumpLength?: number; lowGrip?: number } = {};
  /** Telemetry for the continuity tests (with the test hooks): one record per frame. */
  telemetry: Telemetry = { on: false, frames: [] };
  /** Resource and timing counters for development (window.__fab.counters). */
  counters = { frames: 0, suspendedFrames: 0, disposed: { geometries: 0, materials: 0, textures: 0 } };
  private keepOut: KeepOut[] = [];
  /** The engine cylinder the current lesson follows. */
  focusCyl = -1;
  extraChannels: Record<string, number> = {};

  constructor(public canvas: HTMLCanvasElement) {
    this.stage = new Stage(canvas);
    this.stage.scene.add(this.studio.group);
    this.stage.scene.add(this.road.group);
    this.camera = new CameraDirector(this.stage.camera);
    this.player = new SequencePlayer(this.model);
    this.jobs = new SimJobs();
    this.driver = new Driver(this.model);
    this.director = new AnimationDirector(this.camera, this.channels, {
      ready: (groups) => groups.every((g) => this.readyGroups.has(g)),
      focus: (a, tint) => {
        this.looks.focus = new Set(a);
        this.looks.setTint(tint);
      },
      adjust: (c) => c,
    });
    this.stage.quiet = () => this.director.settled;
    // the visitor may take the camera only when no authored move owns it
    this.camera.permit = () => this.director.canOrbit;
    this.stage.onContextChange = (lost) => {
      useApp.setState({ contextLost: lost });
      if (!lost) void this.recoverContext();
    };
    this.stage.onTier = (t) => this.applyTier(t);
    this.model.inputs.ignition = true;
  }

  resize(w: number, h: number) {
    this.stage.resize(w, h);
    this.camera.viewW = w;
    this.camera.viewH = h;
    this.camera.compact = w < 760;
  }

  /** The part of the view the interface leaves free (fractions), measured by the interface. */
  setFree(l: number, t: number, r: number, b: number, snap = false) {
    this.camera.free = { l, t, r, b };
    if (this.labels) this.labels.free = { l, t, r, b };
    if (snap) this.camera.snapFraming();
  }

  async init(progress: (p: number) => void): Promise<boolean> {
    try {
      progress(0.05);
      const tier = this.stage.currentTier;
      const lo = await loadBody('lo');
      if (this.disposed) return false;
      progress(0.25);
      await nextFrame();
      this.car = buildCar(lo);
      this.stage.scene.add(this.car.root);
      progress(0.55);
      await nextFrame();
      if (this.disposed) return false;
      this.mech = new Mechanism(this.car);
      this.looks = new Looks(this.car, this.channels, this.studio);
      this.flows = new Flows(this.car.sprung);
      for (const d of FLOW_DEFS(this.car)) this.flows.add(d, TIERS[tier].particles);
      this.arrows = new ArrowSet(this.car.root);
      if (this.canvas.parentElement) this.labels = new LabelLayer(this.canvas.parentElement, labelDefs(this.car));
      this.engineViz = new EngineViz(this.car.sprung, this.car.engine.injectorTips, this.car.engine.plugTips);
      // the camera stays out of the body (its capsules ride on the body) and above the floor
      this.keepOut = KEEP_OUT.map((k) => ({ a: k.a.clone(), b: k.b.clone(), r: k.r }));
      this.camera.obstacles = () => this.keepOut;
      this.camera.reducedMotion = useApp.getState().reducedMotion;
      this.channels.speed = useApp.getState().reducedMotion ? 0.6 : 1;
      this.stage.applyLights();
      // first picture
      this.frameOnce(0);
      progress(0.7);
      await this.stage.prewarm(this.stage.scene, { onlyVisible: true });
      if (this.disposed) return false;
      progress(0.9);
      this.readyGroups.add('hero');
      // the rest compiles off screen: every material's other variants (ghost, section)
      void this.compileVariants().then(async () => {
        // test hook: hold the rest of the car back, as a slow device would (?prepdelay=ms)
        const hold = TEST_HOOKS ? Number(params.get('prepdelay') ?? 0) : 0;
        if (hold > 0) await new Promise((r) => setTimeout(r, hold));
        if (this.disposed) return;
        this.readyGroups.add('car');
        this.readyGroups.add('detail');
        useApp.setState({ carReady: true });
        // then the detailed body where the device can afford it
        if (TIERS[this.stage.currentTier].bodyLod === 'hi') await this.swapBody('hi');
      });
      progress(1);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  /**
   * Compile every material variant the destinations need (ghost, section) without touching the
   * displayed scene: the variants are compiled on stand-in meshes in a scene of their own, so
   * nothing hidden ever appears and no live material is swapped while compiling.
   */
  private async compileVariants() {
    await nextFrame();
    if (this.disposed) return;
    const mats = new Set<import('three').Material>();
    for (const n of this.car.rig.parts.values())
      for (const m of n.meshes) {
        const pair = m.userData.pair;
        if (pair?.ghost) mats.add(pair.ghost);
        if (pair?.opaque) mats.add(pair.opaque);
      }
    for (const p of this.car.body.panels) {
      mats.add(p.mats.paintGhost);
      mats.add(p.mats.glassGhost);
      for (const e of p.extras) mats.add(e.ghost);
    }
    // anything on the car that starts hidden (the wheels' spin blur, lesson-only parts)
    this.car.root.traverse((o) => {
      const m = (o as import('three').Mesh).material;
      if (!m || o.visible) return;
      for (const x of Array.isArray(m) ? m : [m]) mats.add(x);
    });
    await this.stage.compileMaterials([...mats]);
    await nextFrame();
  }

  /**
   * Replace the body's panel geometry with another level of detail at a quiet moment: the same
   * surface and seams from the same bake, swapped between two frames, never during a move.
   */
  async swapBody(lod: 'hi' | 'lo') {
    const g = await loadBody(lod);
    if (this.disposed) return;
    const geos = splitPanels(g);
    // wait for a moment when nothing authored is moving (at most a few seconds)
    for (let i = 0; i < 240 && (this.director.busy || this.camera.moving) && !this.disposed; i++) await nextFrame();
    if (this.disposed) {
      for (const g of Object.values(geos)) g.dispose();
      return;
    }
    for (const p of this.car.body.panels) {
      const old = p.paint.geometry;
      p.paint.geometry = geos[p.id];
      p.glass.geometry = geos[p.id];
      if (old !== geos[p.id]) old.dispose();
    }
    this.bodyLod = lod;
  }
  bodyLod: 'hi' | 'lo' = 'lo';

  /** A quality change after the start: the body detail and the flow density follow the tier. */
  private applyTier(t: Tier) {
    if (this.disposed || !this.car) return;
    const spec = TIERS[t];
    this.flows?.setDensity(spec.particles);
    if (spec.bodyLod !== this.bodyLod && this.readyGroups.has('car')) void this.swapBody(spec.bodyLod);
  }

  /** The graphics context came back: rebuild the programs before anything moves again. */
  private async recoverContext() {
    if (this.disposed || !this.car) return;
    this.restoring = true;
    try {
      await this.stage.prewarm(this.stage.scene, { onlyVisible: true });
    } catch (e) {
      console.warn('context restore: compile failed', e);
    }
    this.restoring = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.detachInput = this.camera.attach(this.canvas);
    if (VIRTUAL_TIME) return; // frames are drawn on request (window.__fabAdvance)
    const loop = () => {
      if (!this.running) return;
      this.frame(tickRealtime());
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Step the virtual clock (test and recording harness). */
  advance(n: number, render = true) {
    for (let i = 0; i < n; i++) this.frame(tickVirtual(), render || i === n - 1);
  }

  // ─────────────────────────── requests from the interface ───────────────────────────

  request(viewId: string | View, opts: Parameters<AnimationDirector['request']>[1] = {}) {
    const v = typeof viewId === 'string' ? VIEWS[viewId] : viewId;
    if (!v) return false;
    return this.director.request(v, opts);
  }

  /** Run a lesson or the film from a moment. Starting a sequence plays it (the pause is released). */
  playSequence(seq: Sequence, at = 0) {
    this.live = null;
    this.liveEnded = false;
    this.guided = true;
    this.player.load(seq);
    this.player.onBeat = (b) => {
      this.focusCyl = b.beat.focusCyl ?? -1;
      this.extraChannels = b.beat.channels ?? {};
      const v = VIEWS[b.beat.view];
      if (v) {
        const merged: View = b.beat.channels ? { ...v, id: `${v.id}+${b.beat.id}`, channels: { ...v.channels, ...b.beat.channels } } : v;
        const before = this.director.view?.id;
        this.director.request(merged, { demonstrating: true });
        // the beat waits for its subject when the view changes (or its assets are not ready)
        if (this.director.state === 'preparing' || (before !== merged.id && this.director.busy)) this.gate = { since: this.clocks.real };
      }
      this.roadOpts = roadOptsOf(b.beat.program?.road ?? this.model.road.spec);
      this.publishPlayer();
    };
    this.player.onEnd = () => this.publishPlayer();
    this.seek(at);
    this.setPaused(false);
    this.player.play();
    this.publishPlayer();
  }

  stopSequence() {
    this.guided = false;
    this.gate = null;
    this.seekPending = null;
    this.jobs.cancel('seek');
    this.player.pause();
    this.player.hold = false;
    this.player.seq = null;
    this.player.onBeat = undefined;
    this.focusCyl = -1;
    this.extraChannels = {};
    usePlayer.setState({ id: null, playing: false, caption: '', beats: [], beat: -1, holding: false });
  }

  /**
   * Seek the sequence: the beat and its view at once; the car's exact state at that moment
   * from its chain's start — on the page when it is a short way in, otherwise off the page,
   * while the beat waits (the last good picture stays). Successive seeks supersede each other.
   */
  seek(t: number) {
    const p = this.player;
    if (!p.seq) return;
    const b = p.seekTo(t);
    const mech = p.mechTime(p.t);
    const seq = p.seq;
    const id = ++this.seekSerial;
    if (mech - p.beats[b.chain].mechStart <= SEEK_INLINE || mech <= SEEK_INLINE || !this.jobs.usingWorker) {
      this.seekPending = null;
      this.jobs.cancel('seek');
      this.loadSeek(this.seekCache.sample(seq, p.t), b.chain);
    } else {
      this.seekPending = { id, t: p.t };
      this.jobs
        .seek(seq.id, p.t)
        .then((snap) => {
          if (this.disposed || this.seekPending?.id !== id || this.player.seq !== seq) return;
          this.loadSeek(snap, b.chain);
          this.seekPending = null;
        })
        .catch((e) => {
          if (this.disposed || this.seekPending?.id !== id || this.player.seq !== seq) return;
          console.warn('seek off the page failed; computing here', e);
          this.loadSeek(this.seekCache.sample(seq, this.player.t), b.chain);
          this.seekPending = null;
        });
    }
    this.publishPlayer();
  }

  private loadSeek(snap: import('../sim/car').CarSnapshot, chain: number) {
    this.model.load(snap);
    this.player.attachProgram(chain);
    this.roadOpts = roadOptsOf(this.model.road.spec);
  }

  /** Start a live run (free modes, labs, scenarios, the workbench). Nothing is inherited. */
  setLive(spec: RunSpec | null) {
    this.live = spec;
    this.liveEnded = false;
    this.guided = false;
    this.driver.reset();
    if (!spec) return;
    initRun(this.model, spec);
    this.roadOpts = roadOptsOf(this.model.road.spec);
    this.clocks.timeScale = spec.timeScale ?? 1;
    this.publishRun();
  }

  /** Change the road under a live run (the workbench's surface and bump choices); nothing else changes. */
  setRoad(spec: import('../sim/car').RoadSpec) {
    this.model.road = makeRoad(spec);
    if (this.live) this.live = { ...this.live, road: spec };
    this.roadOpts = roadOptsOf(spec);
  }

  /** Start the live run again from its beginning (replay). */
  restartLive() {
    if (this.live) this.setLive(this.live);
  }

  /**
   * A repair during a fault case: the fault is cleared on the running car (and in its run, so a
   * loop does not bring it back); what the repair replaces is set too (a new battery is charged).
   * Everything else carries on from where it is, so temperatures and pressures recover over time.
   */
  repair(faults: Partial<Faults>, state: Partial<Pick<CarState, 'soc'>> = {}) {
    this.model.faults = { ...this.model.faults, ...faults };
    Object.assign(this.model.s, state);
    if (state.soc !== undefined) this.model.restore(this.model.s);
    if (this.live) this.live = { ...this.live, faults: { ...(this.live.faults ?? {}), ...faults }, start: this.live.start };
  }

  /** Pause or resume the presentation: the lesson or film, the live run, the narration. */
  setPaused(paused: boolean) {
    this.paused = paused;
    this.director.setPaused(paused);
    if (this.player.seq) {
      if (paused) this.player.pause();
      else if (!this.player.ended) this.player.play();
    }
    this.publishPlayer();
    this.publishRun();
  }

  /** @deprecated use setPaused */
  pause(paused: boolean) {
    this.setPaused(paused);
  }

  publishPlayer() {
    const p = this.player;
    if (!p.seq) return;
    usePlayer.setState({
      id: p.seq.id,
      title: p.seq.title,
      t: p.t,
      duration: p.duration,
      playing: p.playing,
      holding: p.hold || !!this.seekPending,
      beat: p.index,
      beats: p.beats.map((b) => ({ title: b.beat.title, text: b.beat.text, start: b.start, chapter: b.beat.chapter, readouts: b.beat.readouts, timeScale: typeof b.beat.timeScale === 'number' ? b.beat.timeScale : (b.beat.timeScale?.to ?? 1), pace: b.beat.pace })),
      caption: p.caption(),
      ended: p.ended,
    });
  }

  publishRun() {
    const l = this.live;
    const s = this.model.s;
    const elapsed = l ? s.t - this.model.programT0 : 0;
    useRun.setState({
      id: l?.id ?? null,
      status: !l ? 'none' : this.paused ? 'paused' : this.liveEnded ? 'ended' : l.drive ? 'scripted' : 'manual',
      t: elapsed,
      duration: l?.duration ?? null,
      scale: l?.timeScale ?? 1,
    });
  }

  // ─────────────────────────────── the frame ───────────────────────────────

  private frameOnce(dt: number) {
    this.frame(dt, true);
  }

  frame(dt: number, render = true) {
    if (this.disposed) return;
    // a lost (or restoring) graphics context suspends the whole presentation
    if (this.stage.contextLost || this.restoring) {
      this.counters.suspendedFrames++;
      return;
    }
    this.counters.frames++;
    const c = this.clocks;
    const guided = this.guided && !!this.player.seq;
    // a beat waits for its subject: its view arriving, its assets, a sought state
    if (this.gate && ((this.director.state !== 'preparing' && !this.director.busy) || c.real - this.gate.since > GATE_MAX)) this.gate = null;
    const gated = guided && (!!this.gate || !!this.seekPending || this.director.state === 'preparing');
    this.player.hold = gated;
    c.guided = guided;
    c.tick(dt, { paused: this.paused, gated, navigating: this.director.pausedNavigation, ended: !guided && this.liveEnded });
    this.director.update(c.transitionDt);

    // ── the car's model: a lesson's program on presentation time, or the live run
    let alpha = 0;
    const s0 = this.model.s;
    if (guided) {
      const target = this.player.update(c.presentationDt);
      if (target !== null && !this.seekPending) alpha = this.model.advanceTo(target);
    } else if (this.live) {
      const l = this.live;
      // a run without a script is driven by the visitor, through the workbench's controls
      if (!l.drive) this.driver.update(this.paused ? 0 : c.realDt);
      if (l.loop && s0.t - this.model.programT0 > l.loop) this.setLive(l);
      let mdt = c.mechanicalDt;
      if (l.duration !== undefined) mdt = Math.min(mdt, Math.max(0, this.model.programT0 + l.duration - this.model.s.t));
      alpha = this.model.advance(mdt);
      const el = this.model.s.t - this.model.programT0;
      if (!this.liveEnded && ((l.duration !== undefined && el >= l.duration - 0.0015) || l.until?.(this.model.s, el))) {
        this.liveEnded = true;
        this.publishRun();
      }
    } else alpha = this.model.advance(c.mechanicalDt);
    const s = this.model.s;
    const inp = this.model.inputs;
    interpolate(this.model.prev, s, alpha, this.view, { brakeN: inp.brakeN, throttle: inp.throttle, cranking: inp.start && s.engine !== 'running', start: inp.start, ignition: inp.ignition });

    // ── channels (they stop with a pause, and move for a paused navigation), mechanism, looks, rig
    this.channels.update(c.transitionDt);
    const rig = this.car.rig;
    rig.resetMechanism();
    this.mech.pose(this.view);
    this.looks.apply(s, c.transitionDt);
    const ch = this.channels;
    // a panel opens with all of them (open) or alone (open:<panel>), never twice as far
    rig.apply((g) => (g.startsWith('open-') ? Math.min(1, Math.max(ch.get('open'), ch.get(`open:${g.slice(5)}`))) : ch.get(`explode:${g}`)));

    // ── keep-outs ride on the body
    for (let i = 0; i < this.keepOut.length; i++) {
      this.mech.bodyPoint(KEEP_OUT[i].a, this.keepOut[i].a);
      this.mech.bodyPoint(KEEP_OUT[i].b, this.keepOut[i].b);
    }

    // ── visuals driven by the model
    this.updateViz(s);

    // ── camera
    this.camera.update(c.cameraDt, c.inputDt);

    // ── labels follow the camera
    if (this.labels && render) {
      this.car.sprung.updateMatrixWorld();
      this.labels.update(this.stage.camera, this.car.sprung.matrixWorld, this.stage.width, this.stage.height, (id) => this.channels.get(`label:${id}`));
    }

    // ── render
    if (render) this.stage.render(dt);

    if (this.telemetry.on) {
      const cam = this.stage.camera;
      this.telemetry.frames.push({
        t: frameTime.now,
        cam: cam.position.toArray(),
        target: this.camera.effective().target.toArray(),
        fov: cam.fov,
        state: this.director.state,
        transitions: this.director.transitions,
        camMove: this.camera.transitionId,
        clamps: this.camera.clamps.frames,
        modelT: s.t,
        presT: this.player.t,
        run: this.guided ? (this.model.programId ?? null) : (this.live?.id ?? null),
        paused: this.paused,
        gated,
        input: this.camera.isDragging ? 'visitor' : this.director.busy ? 'authored' : 'none',
      });
    }
    // ── readouts, ten times a second (real time; every frame on the test clock)
    if (frameTime.now - this.lastPublish >= 0.1 || VIRTUAL_TIME) {
      this.lastPublish = frameTime.now;
      this.publish(s);
    }
  }

  private _o = new Vector3();
  private lastVizT = 0;
  private blurAmt = [0, 0, 0, 0];
  private _dir = new Vector3();
  private _up = new Vector3(0, 1, 0);
  private _x = new Vector3(1, 0, 0);

  private updateViz(s: CarState) {
    const ch = this.channels;
    const ph = s.phase;
    // a flow whose modelled rate is zero is drawn still and faint (the circuit, not a motion)
    const rateOk = (v: number) => (v > 0 ? 1 : 0.35);
    const fl = this.flows;
    const eye = this.stage.camera.position;
    const set = (id: string, phase: number, rate: number) => {
      const f = fl.get(id);
      if (f) f.update(phase, ch.get(`flow:${id}`) * rateOk(rate), eye);
    };
    set('air', ph.air, s.airGs);
    set('fuel', ph.fuel, s.fuelGs);
    set('exhaust', ph.exhaust, s.airGs);
    set('coolantEngine', ph.coolant + ph.bypass, s.radiatorFlow + s.bypassFlow);
    set('coolantBypass', ph.bypass, s.bypassFlow);
    set('coolantRadiator', ph.coolant, s.radiatorFlow);
    set('coolantHeater', ph.heater, this.model.inputs.heater ? 1 : 0);
    set('radiatorAir', ph.radiatorAir, Math.abs(s.u) + s.fanSpeed);
    set('oilMain', ph.oil, s.oilBar);
    set('oilHead', ph.oil * 0.8, s.oilBar);
    set('oilReturn', ph.oil * 0.5, s.oilBar);
    set('oilMains', ph.oil, s.oilBar);
    set('starterCurrent', ph.power, s.starterAmps);
    set('groundReturn', ph.power, s.starterAmps + Math.abs(s.batteryAmps));
    set('chargeCurrent', ph.power, s.alternatorAmps);
    set('ecuPower', ph.signal * 0.6, s.ecuPowered ? 1 : 0);
    set('can', ph.signal * 1.4, s.ecuPowered ? 1 : 0);
    for (let i = 0; i < 4; i++) set(`brake${i}`, ph.brake, s.linePa);
    set('brakeMaster', ph.brake, s.linePa);
    set('refrigerant', ph.refrigerant, s.engine === 'running' ? 1 : 0);
    set('cabinAir', ph.cabinAir, this.model.inputs.ignition ? 1 : 0);
    // the gearbox's shift elements: lit while applied, fading in and out through a change
    const elOn = ch.get('flow:elements');
    if (elOn > 0.002) {
      const el = this.model.elements();
      const sh = s.shift;
      for (const e of ['A', 'B', 'C', 'D', 'E'] as const) {
        const v = el.engaged.includes(e) ? 1 : el.applying === e ? sh : el.releasing === e ? 1 - sh : 0;
        for (const m of this.car.drivetrain.elements[e].meshes) {
          const u = m.userData.pair?.u;
          if (u) u.uHighlight.value = v * elOn * 0.95;
        }
      }
    }
    // the converter's fluid: from the model's integrated circulation (a seek rebuilds it)
    for (const id of ['convUpper', 'convLower']) fl.get(id)?.update(ph.converter * 0.25, ch.get('flow:converter') * rateOk(Math.abs(s.omegaE - s.omegaT) - 1), eye);
    const torqueOn = Math.abs(s.wheelTorque) > 5 || (s.engine === 'running' && Math.abs(s.engineTorque) > 5) ? 1 : 0;
    for (const id of ['torque', 'torqueL', 'torqueR']) {
      const f = fl.get(id);
      if (f) f.update(ph.torque, ch.get('flow:torque') * rateOk(torqueOn), eye);
    }

    // the cylinders
    this.engineViz.update(s.crank, {
      opacity: ch.get('flow:combustion'),
      combustion: s.combustion,
      load: Math.min(1, (s.map - 0.25e5) / 0.75e5),
      rpm: units.radToRpm(s.omegaE),
      map: s.map,
      running: s.engine === 'running' || (s.engine === 'cranking' && s.fires > 0),
      focusCyl: this.focusCyl,
      sparkWindowDeg: 10,
    });

    // the wheels' spin blur: how far each wheel turned since the last drawn frame (simulated
    // time advanced × its speed). Five double spokes repeat every 72°: past about 15° a frame
    // they start to strobe and past 36° they seem to turn backwards, so the blur fades in from
    // 12° to 30° a frame. In slow motion each frame's turn is small and the spokes stay sharp.
    {
      const dtm = Math.max(0, s.t - this.lastVizT);
      this.lastVizT = s.t;
      const wheelGhost = Math.max(ch.get('ghost:wheels'), ch.get('hide:wheels'));
      const corners = this.car.chassis.corners;
      for (let i = 0; i < 4; i++) {
        const step = (Math.abs(s.wheelOmega[i]) * dtm * 180) / Math.PI;
        const b = Math.min(1, Math.max(0, (step - 12) / 18));
        const k = this.blurAmt[i] + (b - this.blurAmt[i]) * (1 - Math.exp(-this.clocks.realDt * 14));
        this.blurAmt[i] = k;
        const blur = corners[i].blur;
        blur.material.opacity = 0.88 * k * (1 - wheelGhost);
        blur.visible = blur.material.opacity > 0.01;
        corners[i].tyreMat.userData.u.uBlur.value = k;
      }
    }

    // tyre force arrows at the contact patches (no allocation per frame)
    const at = ch.get('arrow:tyre');
    if (at > 0) {
      const corners = this.car.chassis.corners;
      for (let i = 0; i < 4; i++) {
        const g = corners[i].group;
        const o = this._o.set(g.position.x, 0.01, g.position.z);
        const fx = s.fx[i];
        const fy = s.fy[i];
        const steer = s.steerAngle[i];
        const dir = this._dir.set(Math.cos(steer) * fx + Math.sin(steer) * fy, 0, -Math.sin(steer) * fx + Math.cos(steer) * fy);
        const mag = dir.length();
        this.arrows.get(`tyre${i}`, '#E69F00', 0.012).set(o, mag > 1 ? dir : this._x, Math.min(1.4, mag / 3500), at);
        this.arrows.get(`load${i}`, '#cfd6e2', 0.008).set(o, this._up, Math.min(0.9, s.fz[i] / 9000), at * 0.6);
      }
    } else this.arrows.hideAll();

    // the road
    this.road.update(ch.get('show:road'), s.X, s.Z, s.heading, this.roadOpts);
    this.studio.floorMat.uniforms.uDim.value *= 1 - 0.6 * ch.get('show:road');
  }

  publish(s: CarState) {
    const st = this.engineViz.state;
    const el = this.model.elements();
    const gt = this.model.geartrain;
    const gearName = s.gear === -1 ? 'R' : s.gear === 0 ? s.selector : String(s.gear);
    useReadouts.setState({
      rpm: units.radToRpm(s.omegaE),
      kmh: units.msToKmh(s.u),
      gear: gearName,
      selector: s.selector,
      selectorWanted: this.model.inputs.selector,
      throttle: this.model.inputs.throttle,
      brakeBar: s.linePa / 1e5,
      torque: s.engineTorqueMean,
      wheelTorque: s.wheelTorque,
      coolantC: s.coolantC,
      oilBar: s.oilBar,
      oilC: s.oilC,
      volts: s.volts,
      batteryAmps: s.batteryAmps,
      alternatorAmps: s.alternatorAmps,
      soc: s.soc,
      fuelGs: s.fuelGs,
      airGs: s.airGs,
      lambda: s.lambda,
      fuelTrim: s.fuelTrim,
      thermostat: s.thermostat,
      fanOn: s.fanOn,
      lockup: s.lockup,
      engine: s.engine,
      ax: s.ax / 9.81,
      ay: -s.az / 9.81,
      pitchDeg: (s.pitch * 180) / Math.PI,
      rollDeg: (s.roll * 180) / Math.PI,
      yawRate: s.r,
      slip: [...s.slip],
      fz: [...s.fz],
      rotorC: [...s.rotorC],
      abs: [...s.absPhase],
      absCycles: s.absCycles,
      caliperBar: s.caliperPa.map((p) => p / 1e5),
      stopDistance: s.stopDistance,
      heave: s.heave,
      steerDeg: (s.steerWheel * 180) / Math.PI,
      roadWheelDeg: (((s.steerAngle[0] + s.steerAngle[1]) / 2) * 180) / Math.PI,
      wheelAngleDeg: s.steerAngle.slice(0, 2).map((a) => (a * 180) / Math.PI),
      strokes: st.map((c) => c.stroke),
      pressures: st.map((c) => c.pressureBar),
      burns: st.map((c) => c.burn),
      phases: st.map((c) => c.phase),
      warnings: { ...s.warnings },
      misfireCount: s.misfireCount,
      elements: el.engaged,
      applying: el.applying,
      releasing: el.releasing,
      slipRpm: { A: units.radToRpm(gt.slip.A), B: units.radToRpm(gt.slip.B), C: units.radToRpm(gt.slip.C), D: units.radToRpm(gt.slip.D), E: units.radToRpm(gt.slip.E) },
      shaftRpm: gt.shaft.map((w) => units.radToRpm(w)),
      statorLocked: this.model.statorLocked,
      starterAmps: s.starterAmps,
      turbineRpm: units.radToRpm(s.omegaT),
      wheelKmh: s.wheelOmega.map((w) => units.msToKmh(w * TIRE.rollingRadius)),
      wheelTravelMm: s.wheelZ.map((z) => z * 1000),
      t: s.t,
    });
    if (this.player.seq) {
      const p = this.player;
      const bi = p.beats[p.index];
      const sc = bi ? scaleAt(bi.beat.timeScale, p.t - bi.start) : 1;
      // three significant figures: a ramp shows as it changes without re-rendering every frame
      const scale = +sc.toPrecision(3);
      usePlayer.setState({ t: p.t, playing: p.playing, holding: p.hold || !!this.seekPending, beat: p.index, caption: p.caption(), ended: p.ended, scale });
    }
    if (this.live) this.publishRun();
    const camOff = this.camera.offFraming;
    if (camOff !== useApp.getState().camOff) useApp.setState({ camOff });
    useApp.setState({ director: this.director.state });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.detachInput?.();
    this.labels?.dispose();
    this.jobs.dispose();
    this.counters.disposed = disposeTree(this.stage.scene);
    this.stage.dispose();
  }

  private raycaster = new Raycaster();
  private nodeOf: WeakMap<Object3D, import('../scene/car/rig').PartNode> | null = null;

  /**
   * What the visitor tapped (client coordinates): the registry component of the first part under
   * the pointer that is actually drawn there. Parts faded to glass, hidden, or cut away by a
   * section plane at that point are passed over, so a tap reaches what the picture shows.
   */
  pick(clientX: number, clientY: number): string | null {
    if (!this.car) return null;
    if (!this.nodeOf) {
      this.nodeOf = new WeakMap();
      for (const n of this.car.rig.parts.values()) this.nodeOf.set(n.object, n);
    }
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.stage.camera);
    const hits = this.raycaster.intersectObject(this.car.root, true);
    const panelGhost = new Map(this.car.body.panels.flatMap((p) => [[p.paint, p.ghost], [p.glass, 1]] as [Mesh, number][]));
    for (const h of hits) {
      const m = h.object as Mesh;
      if (!m.isMesh || !m.visible) continue;
      let hidden = false;
      for (let o: Object3D | null = m; o; o = o.parent) if (!o.visible) hidden = true;
      if (hidden) continue;
      const pg = panelGhost.get(m);
      if (pg !== undefined && pg > 0.4) continue;
      const u = m.userData.pair?.u;
      if (u && (u.uGhost?.value ?? 0) > 0.4) continue;
      if (u && (u.uHide?.value ?? 0) > 0.5) continue;
      const mat = m.material as Material & { clippingPlanes?: Plane[] | null };
      if (mat.clippingPlanes?.some((pl) => pl.distanceToPoint(h.point) < 0)) continue;
      for (let o: Object3D | null = m; o; o = o.parent) {
        const n = this.nodeOf.get(o);
        if (n) return n.component;
      }
    }
    return null;
  }

  /** Test and recording hooks. */
  exposeHooks() {
    if (!TEST_HOOKS) return;
    const w = window as unknown as Record<string, unknown>;
    w.__fab = this;
    w.__fabStores = { useApp, useReadouts, usePlayer, useRun, useQuality };
    w.__fabAdvance = (n = 1, render = true) => this.advance(n, render);
  }
}

function roadOptsOf(r: import('../sim/car').RoadSpec): World['roadOpts'] {
  const o: World['roadOpts'] = {};
  if (r.bumpAt !== undefined) {
    o.bumpAt = r.bumpAt;
    o.bumpHeight = r.bumpHeight ?? 0.07;
    o.bumpLength = r.bumpLength ?? 0.7;
  }
  if (r.curve !== undefined) o.curve = r.curve;
  if (r.curveX !== undefined) o.curveX = r.curveX;
  if (r.mu < 0.5) o.lowGrip = Math.min(1, (0.6 - r.mu) / 0.5);
  return o;
}
