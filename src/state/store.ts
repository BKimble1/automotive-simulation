/**
 * The interface's state. The world reads requests from here and publishes readouts (ten times
 * a second, never per frame); panels read only these stores. The address (query string) follows
 * the visitor, so a refresh or a shared link opens the same place:
 *
 *   ?mode=watch[&t=120]   ?mode=explore[&system=power][&part=piston][&lesson=braking]
 *   ?mode=engineer[&lab=gears]   ?mode=simulate[&scenario=overheat]
 */
import { create } from 'zustand';

export type Mode = 'intro' | 'watch' | 'explore' | 'engineer' | 'simulate';

export interface AppState {
  ready: boolean;
  /** Loading progress 0 … 1; −1 if 3D could not start. */
  progress: number;
  /** The detailed systems are built and compiled (Explore and the lessons can go anywhere). */
  carReady: boolean;
  mode: Mode;
  system: string | null;
  part: string | null;
  /** A hero lesson running ("Show how it works"). */
  lesson: string | null;
  lab: string | null;
  scenario: string | null;
  sound: boolean;
  captions: boolean;
  legend: boolean;
  reducedMotion: boolean;
  info: boolean;
  /** Phone bottom sheet expanded. */
  sheet: boolean;
  contextLost: boolean;
  /** The director's state (for tests and the "preparing" hint). */
  director: string;
  set: (p: Partial<AppState>) => void;
  go: (p: Partial<Pick<AppState, 'mode' | 'system' | 'part' | 'lesson' | 'lab' | 'scenario'>>) => void;
}

const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const modeParam = params.get('mode');
const initialMode: Mode = modeParam === 'watch' || modeParam === 'explore' || modeParam === 'engineer' || modeParam === 'simulate' ? modeParam : params.get('system') || params.get('part') || params.get('lesson') ? 'explore' : params.get('lab') ? 'engineer' : params.get('scenario') ? 'simulate' : 'intro';

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  progress: 0,
  carReady: false,
  mode: initialMode,
  system: params.get('system'),
  part: params.get('part'),
  lesson: params.get('lesson'),
  lab: params.get('lab'),
  scenario: params.get('scenario'),
  sound: false,
  captions: true,
  legend: false,
  reducedMotion: typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  info: false,
  sheet: true,
  contextLost: false,
  director: 'idle',
  set: (p) => set(p),
  go: (p) => {
    const cur = get();
    const next: Partial<AppState> = { ...p };
    if (p.mode && p.mode !== cur.mode) {
      // leaving a mode clears what belonged to it
      if (p.mode !== 'explore') Object.assign(next, { system: p.system ?? null, part: p.part ?? null });
      if (p.mode !== 'engineer') next.lab = p.lab ?? null;
      if (p.mode !== 'simulate') next.scenario = p.scenario ?? null;
      next.lesson = p.lesson ?? null;
    }
    set(next);
  },
}));

/** Keep the address in step with the place. */
export function syncAddress() {
  const write = (s: AppState) => {
    const q = new URLSearchParams(window.location.search);
    for (const k of ['mode', 'system', 'part', 'lesson', 'lab', 'scenario', 't']) q.delete(k);
    if (s.mode !== 'intro') q.set('mode', s.mode);
    if (s.mode === 'explore' && s.system) q.set('system', s.system);
    if (s.mode === 'explore' && s.part) q.set('part', s.part);
    if (s.mode === 'explore' && s.lesson) q.set('lesson', s.lesson);
    if (s.mode === 'engineer' && s.lab) q.set('lab', s.lab);
    if (s.mode === 'simulate' && s.scenario) q.set('scenario', s.scenario);
    const qs = q.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(null, '', url);
  };
  useApp.subscribe((s, prev) => {
    if (s.mode !== prev.mode || s.system !== prev.system || s.part !== prev.part || s.lesson !== prev.lesson || s.lab !== prev.lab || s.scenario !== prev.scenario) write(s);
  });
}

export interface Readouts {
  rpm: number;
  kmh: number;
  gear: string;
  selector: string;
  throttle: number;
  brakeBar: number;
  torque: number;
  wheelTorque: number;
  coolantC: number;
  oilBar: number;
  oilC: number;
  volts: number;
  batteryAmps: number;
  alternatorAmps: number;
  soc: number;
  fuelGs: number;
  airGs: number;
  lambda: number;
  fuelTrim: number;
  thermostat: number;
  fanOn: boolean;
  lockup: number;
  engine: string;
  ax: number;
  ay: number;
  pitchDeg: number;
  rollDeg: number;
  yawRate: number;
  slip: number[];
  fz: number[];
  rotorC: number[];
  abs: string[];
  absCycles: number;
  stopDistance: number;
  heave: number;
  steerDeg: number;
  roadWheelDeg: number;
  /** Per-cylinder stroke names and pressure (bar), for the engine lessons. */
  strokes: string[];
  pressures: number[];
  burns: number[];
  phases: number[];
  warnings: { engine: boolean; oil: boolean; battery: boolean; temp: boolean; abs: boolean; brake: boolean };
  misfireCount: number;
  elements: string[];
  applying: string | null;
  releasing: string | null;
  statorLocked: boolean;
  starterAmps: number;
  turbineRpm: number;
  /** Each wheel's speed as road speed, km/h, and its travel from rest, mm. */
  wheelKmh: number[];
  wheelTravelMm: number[];
  t: number;
}

export const useReadouts = create<Readouts>(() => ({
  rpm: 0,
  kmh: 0,
  gear: 'P',
  selector: 'P',
  throttle: 0,
  brakeBar: 0,
  torque: 0,
  wheelTorque: 0,
  coolantC: 25,
  oilBar: 0,
  oilC: 25,
  volts: 12.6,
  batteryAmps: 0,
  alternatorAmps: 0,
  soc: 0.9,
  fuelGs: 0,
  airGs: 0,
  lambda: 1,
  fuelTrim: 0,
  thermostat: 0,
  fanOn: false,
  lockup: 0,
  engine: 'off',
  ax: 0,
  ay: 0,
  pitchDeg: 0,
  rollDeg: 0,
  yawRate: 0,
  slip: [0, 0, 0, 0],
  fz: [0, 0, 0, 0],
  rotorC: [25, 25, 25, 25],
  abs: ['off', 'off', 'off', 'off'],
  absCycles: 0,
  stopDistance: 0,
  heave: 0,
  steerDeg: 0,
  roadWheelDeg: 0,
  strokes: ['', '', '', ''],
  pressures: [1, 1, 1, 1],
  burns: [0, 0, 0, 0],
  phases: [0, 0, 0, 0],
  warnings: { engine: false, oil: false, battery: false, temp: false, abs: false, brake: false },
  misfireCount: 0,
  elements: [],
  applying: null,
  releasing: null,
  statorLocked: true,
  starterAmps: 0,
  turbineRpm: 0,
  wheelKmh: [0, 0, 0, 0],
  wheelTravelMm: [0, 0, 0, 0],
  t: 0,
}));

export interface PlayerState {
  /** The sequence playing (a hero lesson or the film), or null. */
  id: string | null;
  title: string;
  t: number;
  duration: number;
  playing: boolean;
  beat: number;
  beats: { title: string; text: string; start: number; chapter?: string; readouts?: string[]; timeScale: number }[];
  caption: string;
  ended: boolean;
}

export const usePlayer = create<PlayerState>(() => ({ id: null, title: '', t: 0, duration: 0, playing: false, beat: -1, beats: [], caption: '', ended: false }));
