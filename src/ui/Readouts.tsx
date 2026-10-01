/**
 * Live readouts beside a lesson's caption: the few numbers that prove what the picture shows
 * (engine speed while it starts, line pressure while it brakes). Values come from the model,
 * ten times a second; each chip has a plain label and its unit.
 */
import { useReadouts, useRun, type Readouts as R } from '../state/store';
import { SHAFT_KEY } from '../sim/geartrain';

// rounding never shows a negative zero (−0 reads as a value that is not there)
const n0 = (v: number) => (Math.round(v) || 0).toLocaleString('en-GB');
const n1 = (v: number) => (Math.abs(v) < 0.05 ? 0 : v).toFixed(1);
const n2 = (v: number) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);
/** A signed value: + for up or in, − for down or out, nothing for zero. */
const signed0 = (v: number) => {
  const r = Math.round(v) || 0;
  return `${r > 0 ? '+' : ''}${r.toLocaleString('en-GB')}`;
};

/** Firing order position: the cylinder on its power stroke now. */
function firing(r: R): string {
  const i = r.strokes.indexOf('power');
  return i >= 0 ? `cylinder ${i + 1}` : '–';
}

export const READOUTS: Record<string, { label: string; value: (r: R) => string; unit?: string }> = {
  rpm: { label: 'Engine', value: (r) => n0(r.rpm), unit: 'rpm' },
  turbineRpm: { label: 'Turbine', value: (r) => n0(r.turbineRpm), unit: 'rpm' },
  kmh: { label: 'Speed', value: (r) => n0(r.kmh), unit: 'km/h' },
  gear: { label: 'Gear', value: (r) => r.gear },
  elements: { label: 'Applied', value: (r) => [...r.elements, ...(r.applying ? [`${r.applying}↑`] : []), ...(r.releasing ? [`${r.releasing}↓`] : [])].join(' ') || '–' },
  volts: { label: 'Battery', value: (r) => n1(r.volts), unit: 'V' },
  starterAmps: { label: 'Starter', value: (r) => n0(r.starterAmps), unit: 'A' },
  alternatorAmps: { label: 'Alternator', value: (r) => n0(r.alternatorAmps), unit: 'A' },
  batteryAmps: { label: 'Into battery', value: (r) => n0(-r.batteryAmps), unit: 'A' },
  wheelTorque: { label: 'At the wheels', value: (r) => n0(r.wheelTorque), unit: 'N·m' },
  accel: { label: 'Acceleration', value: (r) => n2(r.ax), unit: 'g' },
  firing: { label: 'Firing', value: firing },
  wheelSpeeds: { label: 'Rear wheels L / R', value: (r) => `${n1(r.wheelKmh[2])} / ${n1(r.wheelKmh[3])}`, unit: 'km/h' },
  wheelTravel: { label: 'Front wheel travel', value: (r) => signed0(r.wheelTravelMm[0]), unit: 'mm' },
  pitch: { label: 'Body pitch', value: (r) => n2(r.pitchDeg), unit: '°' },
  brakeBar: { label: 'Brake pressure', value: (r) => n0(r.brakeBar), unit: 'bar' },
  discC: { label: 'Front disc', value: (r) => n0(r.rotorC[0]), unit: '°C' },
  stopDistance: { label: 'Stopping distance', value: (r) => n1(r.stopDistance), unit: 'm' },
  abs: { label: 'ABS', value: (r) => (r.abs.some((a) => a !== 'off') ? 'working' : r.warnings.abs ? 'off' : 'ready') },
  coolantC: { label: 'Coolant', value: (r) => n0(r.coolantC), unit: '°C' },
  thermostat: { label: 'Thermostat', value: (r) => `${n0(r.thermostat * 100)}`, unit: '% open' },
  fan: { label: 'Fans', value: (r) => (r.fanOn ? 'on' : 'off') },
  oilBar: { label: 'Oil pressure', value: (r) => n1(r.oilBar), unit: 'bar' },
  oilC: { label: 'Oil', value: (r) => n0(r.oilC), unit: '°C' },
  misfires: { label: 'Misfires counted', value: (r) => n0(r.misfireCount) },
  ratio: { label: 'Ratio', value: (r) => (Math.abs(r.shaftRpm[7]) > 30 ? `${(r.shaftRpm[0] / r.shaftRpm[7]).toFixed(2)} : 1` : '–') },
  slip: {
    label: 'Clutch slip',
    value: (r) => (r.applying ? `${r.applying} ${n0(Math.abs(r.slipRpm[r.applying as keyof R['slipRpm']]))} rpm` : 'none'),
  },
};

/**
 * The gearbox's eight shafts: their colour in the scene, their name and their speed now. A held
 * member reads "held" (its brake applied); members joined by an applied clutch turn together.
 */
export function GearKey() {
  const r = useReadouts();
  return (
    <ul className="gearkey" aria-label="The gearbox's eight shafts">
      {SHAFT_KEY.map((k, i) => {
        const rpm = r.shaftRpm[i] ?? 0;
        const held = k.held && r.elements.includes(k.held) && Math.abs(rpm) < 1;
        return (
          <li key={k.shaft}>
            <i style={{ borderColor: k.color }} aria-hidden="true" />
            <span className="gearkey__name">{k.label}</span>
            <span className="gearkey__v num">{held ? `held by ${k.held}` : `${n0(rpm)} rpm`}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** How a playback scale reads: slow motion as a fraction, sped-up time as a multiple, real time as nothing. */
export function paceLabel(timeScale: number): string | null {
  return timeScale < 0.9 ? `Slow motion ×${timeScale < 0.1 ? `1/${Math.round(1 / timeScale)}` : timeScale.toFixed(2)}` : timeScale > 1.1 ? `Sped up ×${n0(timeScale)}` : null;
}

/** The live run's time scale, when it is not real time (a thermal case runs sped up). */
export function RunPace() {
  const run = useRun();
  const pace = run.status !== 'none' ? paceLabel(run.scale) : null;
  if (!pace) return null;
  return (
    <p className="run-pace">
      <span className="chip chip--pace" title={run.scale > 1 ? 'Model time runs faster than real time here, so slow changes such as warming up can be seen' : 'Model time runs slower than real time here, so fast motion can be followed'}>
        {pace}
      </span>
    </p>
  );
}

export function ReadoutChips({ ids, timeScale }: { ids: string[]; timeScale: number }) {
  const r = useReadouts();
  const pace = paceLabel(timeScale);
  if (!ids.length && !pace) return null;
  return (
    <div className="readouts" role="group" aria-label="Live values">
      {pace && <span className="chip chip--pace">{pace}</span>}
      {ids.includes('gearKey') && <GearKey />}
      {ids.map((id) => {
        const d = READOUTS[id];
        if (!d) return null;
        return (
          <span className="chip" key={id}>
            <span className="chip__label">{d.label}</span>
            <span className="chip__value num">
              {d.value(r)}
              {d.unit && <small> {d.unit}</small>}
            </span>
          </span>
        );
      })}
    </div>
  );
}
