/**
 * The visual language: what each kind of flow looks like. Colours come from a palette that
 * stays distinguishable with the common colour-vision deficiencies (Okabe–Ito, adjusted for a
 * dark background), and every kind also has its own shape and motion, so colour is never the
 * only cue. The legend in the interface is drawn from this table.
 */
export type FlowKind = 'torque' | 'air' | 'fuel' | 'exhaust' | 'oil' | 'coolant' | 'hydraulic' | 'power' | 'signal' | 'heat' | 'refrigerant';
export type FlowStyle = 'chevron' | 'streak' | 'droplet' | 'puff' | 'dash' | 'band' | 'packet' | 'pulse' | 'glow';

export interface Language {
  label: string;
  color: string;
  style: FlowStyle;
  /** Particle size, m. */
  size: number;
  /** Particles per metre of path. */
  density: number;
  /** How the shape is described in the legend (the cue besides colour). */
  pattern: string;
}

export const LANGUAGE: Record<FlowKind, Language> = {
  torque: { label: 'Torque and force', color: '#E69F00', style: 'chevron', size: 0.03, density: 9, pattern: 'arrowheads along the shafts' },
  air: { label: 'Air', color: '#56B4E9', style: 'streak', size: 0.012, density: 46, pattern: 'fine fast streaks' },
  fuel: { label: 'Fuel', color: '#F0E442', style: 'droplet', size: 0.007, density: 40, pattern: 'small droplets' },
  exhaust: { label: 'Exhaust gas', color: '#A7A39C', style: 'puff', size: 0.022, density: 22, pattern: 'soft, larger puffs' },
  oil: { label: 'Oil', color: '#D08A3A', style: 'dash', size: 0.01, density: 34, pattern: 'slow, thick dashes' },
  coolant: { label: 'Coolant', color: '#2BB592', style: 'dash', size: 0.008, density: 40, pattern: 'medium dashes' },
  hydraulic: { label: 'Brake pressure', color: '#CC79A7', style: 'band', size: 0.006, density: 26, pattern: 'pressure fronts along the line' },
  power: { label: 'Electrical power', color: '#EAF1FF', style: 'packet', size: 0.008, density: 26, pattern: 'square packets on the wires' },
  signal: { label: 'Control signals', color: '#8B7DFF', style: 'pulse', size: 0.006, density: 30, pattern: 'thin dotted pulses' },
  heat: { label: 'Heat', color: '#D55E00', style: 'glow', size: 0, density: 0, pattern: 'a warm tint on hot surfaces' },
  refrigerant: { label: 'Refrigerant', color: '#9AD0F5', style: 'droplet', size: 0.006, density: 30, pattern: 'pale droplets (air conditioning)' },
};

export const LEGEND_ORDER: FlowKind[] = ['torque', 'air', 'fuel', 'exhaust', 'oil', 'coolant', 'hydraulic', 'power', 'signal', 'heat'];
