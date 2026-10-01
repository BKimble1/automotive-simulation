/**
 * Live readouts beside a lesson's caption: the few numbers that prove what the picture shows
 * (engine speed while it starts, line pressure while it brakes). Values come from the model,
 * ten times a second; each chip has a plain label and its unit.
 */
import { useReadouts, type Readouts as R } from '../state/store';

const n0 = (v: number) => Math.round(v).toLocaleString('en-GB');
const n1 = (v: number) => v.toFixed(1);

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
  accel: { label: 'Acceleration', value: (r) => r.ax.toFixed(2), unit: 'g' },
  firing: { label: 'Firing', value: firing },
  wheelSpeeds: { label: 'Rear wheels L / R', value: (r) => `${n1(r.wheelKmh[2])} / ${n1(r.wheelKmh[3])}`, unit: 'km/h' },
  wheelTravel: { label: 'Front wheel travel', value: (r) => `${r.wheelTravelMm[0] >= 0 ? '+' : ''}${n0(r.wheelTravelMm[0])}`, unit: 'mm' },
  pitch: { label: 'Body pitch', value: (r) => r.pitchDeg.toFixed(2), unit: '°' },
  brakeBar: { label: 'Brake pressure', value: (r) => n0(r.brakeBar), unit: 'bar' },
  discC: { label: 'Front disc', value: (r) => n0(r.rotorC[0]), unit: '°C' },
  stopDistance: { label: 'Stopping distance', value: (r) => n1(r.stopDistance), unit: 'm' },
  abs: { label: 'ABS', value: (r) => (r.abs.some((a) => a !== 'off') ? 'working' : r.warnings.abs ? 'off' : 'ready') },
  coolantC: { label: 'Coolant', value: (r) => n0(r.coolantC), unit: '°C' },
  thermostat: { label: 'Thermostat', value: (r) => `${n0(r.thermostat * 100)}`, unit: '% open' },
  fan: { label: 'Fans', value: (r) => (r.fanOn ? 'on' : 'off') },
  oilBar: { label: 'Oil pressure', value: (r) => n1(r.oilBar), unit: 'bar' },
  oilC: { label: 'Oil', value: (r) => n0(r.oilC), unit: '°C' },
};

export function ReadoutChips({ ids, timeScale }: { ids: string[]; timeScale: number }) {
  const r = useReadouts();
  const pace = timeScale < 0.9 ? `Slow motion ×${timeScale < 0.1 ? `1/${Math.round(1 / timeScale)}` : timeScale.toFixed(2)}` : timeScale > 1.1 ? `Sped up ×${n0(timeScale)}` : null;
  if (!ids.length && !pace) return null;
  return (
    <div className="readouts" role="group" aria-label="Live values">
      {pace && <span className="chip chip--pace">{pace}</span>}
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
