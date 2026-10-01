/**
 * The world: the runtime that owns the scene for the whole visit. One frame loop in a fixed
 * order, and nothing else moves anything:
 *
 *   clocks → director (sample) → sequence or live model → channels → mechanism → looks
 *          → rig (baselines + offsets + explodes) → flows, cylinders, arrows, road
 *          → camera → render → readouts (10 Hz)
 *
 * The scene is built once, progressively: the studio and the car (on the light body mesh) and
 * the materials the opening picture needs, compiled before the veil lifts; then every other
 * material variant (ghosts, sections) is compiled in the background; then the detailed body is
 * swapped in where the device can afford it. The director will not move to a view whose parts
 * are not ready (it holds the picture instead), so there is never a blank frame or a shader
 * compile in the middle of a move.
 */
import { Matrix4, Vector3, type Mesh } from 'three';
import { Stage } from '../scene/stage';
import { Studio } from '../scene/studio';
import { Road } from '../scene/road';
import { Channels } from '../scene/channels';
import { Director as CameraDirector, type KeepOut } from '../scene/camera/director';
import { frameTime, tickRealtime, tickVirtual, VIRTUAL_TIME, TEST_HOOKS } from '../scene/time';
import { TIERS, useQuality } from '../scene/quality';
import { loadBody } from '../scene/car/bodyData';
import { splitPanels } from '../scene/car/body';
import { buildCar, type Car as CarScene } from '../scene/car/build';
import { Flows } from '../scene/viz/flows';
import { ArrowSet } from '../scene/viz/arrows';
import { EngineViz } from '../scene/viz/engineViz';
import { Car, presetIdle, type CarState } from '../sim/car';
import { TIRE, units } from '../spec/vehicle';
import { Clocks } from './clocks';
import { AnimationDirector } from './director';
import { Looks } from './looks';
import { Mechanism, emptyView, interpolate } from './mechanism';
import { SequencePlayer, type Sequence } from './sequence';
import { KEEP_OUT, VIEWS, type View } from './views';
import { FLOW_DEFS } from './flowDefs';
import { LabelLayer } from '../scene/labels';
import { labelDefs } from './labelDefs';
import { usePlayer, useReadouts, useApp } from '../state/store';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** The live (free-mode) program the model runs when no lesson does. */
export interface LiveProgram {
  id: string;
  start: () => CarState;
  drive?: (t: number, inp: Car['inputs'], s: CarState) => void;
  setup?: (car: Car) => void;
  timeScale?: number;
  /** Start the program again after this many simulated seconds. */
  loop?: number;
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
  /** The live program (free modes). */
  live: LiveProgram | null = null;
  /** True while a sequence (lesson or film) drives the car. */
  guided = false;
  /** Road settings of the current program (for drawing). */
  roadOpts: { curve?: number; curveX?: number; bumpAt?: number; lowGrip?: number } = {};
  /** Telemetry for the continuity tests (with the test hooks): one record per frame. */
  telemetry: { on: boolean; frames: { t: number; cam: number[]; target: number[]; fov: number; state: string; transitions: number }[] } = { on: false, frames: [] };
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
    this.director = new AnimationDirector(this.camera, this.channels, {
      ready: (groups) => groups.every((g) => this.readyGroups.has(g)),
      focus: (a, tint) => {
        this.looks.focus = new Set(a);
        this.looks.setTint(tint);
      },
      adjust: (c) => c,
    });
    this.stage.onContextChange = (lost) => useApp.setState({ contextLost: lost });
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
      progress(0.25);
      await nextFrame();
      this.car = buildCar(lo);
      this.stage.scene.add(this.car.root);
      progress(0.55);
      await nextFrame();
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
      // first picture
      this.frameOnce(0);
      progress(0.7);
      await this.stage.prewarm();
      progress(0.9);
      this.readyGroups.add('hero');
      // the rest compiles in the background: every material's other variants (ghost, section)
      void this.compileVariants().then(async () => {
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

  /** Compile every ghost variant (by drawing a frame with them swapped in, off screen). */
  private async compileVariants() {
    await nextFrame();
    const swapped: [Mesh, unknown][] = [];
    for (const n of this.car.rig.parts.values())
      for (const m of n.meshes) {
        const pair = m.userData.pair;
        if (!pair) continue;
        swapped.push([m, m.material]);
        m.material = pair.ghost;
      }
    for (const p of this.car.body.panels) {
      swapped.push([p.paint, p.paint.material], [p.glass, p.glass.material]);
      p.paint.material = p.mats.paintGhost;
      p.glass.material = p.mats.glassGhost;
    }
    try {
      await this.stage.prewarm();
    } finally {
      for (const [m, mat] of swapped) m.material = mat as Mesh['material'];
    }
    await nextFrame();
  }

  /** Replace the body's panel geometry with another level of detail (same shape: no visible change). */
  async swapBody(lod: 'hi' | 'lo') {
    const g = await loadBody(lod);
    const geos = splitPanels(g);
    for (const p of this.car.body.panels) {
      const old = p.paint.geometry;
      p.paint.geometry = geos[p.id];
      p.glass.geometry = geos[p.id];
      old.dispose();
    }
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

  /** Run a lesson or the film. */
  playSequence(seq: Sequence, at = 0) {
    this.live = null;
    this.guided = true;
    this.player.load(seq);
    this.player.onBeat = (b) => {
      this.focusCyl = b.beat.focusCyl ?? -1;
      this.extraChannels = b.beat.channels ?? {};
      const v = VIEWS[b.beat.view];
      if (v) {
        const merged: View = b.beat.channels ? { ...v, id: `${v.id}+${b.beat.id}`, channels: { ...v.channels, ...b.beat.channels } } : v;
        this.director.request(merged, { demonstrating: true });
      }
      this.roadOpts = b.beat.program?.road ? roadOptsOf(b.beat.program.road) : this.roadOpts;
      this.publishPlayer();
    };
    this.player.onEnd = () => this.publishPlayer();
    this.player.seek(at);
    this.player.play();
    this.publishPlayer();
  }

  stopSequence() {
    this.guided = false;
    this.player.pause();
    this.player.seq = null;
    this.player.onBeat = undefined;
    this.focusCyl = -1;
    this.extraChannels = {};
    usePlayer.setState({ id: null, playing: false, caption: '', beats: [], beat: -1 });
  }

  /** Run a live program (free modes, labs, scenarios). The car restarts from its state. */
  setLive(p: LiveProgram | null, keepState = false) {
    this.live = p;
    this.guided = false;
    if (!p) return;
    if (!keepState) this.model.restore(p.start());
    this.model.program = p.drive ? (t, inp, s) => p.drive!(t, inp, s) : null;
    this.model.programT0 = this.model.s.t;
    p.setup?.(this.model);
    this.roadOpts = roadOptsOf(this.model.road);
    this.clocks.timeScale = p.timeScale ?? 1;
  }

  pause(paused: boolean) {
    this.clocks.paused = paused;
    if (paused) this.director.pause();
    else this.director.resume();
    if (this.player.seq) {
      if (paused) this.player.pause();
      else if (!this.player.ended) this.player.play();
    }
    this.publishPlayer();
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
      beat: p.index,
      beats: p.beats.map((b) => ({ title: b.beat.title, text: b.beat.text, start: b.start, chapter: b.beat.chapter, readouts: b.beat.readouts, timeScale: typeof b.beat.timeScale === 'number' ? b.beat.timeScale : (b.beat.timeScale?.to ?? 1) })),
      caption: p.caption(),
      ended: p.ended,
    });
  }

  // ─────────────────────────────── the frame ───────────────────────────────

  private frameOnce(dt: number) {
    this.frame(dt, true);
  }

  frame(dt: number, render = true) {
    const c = this.clocks;
    c.paused = this.director.paused;
    c.tick(dt);
    this.director.update(c.presentationDt);

    // ── the car's model: a lesson's program on presentation time, or the live program
    let alpha = 0;
    if (this.guided && this.player.seq) {
      c.guided = true;
      const b = this.player.beat;
      const target = this.player.update(c.presentationDt);
      if (target !== null) alpha = this.model.advanceTo(target);
      // the lesson's own time scale is the beat's (for the readouts)
      void b;
    } else {
      c.guided = false;
      if (this.live?.loop && this.model.s.t - this.model.programT0 > this.live.loop) this.setLive(this.live);
      alpha = this.model.advance(c.mechanicalDt);
    }
    const s = this.model.s;
    const inp = this.model.inputs;
    interpolate(this.model.prev, s, alpha, this.view, { brakeN: inp.brakeN, throttle: inp.throttle, cranking: inp.start && s.engine !== 'running', start: inp.start, ignition: inp.ignition });

    // ── channels (stop with a pause), mechanism, looks, rig
    this.channels.update(c.presentationDt);
    const rig = this.car.rig;
    rig.resetMechanism();
    this.mech.pose(this.view);
    this.looks.apply(s, c.presentationDt);
    rig.apply((g) => this.channels.get(`explode:${g}`) + (g === 'open' ? this.channels.get('open') : 0));

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
      this.telemetry.frames.push({ t: frameTime.now, cam: cam.position.toArray(), target: this.camera.effective().target.toArray(), fov: cam.fov, state: this.director.state, transitions: this.director.transitions });
    }
    // ── readouts, ten times a second (real time; every frame on the test clock)
    if (frameTime.now - this.lastPublish >= 0.1 || VIRTUAL_TIME) {
      this.lastPublish = frameTime.now;
      this.publish(s);
    }
  }

  /** The converter fluid's travel (integrated), and the model time it was last advanced to. */
  private convPhase = 0;
  private convT = 0;

  private updateViz(s: CarState) {
    const ch = this.channels;
    const ph = s.phase;
    const running = s.engine === 'running' || s.engine === 'cranking';
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
    set('radiatorAir', s.t * (0.3 + Math.abs(s.u) * 0.08 + (s.fanSpeed > 10 ? 0.6 : 0)), 1);
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
    set('refrigerant', s.t * 0.25, running ? 1 : 0);
    set('cabinAir', s.t * 0.5, 1);
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
    // the converter's fluid circulates as fast as the impeller outruns the turbine
    const dtm = s.t - this.convT;
    this.convT = s.t;
    if (dtm > 0 && dtm < 0.5) this.convPhase += dtm * Math.min(3, 0.15 + Math.abs(s.omegaE - s.omegaT) / 60);
    for (const id of ['convUpper', 'convLower']) fl.get(id)?.update(this.convPhase * 0.25, ch.get('flow:converter'), eye);
    const torqueOn = Math.abs(s.wheelTorque) > 5 || (running && Math.abs(s.engineTorque) > 5) ? 1 : 0;
    for (const id of ['torque', 'torqueL', 'torqueR']) {
      const f = fl.get(id);
      if (f) f.update(s.t * 0.8, ch.get('flow:torque') * rateOk(torqueOn), eye);
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

    // tyre force arrows at the contact patches
    const at = ch.get('arrow:tyre');
    if (at > 0) {
      const corners = this.car.chassis.corners;
      for (let i = 0; i < 4; i++) {
        const g = corners[i].group;
        const o = new Vector3(g.position.x, 0.01, g.position.z);
        const fx = s.fx[i];
        const fy = s.fy[i];
        const steer = s.steerAngle[i];
        const dir = new Vector3(Math.cos(steer) * fx + Math.sin(steer) * fy, 0, -Math.sin(steer) * fx + Math.cos(steer) * fy);
        const mag = dir.length();
        this.arrows.get(`tyre${i}`, '#E69F00', 0.012).set(o, mag > 1 ? dir : new Vector3(1, 0, 0), Math.min(1.4, mag / 3500), at);
        this.arrows.get(`load${i}`, '#cfd6e2', 0.008).set(o.clone().add(new Vector3(0, 0, 0)), new Vector3(0, 1, 0), Math.min(0.9, s.fz[i] / 9000), at * 0.6);
      }
    } else this.arrows.hideAll();

    // the road
    this.road.update(ch.get('show:road'), s.X, s.Z, s.heading, this.roadOpts);
    this.studio.floorMat.uniforms.uDim.value *= 1 - 0.6 * ch.get('show:road');
  }

  publish(s: CarState) {
    const st = this.engineViz.state;
    const el = this.model.elements();
    const gearName = s.gear === -1 ? 'R' : s.gear === 0 ? this.model.inputs.selector : String(s.gear);
    useReadouts.setState({
      rpm: units.radToRpm(s.omegaE),
      kmh: units.msToKmh(s.u),
      gear: gearName,
      selector: this.model.inputs.selector,
      throttle: this.model.inputs.throttle,
      brakeBar: s.linePa / 1e5,
      torque: s.engineTorque,
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
      stopDistance: s.stopDistance,
      heave: s.heave,
      steerDeg: (s.steerWheel * 180) / Math.PI,
      roadWheelDeg: (((s.steerAngle[0] + s.steerAngle[1]) / 2) * 180) / Math.PI,
      strokes: st.map((c) => c.stroke),
      pressures: st.map((c) => c.pressureBar),
      burns: st.map((c) => c.burn),
      phases: st.map((c) => c.phase),
      warnings: { ...s.warnings },
      misfireCount: s.misfireCount,
      elements: el.engaged,
      applying: el.applying,
      releasing: el.releasing,
      statorLocked: this.model.statorLocked,
      starterAmps: s.starterAmps,
      turbineRpm: units.radToRpm(s.omegaT),
      wheelKmh: s.wheelOmega.map((w) => units.msToKmh(w * TIRE.rollingRadius)),
      wheelTravelMm: s.wheelZ.map((z) => z * 1000),
      t: s.t,
    });
    if (this.player.seq) {
      const p = this.player;
      usePlayer.setState({ t: p.t, playing: p.playing, beat: p.index, caption: p.caption(), ended: p.ended });
    }
    useApp.setState({ director: this.director.state });
  }

  dispose() {
    this.running = false;
    this.labels?.dispose();
    cancelAnimationFrame(this.raf);
    this.detachInput?.();
    this.stage.dispose();
  }

  /** Test and recording hooks. */
  exposeHooks() {
    if (!TEST_HOOKS) return;
    const w = window as unknown as Record<string, unknown>;
    w.__fab = this;
    w.__fabStores = { useApp, useReadouts, usePlayer };
    w.__fabAdvance = (n = 1, render = true) => this.advance(n, render);
  }
}

function roadOptsOf(r: { height?: (s: number, side: -1 | 1) => number; mu: number }): World['roadOpts'] {
  const o: World['roadOpts'] = {};
  const anyR = r as unknown as { bumpAt?: number; curve?: number; curveX?: number };
  if (anyR.bumpAt !== undefined) o.bumpAt = anyR.bumpAt;
  if (anyR.curve !== undefined) o.curve = anyR.curve;
  if (anyR.curveX !== undefined) o.curveX = anyR.curveX;
  if (r.mu < 0.5) o.lowGrip = Math.min(1, (0.6 - r.mu) / 0.5);
  return o;
}

void Matrix4;
void useQuality;
