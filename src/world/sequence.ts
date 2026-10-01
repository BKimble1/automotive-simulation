/**
 * Sequences: the hero lessons and the film. A sequence is a list of beats on the presentation
 * clock; each beat names a view (the director moves there from what is displayed), a short
 * title and caption, and how fast mechanical time runs (slow motion for the four-stroke cycle).
 *
 * The car's motion comes from a *program*: a starting state and a driver script evaluated at
 * every fixed model step. A beat with a program starts a chain; the beats after it (without one)
 * continue the same run. Mechanical time within a chain is an exact function of presentation
 * time (each beat's time scale is constant or a linear ramp, integrated in closed form), so
 * playing to a moment and seeking to it give the same state, bit for bit (tested).
 */
import { Car, cloneState, type CarState, type Faults, type Inputs, type Params, type Road, NO_FAULTS, defaultInputs, defaultParams } from '../sim/car';
import { TIRE } from '../spec/vehicle';
import type { View } from './views';

export interface Cue {
  /** Start, s from the beat's start (presentation time). */
  at: number;
  text: string;
}

export interface Program {
  start: () => CarState;
  /** The driver: sets the inputs from the time since the program started (simulated s). */
  drive?: (t: number, inp: Inputs, s: CarState) => void;
  faults?: Partial<Faults>;
  road?: Road;
  params?: Partial<Params>;
}

/** Mechanical time per second of presentation: constant, or a ramp from `from` to `to` over `ramp` s. */
export type TimeScale = number | { from: number; to: number; ramp: number; delay?: number };

export interface Beat {
  id: string;
  title: string;
  text: string;
  duration: number;
  view: string;
  program?: Program;
  timeScale?: TimeScale;
  cues?: Cue[];
  chapter?: string;
  /** Narration segment id (bundled audio), if any. */
  narration?: string;
  /** The engine cylinder the lesson follows (its gas is shown strongly), or −1. */
  focusCyl?: number;
  /** Extra channel targets for this beat on top of its view's. */
  channels?: Record<string, number>;
}

export interface Sequence {
  id: string;
  title: string;
  beats: Beat[];
}

/** ∫₀ᵗ scale(τ) dτ for a time scale. */
export function scaledTime(ts: TimeScale | undefined, t: number): number {
  if (ts === undefined) return t;
  if (typeof ts === 'number') return ts * t;
  const d = ts.delay ?? 0;
  if (t <= d) return ts.from * t;
  const u = Math.min(t - d, ts.ramp);
  const ramped = ts.from * u + ((ts.to - ts.from) * u * u) / (2 * ts.ramp);
  const after = t - d > ts.ramp ? ts.to * (t - d - ts.ramp) : 0;
  return ts.from * d + ramped + after;
}

export function scaleAt(ts: TimeScale | undefined, t: number): number {
  if (ts === undefined) return 1;
  if (typeof ts === 'number') return ts;
  const d = ts.delay ?? 0;
  if (t <= d) return ts.from;
  const u = Math.min(1, (t - d) / ts.ramp);
  return ts.from + (ts.to - ts.from) * u;
}

export interface BeatInfo {
  beat: Beat;
  index: number;
  start: number;
  /** Index of the beat whose program this beat's chain runs. */
  chain: number;
  /** Mechanical time at this beat's start, from its chain's start. */
  mechStart: number;
}

export class SequencePlayer {
  seq: Sequence | null = null;
  beats: BeatInfo[] = [];
  duration = 0;
  /** Presentation time within the sequence, s. */
  t = 0;
  index = -1;
  playing = false;
  ended = false;
  /** Called when a beat starts (the world requests its view). */
  onBeat?: (b: BeatInfo, viaSeek: boolean) => void;
  onEnd?: () => void;

  constructor(private car: Car) {}

  load(seq: Sequence) {
    this.seq = seq;
    this.beats = [];
    let t = 0;
    let chain = 0;
    let mech = 0;
    seq.beats.forEach((b, i) => {
      if (b.program || i === 0) {
        chain = i;
        mech = 0;
      }
      this.beats.push({ beat: b, index: i, start: t, chain, mechStart: mech });
      mech += scaledTime(b.timeScale, b.duration);
      t += b.duration;
    });
    this.duration = t;
    this.t = 0;
    this.index = -1;
    this.ended = false;
  }

  beatAt(t: number): BeatInfo {
    const tt = Math.max(0, Math.min(this.duration - 1e-6, t));
    let lo = 0;
    for (let i = 0; i < this.beats.length; i++) if (this.beats[i].start <= tt) lo = i;
    return this.beats[lo];
  }

  /** Mechanical time since the current chain's start, at sequence time t. */
  mechTime(t: number): number {
    const b = this.beatAt(t);
    return b.mechStart + scaledTime(b.beat.timeScale, Math.max(0, t - b.start));
  }

  /** Install a chain's program on the car and reset it to the program's starting state. */
  private startChain(chainIndex: number) {
    const p = this.beats[chainIndex].beat.program;
    if (!p) return;
    this.car.restore(p.start());
    this.car.faults = { ...NO_FAULTS, ...(p.faults ?? {}) };
    this.car.road = p.road ?? { mu: TIRE.muDry };
    this.car.params = { ...defaultParams(), ...(p.params ?? {}) };
    this.car.inputs = { ...defaultInputs(), ignition: this.car.s.engine === 'running' };
    const drive = p.drive;
    this.car.program = drive ? (tt, inp, s) => drive(tt, inp, s) : null;
    this.car.programT0 = this.car.s.t;
  }

  play() {
    this.playing = true;
  }
  pause() {
    this.playing = false;
  }

  /**
   * Seek: the beat at t is entered (its view requested from what is displayed) and the car is
   * re-simulated from its chain's starting state to exactly the mechanical time at t.
   */
  seek(t: number) {
    this.t = Math.max(0, Math.min(this.duration, t));
    this.ended = false;
    const b = this.beatAt(this.t);
    this.startChain(b.chain);
    const target = this.car.programT0 + this.mechTime(this.t);
    this.car.runTo(target);
    this.index = b.index;
    this.onBeat?.(b, true);
  }

  /**
   * Advance presentation time by dt (0 while paused). Returns how far the car's model must be
   * run, as an absolute simulated time to reach.
   */
  update(dt: number): number | null {
    if (!this.seq) return null;
    if (this.index < 0) {
      this.seek(0);
      return null;
    }
    if (this.playing && !this.ended) {
      this.t += dt;
      if (this.t >= this.duration) {
        this.t = this.duration;
        this.ended = true;
        this.playing = false;
        this.onEnd?.();
      }
    }
    const b = this.beatAt(this.t);
    if (b.index !== this.index) {
      // a new chain restarts the car from its program's state; a continuing beat keeps it
      if (b.chain !== this.beats[this.index]?.chain) this.startChain(b.chain);
      this.index = b.index;
      this.onBeat?.(b, false);
    }
    return this.car.programT0 + this.mechTime(this.t);
  }

  get beat(): BeatInfo | null {
    return this.index >= 0 ? this.beats[this.index] : null;
  }

  /** The caption showing at the current time. */
  caption(): string {
    const b = this.beat;
    if (!b) return '';
    const local = this.t - b.start;
    const cues = b.beat.cues ?? [];
    let text = '';
    for (const c of cues) if (c.at <= local) text = c.text;
    return text;
  }

  /** A snapshot of the car at a time, without disturbing playback (tests). */
  stateAt(t: number): CarState {
    const keepT = this.t;
    const keepI = this.index;
    const snap = this.car.snapshot();
    const prog = this.car.program;
    const t0 = this.car.programT0;
    this.seek(t);
    const out = cloneState(this.car.s);
    this.car.restore(snap);
    this.car.program = prog;
    this.car.programT0 = t0;
    this.t = keepT;
    this.index = keepI;
    return out;
  }
}

export type { View };
