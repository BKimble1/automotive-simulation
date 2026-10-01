/**
 * Engineer: eight labs. Each asks one engineering question, lets the visitor change one or two
 * things, runs the car's model to answer it, and says what to notice. A run is computed off
 * screen (the model is deterministic and runs far faster than real time, so the chart and the
 * numbers appear at once) and the same program plays on the car in the scene. Earlier runs stay
 * on the chart, faint, for comparison.
 */
import { Car, NO_FAULTS, presetCruise, presetIdle, type CarState } from '../sim/car';
import { converterTorqueRatio } from '../sim/drivetrain';
import { fullLoadTorque } from '../sim/engine';
import { simulate, type RunSpec, type Sample } from '../sim/run';
import { BODY, GEARBOX, MASS, SUSPENSION, TIRE, units } from '../spec/vehicle';
import { brakeAt, cruise, holdSpeed, laneSteer, type Drive } from './drivers';

export type LabValues = Record<string, number | boolean | string>;

export interface LabControl {
  id: string;
  label: string;
  kind: 'range' | 'toggle' | 'choice';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  value: number | boolean | string;
  options?: { value: string; label: string }[];
  format?: (v: number) => string;
}

/** A lab's run: a complete run specification (sim/run.ts) less its id, which the lab gives. */
export type LabRun = Omit<RunSpec, 'id' | 'duration'> & { drive: Drive; duration: number };

export type { Sample };

export interface Lab {
  id: string;
  title: string;
  question: string;
  view: string;
  controls: LabControl[];
  run: (v: LabValues) => LabRun;
  /** What to record, every `every` simulated seconds. */
  sample: (s: CarState, t: number, car: Car) => Sample;
  every?: number;
  chart: { x: string; xLabel: string; yLabel: string; series: { key: string; label: string; color: string }[]; reference?: (x: number) => number; referenceLabel?: string; xMax?: number };
  results: (samples: Sample[], v: LabValues) => { label: string; value: string }[];
  notice: string;
}

const kmh = (s: CarState) => units.msToKmh(s.u);
const rpm = (s: CarState) => units.radToRpm(s.omegaE);
const f1 = (v: number) => v.toFixed(1);
const f0 = (v: number) => Math.round(v).toLocaleString('en-GB');
const GRIP = [
  { value: 'dry', label: 'Dry asphalt' },
  { value: 'wet', label: 'Wet' },
  { value: 'snow', label: 'Packed snow' },
];
const MU: Record<string, number> = { dry: TIRE.muDry, wet: 0.55, snow: 0.25 };

/** Full-throttle standing start (brake released at once), lane kept. */
const launch =
  (throttle = 1): Drive =>
  (_t, inp, s) => {
    inp.ignition = true;
    inp.selector = 'D';
    inp.brakeN = 0;
    inp.throttle = throttle;
    inp.steer = laneSteer(s, { R: 0, curveX: 0 });
  };

/** The first time a sample's key passes a value (linear between samples), or NaN. */
function when(samples: Sample[], key: string, value: number, x = 't'): number {
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a[key] < value && b[key] >= value) return a[x] + ((value - a[key]) / (b[key] - a[key])) * (b[x] - a[x]);
  }
  return NaN;
}
/** A time (or any quantity) that may not have been reached in the run. */
const reached = (v: number, unit: string, digits = 1) => (Number.isFinite(v) ? `${v.toFixed(digits)} ${unit}` : 'not reached in this run');
const max = (samples: Sample[], key: string) => samples.reduce((m, s) => Math.max(m, s[key]), -Infinity);
const min = (samples: Sample[], key: string) => samples.reduce((m, s) => Math.min(m, s[key]), Infinity);

export const LABS: Lab[] = [
  {
    id: 'gearing',
    title: 'Gearing',
    question: 'What does the final-drive ratio trade: acceleration against engine speed at cruise?',
    view: 'torque-path',
    controls: [{ id: 'fd', label: 'Final-drive ratio', kind: 'range', min: 2.6, max: 4.1, step: 0.05, value: GEARBOX.finalDrive, format: (v) => `${v.toFixed(2)} : 1` }],
    run: (v) => ({ start: presetIdle, drive: launch(1), params: { finalDrive: v.fd as number }, duration: 14, timeScale: 1 }),
    sample: (s, t) => ({ t, kmh: kmh(s), rpm: rpm(s), gear: s.gear }),
    every: 0.05,
    chart: { x: 't', xLabel: 'Time, s', yLabel: 'Speed, km/h', series: [{ key: 'kmh', label: 'Speed', color: '#E69F00' }] },
    results: (sm, v) => {
      const fd = v.fd as number;
      const cruiseRpm = (units.kmhToMs(120) / TIRE.rollingRadius) * fd * GEARBOX.ratios[7] * (60 / (2 * Math.PI));
      return [
        { label: '0–100 km/h', value: reached(when(sm, 'kmh', 100), 's') },
        { label: 'Speed after 14 s', value: `${f0(sm[sm.length - 1].kmh)} km/h` },
        { label: 'Engine at 120 km/h in 8th', value: `${f0(cruiseRpm)} rpm` },
      ];
    },
    notice: 'A higher final-drive ratio multiplies the torque more at the wheels, so the car accelerates harder, but every gear is shorter: the engine turns faster at a given speed, which costs fuel and adds noise at motorway speeds. A lower ratio does the opposite.',
  },
  {
    id: 'engine',
    title: 'Torque and power',
    question: 'How do torque and power change with engine speed, and how much does the throttle decide?',
    view: 'firing-order',
    controls: [{ id: 'th', label: 'Throttle', kind: 'range', min: 0.2, max: 1, step: 0.05, value: 1, format: (v) => `${Math.round(v * 100)} %` }],
    // a rolling-road sweep: 3rd gear held, the converter locked, from 1,000 rpm to the limiter
    run: (v) => ({
      start: () => {
        const s = presetCruise(18, 3);
        s.lockup = 1;
        s.omegaE = s.omegaT;
        return s;
      },
      drive: (_t, inp, s) => {
        inp.ignition = true;
        inp.selector = 'D';
        inp.manualGear = 3;
        inp.lockup = true;
        inp.throttle = v.th as number;
        inp.steer = laneSteer(s, { R: 0, curveX: 0 });
      },
      duration: 16,
      until: (s) => rpm(s) > 6400,
      timeScale: 1,
    }),
    sample: (s, t) => ({ t, rpm: rpm(s), torque: s.engineTorque, power: (s.engineTorque * s.omegaE) / 1000 }),
    every: 0.02,
    chart: { x: 'rpm', xLabel: 'Engine speed, rpm', yLabel: 'Torque N·m · Power kW', series: [{ key: 'torque', label: 'Torque', color: '#E69F00' }, { key: 'power', label: 'Power', color: '#56B4E9' }], reference: fullLoadTorque, referenceLabel: 'Full-load torque', xMax: 6500 },
    results: (sm) => {
      const lo = min(sm, 'rpm');
      const hi = max(sm, 'rpm');
      const pk = sm.reduce((a, b) => (b.power > a.power ? b : a), sm[0]);
      const tq = sm.reduce((a, b) => (b.torque > a.torque ? b : a), sm[0]);
      // a peak at the very end of the sweep is only the highest value reached, not a peak
      const atEnd = (x: Sample) => x.rpm > hi - 60 && hi < 6300;
      return [
        { label: 'Range swept', value: `${f0(lo)}–${f0(hi)} rpm` },
        { label: 'Peak torque', value: atEnd(tq) ? `still rising at ${f0(hi)} rpm` : `${f0(tq.torque)} N·m at ${f0(tq.rpm)} rpm` },
        { label: 'Peak power', value: atEnd(pk) ? `still rising: ${f0(pk.power)} kW at ${f0(hi)} rpm` : `${f0(pk.power)} kW at ${f0(pk.rpm)} rpm` },
      ];
    },
    notice: 'Torque is the twisting force of each firing; power is torque times speed. Torque peaks in the middle of the range, where the engine breathes best, but power keeps climbing as long as speed rises faster than torque falls. Part throttle limits the air, and with it every number. (A rolling-road sweep: third gear held and the converter locked, so the engine speed rises with the car.)',
  },
  {
    id: 'braking',
    title: 'Stopping distance',
    question: 'How do speed, grip and ABS change how far the car needs to stop?',
    view: 'braking-side',
    controls: [
      { id: 'kmh', label: 'Speed', kind: 'range', min: 30, max: 130, step: 10, value: 80, unit: 'km/h' },
      { id: 'grip', label: 'Road', kind: 'choice', value: 'wet', options: GRIP },
      { id: 'abs', label: 'ABS', kind: 'toggle', value: true },
    ],
    run: (v) => ({
      start: () => presetCruise(v.kmh as number),
      drive: brakeAt(v.kmh as number, 0.5, 520),
      road: { mu: MU[v.grip as string] },
      faults: { ...NO_FAULTS, absDisabled: !v.abs },
      duration: 14,
      until: (s, t) => t > 0.8 && s.u < 0.05,
      timeScale: 1,
    }),
    sample: (s, t) => ({ t, kmh: kmh(s), d: s.stopDistance, bar: s.linePa / 1e5 }),
    every: 0.02,
    chart: { x: 'd', xLabel: 'Distance since braking, m', yLabel: 'Speed, km/h', series: [{ key: 'kmh', label: 'Speed', color: '#CC79A7' }] },
    results: (sm, v) => {
      const d = max(sm, 'd');
      const v0 = units.kmhToMs(v.kmh as number);
      return [
        { label: 'Stopping distance', value: `${f1(d)} m` },
        { label: 'Average deceleration', value: `${((v0 * v0) / (2 * Math.max(1, d)) / 9.81).toFixed(2)} g` },
        { label: 'Peak line pressure', value: `${f0(max(sm, 'bar'))} bar` },
      ];
    },
    notice: 'Braking distance grows with the square of speed: from twice the speed the car needs four times the distance. It is the grip between tyre and road that stops the car, so a wet or icy road stretches every stop. ABS keeps the tyres just short of locking, where they grip best and can still steer.',
  },
  {
    id: 'suspension',
    title: 'Springs and dampers',
    question: 'How do spring stiffness and damping shape the ride over a bump?',
    view: 'suspension-front',
    controls: [
      { id: 'k', label: 'Spring stiffness', kind: 'range', min: 0.5, max: 1.8, step: 0.1, value: 1, format: (v) => `×${v.toFixed(1)}` },
      { id: 'c', label: 'Damping', kind: 'range', min: 0.15, max: 2.2, step: 0.05, value: 1, format: (v) => `×${v.toFixed(2)}` },
    ],
    run: (v) => {
      return {
        start: () => presetCruise(30),
        drive: cruise(30),
        road: { mu: TIRE.muDry, bumpAt: 9 },
        params: { wheelRateFront: SUSPENSION.wheelRateFront * (v.k as number), wheelRateRear: SUSPENSION.wheelRateRear * (v.k as number), dampingFront: SUSPENSION.dampingFront * (v.c as number), dampingRear: SUSPENSION.dampingRear * (v.c as number) },
        duration: 3.5,
        timeScale: 0.25,
      };
    },
    sample: (s, t) => ({ t, wheel: s.wheelZ[0] * 1000, body: s.heave * 1000 + (BODY.xFront * s.pitch) * 1000 }),
    every: 0.005,
    chart: { x: 't', xLabel: 'Time, s', yLabel: 'Vertical movement, mm', series: [{ key: 'wheel', label: 'Front wheel', color: '#E69F00' }, { key: 'body', label: 'Body above it', color: '#56B4E9' }] },
    results: (sm) => {
      const peak = max(sm, 'body');
      const after = sm.filter((s) => s.t > 1.6);
      return [
        { label: 'Body moved up to', value: `${f0(peak)} mm` },
        { label: 'Wheel travel', value: `${f0(max(sm, 'wheel'))} mm` },
        { label: 'Still moving after 0.5 s', value: `${f1(Math.max(...after.map((s) => Math.abs(s.body))))} mm` },
      ];
    },
    notice: 'A soft spring lets the wheel rise without pushing the body much, but the body then floats and bounces; a stiff one passes more of the bump through. Too little damping and the wheel and body keep bouncing; too much and the damper itself kicks the body. Engineers tune the pair together.',
  },
  {
    id: 'weight',
    title: 'Weight transfer',
    question: 'Why does the nose dip under braking, and how much load moves to the front tyres?',
    view: 'braking-side',
    controls: [
      { id: 'm', label: 'Mass', kind: 'range', min: 1300, max: 2100, step: 50, value: MASS.total, unit: 'kg' },
      { id: 'h', label: 'Centre of gravity height', kind: 'range', min: 0.4, max: 0.75, step: 0.01, value: MASS.cgHeight, format: (v) => `${Math.round(v * 1000)} mm` },
    ],
    run: (v) => ({
      start: () => presetCruise(80),
      drive: brakeAt(80, 0.5, 520),
      params: { mass: v.m as number, cgHeight: v.h as number },
      duration: 5,
      until: (s, t) => t > 0.8 && s.u < 0.05,
      timeScale: 1,
    }),
    sample: (s, t) => ({ t, front: (s.fz[0] + s.fz[1]) / 1000, rear: (s.fz[2] + s.fz[3]) / 1000, pitch: (s.pitch * 180) / Math.PI }),
    every: 0.02,
    chart: { x: 't', xLabel: 'Time, s', yLabel: 'Axle load, kN', series: [{ key: 'front', label: 'Front axle', color: '#E69F00' }, { key: 'rear', label: 'Rear axle', color: '#56B4E9' }] },
    results: (sm, v) => {
      const peakFront = max(sm, 'front');
      const total = ((v.m as number) * 9.81) / 1000;
      return [
        { label: 'Front axle at rest', value: `${f1(sm[0].front)} kN` },
        { label: 'Front axle braking', value: `${f1(peakFront)} kN (${f0((peakFront / total) * 100)} %)` },
        { label: 'Nose-down pitch', value: `${Math.abs(min(sm, 'pitch')).toFixed(2)}°` },
      ];
    },
    notice: 'Braking slows the tyres at road level while the car’s mass, higher up, carries on: the load shifts forward by mass × deceleration × centre-of-gravity height ÷ wheelbase. That is why front brakes are bigger, and why a tall or heavily loaded car needs more of its braking at the front.',
  },
  {
    id: 'cornering',
    title: 'Cornering grip',
    question: 'How fast can the car take a 12-metre corner before the tyres give up?',
    view: 'corner-top',
    controls: [
      { id: 'kmh', label: 'Speed', kind: 'range', min: 15, max: 50, step: 1, value: 30, unit: 'km/h' },
      { id: 'grip', label: 'Road', kind: 'choice', value: 'dry', options: GRIP },
    ],
    run: (v) => {
      const lane = { R: 12, curveX: 10 };
      return {
        start: () => presetCruise(v.kmh as number),
        drive: cruise(v.kmh as number, lane, 0.16),
        road: { mu: MU[v.grip as string], curve: 1 / 12, curveX: 10 },
        // about half way round the bend
        duration: 4.6,
        timeScale: 1,
      };
    },
    sample: (s, t) => {
      // how far outside the lane's centre line (in the bend only)
      const e = s.X > 10 && s.heading < 2.5 ? Math.hypot(s.X - 10, s.Z + 12) - 12 : 0;
      return { t, lat: Math.abs(s.u * s.r) / 9.81, err: e, use: Math.max(...s.gripUse) };
    },
    every: 0.02,
    chart: { x: 't', xLabel: 'Time, s', yLabel: 'Sideways acceleration, g', series: [{ key: 'lat', label: 'Lateral acceleration', color: '#E69F00' }, { key: 'use', label: 'Grip used (front)', color: '#CC79A7' }] },
    results: (sm, v) => {
      const vms = units.kmhToMs(v.kmh as number);
      const need = (vms * vms) / 12 / 9.81;
      const drift = max(sm, 'err');
      return [
        { label: 'Needed for this corner', value: `${need.toFixed(2)} g` },
        { label: 'Peak sideways acceleration', value: `${max(sm, 'lat').toFixed(2)} g` },
        { label: 'Line', value: drift > 1 ? `ran wide by ${f1(drift)} m` : 'held' },
      ];
    },
    notice: 'To follow a curve the tyres must push the car sideways by speed² ÷ radius. Their limit is about the road’s grip times g: roughly 0.9 g on dry asphalt, half that in the wet, a quarter on snow. Past it, the front tyres slide and the car runs wide however much the wheel is turned: understeer.',
  },
  {
    id: 'converter',
    title: 'Torque converter',
    question: 'When does the converter multiply torque, and when does it simply couple?',
    view: 'converter',
    controls: [{ id: 'th', label: 'Throttle when pulling away', kind: 'range', min: 0.2, max: 1, step: 0.05, value: 0.6, format: (v) => `${Math.round(v * 100)} %` }],
    run: (v) => ({
      start: presetIdle,
      drive: (t, inp, s) => {
        inp.ignition = true;
        inp.selector = 'D';
        inp.brakeN = t < 0.3 ? 150 : 0;
        inp.throttle = t < 0.3 ? 0 : (v.th as number);
        inp.steer = laneSteer(s, { R: 0, curveX: 0 });
      },
      duration: 6,
      until: (s) => s.lockup > 0.5,
      timeScale: 0.5,
    }),
    sample: (s, t) => {
      const sr = s.omegaE > 1 ? Math.max(0, s.omegaT / s.omegaE) : 0;
      return { t, sr, tr: converterTorqueRatio(sr), rpm: rpm(s) };
    },
    every: 0.02,
    chart: { x: 'sr', xLabel: 'Turbine speed ÷ engine speed', yLabel: 'Torque multiplication', series: [{ key: 'tr', label: 'Torque ratio', color: '#E69F00' }], reference: converterTorqueRatio, referenceLabel: 'Converter curve', xMax: 1 },
    results: (sm) => [
      { label: 'Most multiplication', value: `×${max(sm, 'tr').toFixed(2)}` },
      { label: 'Engine speed pulling away', value: `${f0(max(sm.filter((s) => s.t < 1.5), 'rpm'))} rpm` },
      { label: 'Coupling reached after', value: reached(when(sm, 'sr', 0.85), 's') },
    ],
    notice: 'With the car still, the turbine stands while the impeller spins: the stator redirects the fluid and the converter multiplies the engine’s torque about two times. As the turbine catches up the multiplication fades to one at the coupling point; then the lock-up clutch joins them so nothing is lost in the fluid.',
  },
  {
    id: 'electrical',
    title: 'Electrical balance',
    question: 'Can the alternator keep up with the car’s electrical load at idle?',
    view: 'charging',
    controls: [
      { id: 'amps', label: 'Electrical load', kind: 'range', min: 10, max: 140, step: 5, value: 60, unit: 'A' },
      { id: 'rpm', label: 'Engine', kind: 'choice', value: 'idle', options: [{ value: 'idle', label: 'Idling' }, { value: 'cruise', label: 'Cruising (2,000 rpm)' }] },
    ],
    run: (v) => ({
      start: v.rpm === 'idle' ? presetIdle : () => presetCruise(70, 6),
      drive: (_t, inp, s) => {
        inp.ignition = true;
        inp.accessoriesAmps = v.amps as number;
        if (v.rpm === 'idle') inp.selector = 'P';
        else {
          inp.selector = 'D';
          inp.throttle = holdSpeed(s, 70);
          inp.steer = laneSteer(s, { R: 0, curveX: 0 });
        }
      },
      duration: 20,
      timeScale: 1,
    }),
    sample: (s, t) => ({ t, alt: s.alternatorAmps, batt: -s.batteryAmps, volts: s.volts }),
    every: 0.1,
    chart: { x: 't', xLabel: 'Time, s', yLabel: 'Current, A', series: [{ key: 'alt', label: 'Alternator output', color: '#EAF1FF' }, { key: 'batt', label: 'Into the battery', color: '#2BB592' }] },
    results: (sm) => {
      const last = sm[sm.length - 1];
      return [
        { label: 'Alternator', value: `${f0(last.alt)} A` },
        { label: 'Battery', value: last.batt >= 0 ? `charging ${f0(last.batt)} A` : `discharging ${f0(-last.batt)} A` },
        { label: 'System voltage', value: `${last.volts.toFixed(1)} V` },
      ];
    },
    notice: 'The alternator turns at about three times engine speed, and its output rises with speed. At idle a heavy load can exceed what it gives: the battery makes up the difference and slowly discharges, and the voltage sags. That is why the engine control unit raises the idle speed a little when the electrical load is high.',
  },
];

export const LAB_BY_ID = Object.fromEntries(LABS.map((l) => [l.id, l]));

export function defaults(lab: Lab): LabValues {
  return Object.fromEntries(lab.controls.map((c) => [c.id, c.value]));
}

/** A lab's complete run for these values (the same spec drives the chart and the live car). */
export function labRun(lab: Lab, v: LabValues): RunSpec {
  return { id: `lab:${lab.id}`, ...lab.run(v) };
}

/** Run a lab off screen: deterministic samples, from a fresh car (nothing inherited). */
export function simulateLab(lab: Lab, v: LabValues, car?: Car): Sample[] {
  return simulate(labRun(lab, v), lab.sample, lab.every ?? 0.05, car);
}
