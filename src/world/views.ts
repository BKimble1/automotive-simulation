/**
 * Views: what the visitor sees at a place in the experience. A view is data — one camera shot,
 * the scene channels' targets (what is ghosted, opened, cut, taken apart, which flows show) and
 * the assemblies it is about (the rest may dim). The animation director moves to a view from
 * whatever is displayed; nothing in a view knows where it is coming from.
 *
 * Camera angles: az is measured round the car from its right side (+z, az 0) toward its front
 * (+x, az π/2); the left side is az π, the rear −π/2. el is the elevation (rad).
 */
import { Vector3 } from 'three';
import type { Shot } from '../scene/camera/director';
import { CRANK_Y, DECK_Y, FLEX_X, XC } from '../scene/car/engineGeo';
import { DIFF_C, TRANS } from '../scene/car/drivetrainGeo';
import { BODY, WHEEL_Y } from '../spec/vehicle';

export interface View {
  id: string;
  shot: Shot;
  channels: Record<string, number>;
  /** Assemblies that stay lit while `dim` darkens the rest. */
  focus?: string[];
  /** May the visitor orbit here (free explore)? (The shot's orbit limits apply.) */
  free?: boolean;
  /** Asset groups that must be ready before the director moves here. */
  requires?: ('car' | 'detail')[];
}

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

export const PANELS_ALL = ['shell', 'hood', 'bumperFront', 'fenderL', 'fenderR', 'doorFL', 'doorFR', 'doorRL', 'doorRR', 'trunk', 'bumperRear'];
export const PANELS_FRONT = ['hood', 'bumperFront', 'fenderL', 'fenderR'];
export const PANELS_LEFT = ['doorFL', 'doorRL', 'fenderL'];

/** Body channels: ghost these panels by `amount`. */
export function bodyGhost(panels: string[], amount = 1): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of panels) out[`body:${p}`] = amount;
  return out;
}
const all = (amount = 1) => bodyGhost(PANELS_ALL, amount);

/** The engine's front drive and covers, faded out of the way of a cylinder cutaway. */
export const FRONT_DRIVE = ['accessory-belt', 'pulley-alternator', 'pulley-tensioner', 'pulley-idler', 'pulley-waterpump', 'pulley-compressor', 'alternator', 'water-pump', 'ac-compressor', 'harmonic-balancer', 'timing-cover', 'radiator', 'condenser', 'fan-shroud', 'cooling-fan-left', 'cooling-fan-right', 'fan-motor-left', 'fan-motor-right', 'radiator-hoses', 'air-filter-box', 'air-duct', 'maf-sensor', 'expansion-tank', 'battery', 'ecm', 'thermostat-housing', 'front-subframe', 'steering-rack', 'steering-gear-housing', 'eps-motor', 'steering-pinion', 'anti-roll-bar-front', 'structure-crash', 'vvt-solenoid', 'cam-sensor'];
const hideAll = (names: string[], v = 1) => Object.fromEntries(names.map((n) => [`hide:${n}`, v]));

const ENGINE_CASINGS = ['engine-block', 'cylinder-head', 'cam-cover', 'timing-cover', 'oil-pan', 'intake-manifold', 'exhaust-manifold', 'head-gasket'];
const ghostParts = (names: string[], v = 1) => Object.fromEntries(names.map((n) => [`ghost:${n}`, v]));

export const VIEWS: Record<string, View> = {
  // ─────────── the vehicle ───────────
  hero: {
    id: 'hero',
    shot: { id: 'hero', target: V(0.05, 0.62, 0), az: 2.32, el: 0.13, dist: 9.2, fov: 26, ox: -0.12, drift: 0.018, sway: 0.02, subject: { w: 5.2, h: 1.7 }, orbit: { az: null, el: [0.03, 0.7], dist: [0.7, 1.4] } },
    channels: {},
  },
  overview: {
    id: 'overview',
    shot: { id: 'overview', target: V(0.0, 0.6, 0), az: 2.25, el: 0.2, dist: 8.6, fov: 28, ox: 0.08, subject: { w: 5.0, h: 1.8 }, orbit: { az: null, el: [0.03, 1.15], dist: [0.55, 1.5] } },
    channels: {},
    free: true,
  },
  // the whole car opened up: every system visible in its place (the Explore starting picture)
  xray: {
    id: 'xray',
    shot: { id: 'xray', target: V(0.0, 0.55, 0), az: 2.35, el: 0.32, dist: 8.2, fov: 28, ox: 0.08, subject: { w: 5.0, h: 1.8 }, orbit: { az: null, el: [0.03, 1.15], dist: [0.55, 1.5] } },
    channels: { ...all(0.92) },
    free: true,
    requires: ['car'],
  },

  // ─────────── the ten systems ───────────
  'sys-power': {
    id: 'sys-power',
    shot: { id: 'sys-power', target: V(1.3, 0.58, 0), az: 2.15, el: 0.55, dist: 2.7, fov: 30, ox: 0.1, subject: { w: 1.4, h: 0.9 }, orbit: { az: [-0.9, 0.9], el: [0.1, 1.2], dist: [0.6, 1.6] } },
    channels: { ...bodyGhost(PANELS_FRONT, 0.9), ...bodyGhost(['shell'], 0.4), ...ghostParts(['cam-cover', 'intake-manifold', 'air-filter-box', 'air-duct'], 0.75), dim: 0.7, 'hl:engine': 0.6 },
    focus: ['engine', 'ignition', 'injection', 'lubrication', 'intake', 'transmission'],
    free: true,
    requires: ['car'],
  },
  'sys-air': {
    id: 'sys-air',
    shot: { id: 'sys-air', target: V(0.1, 0.5, 0.0), az: 2.45, el: 0.42, dist: 6.4, fov: 30, ox: 0.1, subject: { w: 4.6, h: 1.4 }, orbit: { az: null, el: [0.05, 1.15], dist: [0.6, 1.5] } },
    channels: { ...all(0.88), dim: 0.65, 'hl:intake': 0.5, 'hl:exhaust': 0.5, 'hl:fuel': 0.5, 'hl:injection': 0.5, 'hl:ignition': 0.5, 'flow:air': 1, 'flow:fuel': 1, 'flow:exhaust': 1 },
    focus: ['intake', 'exhaust', 'fuel', 'injection', 'ignition'],
    free: true,
    requires: ['car'],
  },
  'sys-cooling': {
    id: 'sys-cooling',
    shot: { id: 'sys-cooling', target: V(1.45, 0.55, 0), az: 2.05, el: 0.5, dist: 2.9, fov: 30, ox: 0.1, subject: { w: 1.6, h: 0.9 }, orbit: { az: [-0.9, 0.9], el: [0.1, 1.2], dist: [0.6, 1.6] } },
    channels: { ...bodyGhost(PANELS_FRONT, 0.9), ...bodyGhost(['shell'], 0.4), ...ghostParts(['engine-block', 'cylinder-head', 'cam-cover', 'intake-manifold', 'air-filter-box', 'air-duct', 'timing-cover'], 0.7), dim: 0.65, 'hl:cooling': 0.6, 'hl:lubrication': 0.6, 'flow:coolantEngine': 1, 'flow:coolantRadiator': 1, 'flow:coolantBypass': 1, 'flow:oilMain': 1, 'flow:oilHead': 1, 'flow:oilReturn': 1 },
    focus: ['cooling', 'lubrication'],
    free: true,
    requires: ['car'],
  },
  'sys-driveline': {
    id: 'sys-driveline',
    shot: { id: 'sys-driveline', target: V(-0.2, 0.36, 0), az: 2.6, el: 0.36, dist: 6.0, fov: 30, ox: 0.1, subject: { w: 4.4, h: 1.0 }, orbit: { az: null, el: [0.05, 1.2], dist: [0.6, 1.5] } },
    channels: { ...all(0.9), dim: 0.65, 'hl:transmission': 0.55, 'hl:driveline': 0.55, 'flow:torque': 1 },
    focus: ['transmission', 'driveline', 'engine', 'wheels'],
    free: true,
    requires: ['car'],
  },
  'sys-chassis': {
    id: 'sys-chassis',
    shot: { id: 'sys-chassis', target: V(1.3, 0.38, -0.5), az: 2.55, el: 0.3, dist: 2.6, fov: 30, ox: 0.1, subject: { w: 1.5, h: 0.8 }, orbit: { az: [-1.0, 1.0], el: [0.05, 1.2], dist: [0.6, 1.6] } },
    channels: { ...all(0.9), dim: 0.65, 'hl:suspension': 0.55, 'hl:steering': 0.55 },
    focus: ['suspension', 'steering', 'wheels', 'brakes'],
    free: true,
    requires: ['car'],
  },
  'sys-brakes': {
    id: 'sys-brakes',
    shot: { id: 'sys-brakes', target: V(1.38, 0.33, -0.72), az: 2.85, el: 0.2, dist: 1.3, fov: 30, ox: 0.1, subject: { w: 0.8, h: 0.75 }, orbit: { az: [-1.1, 1.1], el: [0.02, 1.2], dist: [0.6, 1.8] } },
    channels: { ...bodyGhost(['fenderL', 'doorFL', 'bumperFront', 'hood', 'shell'], 0.9), dim: 0.6, 'hl:brakes': 0.6, 'hl:wheels': 0.3, 'ghost:wheels': 0.55 },
    focus: ['brakes', 'wheels', 'suspension'],
    free: true,
    requires: ['car'],
  },
  'sys-electrical': {
    id: 'sys-electrical',
    shot: { id: 'sys-electrical', target: V(0.75, 0.6, 0.05), az: 2.2, el: 0.6, dist: 4.4, fov: 30, ox: 0.1, subject: { w: 3.0, h: 1.2 }, orbit: { az: null, el: [0.05, 1.2], dist: [0.6, 1.5] } },
    channels: { ...all(0.9), ...ghostParts(ENGINE_CASINGS, 0.5), dim: 0.7, 'hl:electrical': 0.6, 'hl:control': 0.6, 'flow:can': 1, 'flow:ecuPower': 1, 'flow:chargeCurrent': 1 },
    focus: ['electrical', 'control', 'ignition'],
    free: true,
    requires: ['car'],
  },
  'sys-body': {
    id: 'sys-body',
    shot: { id: 'sys-body', target: V(0.0, 0.62, 0), az: 2.45, el: 0.22, dist: 8.4, fov: 28, ox: 0.08, subject: { w: 5.0, h: 1.7 }, orbit: { az: null, el: [0.03, 1.15], dist: [0.55, 1.5] } },
    channels: { ...all(0.7), 'show:structure': 1, dim: 0.75, 'hl:structure': 0.3 },
    focus: ['structure', 'body'],
    free: true,
    requires: ['car'],
  },
  'sys-cabin': {
    id: 'sys-cabin',
    shot: { id: 'sys-cabin', target: V(0.2, 0.82, -0.15), az: 2.75, el: 0.42, dist: 3.4, fov: 30, ox: 0.1, subject: { w: 2.4, h: 1.0 }, orbit: { az: [-1.2, 1.2], el: [0.05, 1.2], dist: [0.6, 1.5] } },
    channels: { ...bodyGhost(['doorFL', 'doorRL', 'shell', 'hood', 'fenderL'], 0.9), dim: 0.65, 'hl:cabin': 0.4, 'hl:hvac': 0.6, 'hl:controls': 0.6, 'flow:cabinAir': 1 },
    focus: ['cabin', 'hvac', 'controls', 'steering'],
    free: true,
    requires: ['car'],
  },
  'sys-safety': {
    id: 'sys-safety',
    shot: { id: 'sys-safety', target: V(0.0, 0.82, 0), az: 2.6, el: 0.32, dist: 5.6, fov: 28, ox: 0.1, subject: { w: 3.6, h: 1.4 }, orbit: { az: null, el: [0.03, 1.2], dist: [0.6, 1.5] } },
    channels: { ...all(0.9), 'show:structure': 0.6, dim: 0.7, 'hl:safety': 0.6 },
    focus: ['safety', 'structure', 'cabin'],
    free: true,
    requires: ['car'],
  },

  // ─────────── the vertical slice: start → combustion → driveline → tyres ───────────
  'start-button': {
    id: 'start-button',
    shot: { id: 'start-button', target: V(0.42, 0.88, -0.32), az: 2.8, el: 0.22, dist: 1.6, fov: 30, ox: 0.08, subject: { w: 0.9, h: 0.55 }, orbit: false },
    channels: { ...bodyGhost(['doorFL', 'shell'], 0.85), ...hideAll(['door-trims', 'seat-driver', 'head-restraints', 'seat-belt-driver']), studio: 0.6, dim: 0.5, 'hl:controls': 0.6 },
    focus: ['cabin', 'controls', 'steering', 'control'],
    requires: ['car'],
  },
  'battery-starter': {
    id: 'battery-starter',
    shot: { id: 'battery-starter', target: V(1.08, 0.5, 0.18), az: 1.95, el: 0.62, dist: 2.3, fov: 30, ox: 0.08, subject: { w: 1.3, h: 0.8 }, orbit: false },
    channels: { ...bodyGhost(PANELS_FRONT, 0.92), ...bodyGhost(['shell'], 0.5), ...ghostParts(['engine-block', 'cylinder-head', 'cam-cover', 'intake-manifold', 'oil-pan', 'transmission-case', 'air-filter-box', 'air-duct', 'exhaust-manifold'], 0.7), studio: 0.6, dim: 0.6, 'hl:electrical': 0.7, 'flow:starterCurrent': 1, 'flow:groundReturn': 1, 'flow:ecuPower': 1 },
    focus: ['electrical', 'control'],
    requires: ['car'],
  },
  'starter-flexplate': {
    id: 'starter-flexplate',
    // buried parts are framed from outside the body with a longer lens (the camera never enters the car)
    shot: { id: 'starter-flexplate', target: V(FLEX_X - 0.02, CRANK_Y - 0.06, -0.05), az: 2.3, el: 0.14, dist: 1.95, fov: 17, ox: 0.06, subject: { w: 0.5, h: 0.42 }, orbit: false },
    channels: { ...all(0.92), ...ghostParts(['transmission-case', 'oil-pan', 'engine-block', 'exhaust-manifold', 'intake-manifold'], 0.85), studio: 0.6, dim: 0.6, 'hl:electrical': 0.5, 'hl:flexplate': 0.6, 'flow:starterCurrent': 0.6 },
    focus: ['electrical', 'transmission', 'engine'],
    requires: ['car'],
  },
  'cylinder-cutaway': {
    id: 'cylinder-cutaway',
    shot: { id: 'cylinder-cutaway', target: V(XC[0], DECK_Y - 0.06, -0.01), az: 1.95, el: 0.22, dist: 0.95, fov: 30, ox: 0.1, subject: { w: 0.42, h: 0.5 }, orbit: { az: [-0.45, 0.45], el: [0.0, 0.5], dist: [0.8, 1.3] } },
    channels: { ...bodyGhost(PANELS_FRONT, 1), ...bodyGhost(['shell'], 0.6), ...hideAll(FRONT_DRIVE), 'cut:engine': 1, studio: 0.75, dim: 0.75, 'flow:combustion': 1 },
    focus: ['engine', 'ignition', 'injection', 'intake', 'exhaust', 'lubrication'],
    requires: ['car'],
  },
  'firing-order': {
    id: 'firing-order',
    shot: { id: 'firing-order', target: V((XC[0] + XC[3]) / 2, DECK_Y - 0.1, 0), az: 2.6, el: 0.3, dist: 1.55, fov: 30, ox: 0.1, subject: { w: 0.75, h: 0.55 }, orbit: { az: [-0.5, 0.5], el: [0.0, 0.8], dist: [0.8, 1.3] } },
    channels: { ...bodyGhost(PANELS_FRONT, 1), ...bodyGhost(['shell', 'doorFL'], 0.7), ...ghostParts(ENGINE_CASINGS, 0.9), ...ghostParts(['air-filter-box', 'air-duct', 'fuel-rail', 'fuel-injectors', 'ignition-coils', 'throttle-body', 'maf-sensor', 'map-sensor', 'brake-booster', 'master-cylinder', 'brake-reservoir', 'fuse-box', 'starter'], 0.85), studio: 0.7, dim: 0.75, 'flow:combustion': 0.7, 'hl:engine': 0.3 },
    focus: ['engine', 'ignition', 'injection'],
    requires: ['car'],
  },
  'torque-path': {
    id: 'torque-path',
    shot: { id: 'torque-path', target: V(-0.1, 0.38, 0), az: 2.75, el: 0.3, dist: 6.0, fov: 30, ox: 0.08, subject: { w: 4.6, h: 1.0 }, orbit: { az: [-0.6, 0.6], el: [0.05, 0.9], dist: [0.7, 1.3] } },
    channels: { ...all(0.92), ...ghostParts(['transmission-case', 'diff-housing', 'diff-cover'], 0.7), ...ghostParts(ENGINE_CASINGS, 0.4), studio: 0.5, dim: 0.65, 'flow:torque': 1, 'hl:transmission': 0.35, 'hl:driveline': 0.35 },
    focus: ['engine', 'transmission', 'driveline', 'wheels'],
    requires: ['car'],
  },
  converter: {
    id: 'converter',
    shot: { id: 'converter', target: V(TRANS.convX - 0.01, TRANS.axisY, 0.0), az: 2.7, el: 0.22, dist: 1.75, fov: 17, ox: 0.1, subject: { w: 0.38, h: 0.38 }, orbit: { az: [-0.4, 0.4], el: [0.0, 0.6], dist: [0.9, 1.3] } },
    channels: { ...all(1), 'cut:transmission': 1, ...hideAll(['starter', 'starter-pinion', 'exhaust-manifold', 'catalytic-converter', 'heat-shield-cat', 'brake-booster', 'master-cylinder', 'brake-reservoir', 'pedal-box', 'brake-pedal', 'throttle-pedal', 'steering-column', 'steering-wheel', 'dashboard', 'seat-driver', 'door-trims', 'head-restraints', 'airbag-modules', 'instrument-cluster', 'vents', 'bcm', 'obd-port', 'fuse-box', 'centre-console', 'cabin-floor', 'hvac-box', 'evaporator', 'blower', 'heater-core', 'blend-door', 'cabin-filter', 'structure-crash', 'wiring-harness']), studio: 0.75, dim: 0.75, 'hl:transmission': 0.3 },
    focus: ['transmission', 'engine'],
    requires: ['car'],
  },
  gearbox: {
    id: 'gearbox',
    shot: { id: 'gearbox', target: V(0.78, TRANS.axisY, 0.0), az: 2.8, el: 0.25, dist: 1.3, fov: 30, ox: 0.1, subject: { w: 0.7, h: 0.4 }, orbit: { az: [-0.5, 0.5], el: [0.0, 0.7], dist: [0.8, 1.4] } },
    channels: { ...all(1), 'cut:transmission': 1, ...hideAll(['starter', 'starter-pinion', 'exhaust-manifold', 'catalytic-converter', 'heat-shield-cat', 'pedal-box', 'brake-pedal', 'throttle-pedal', 'steering-column', 'steering-wheel', 'dashboard', 'seat-driver', 'door-trims', 'head-restraints', 'airbag-modules', 'instrument-cluster', 'vents', 'bcm', 'obd-port', 'centre-console', 'cabin-floor', 'hvac-box', 'evaporator', 'blower', 'heater-core', 'blend-door', 'cabin-filter', 'wiring-harness', 'gear-selector', 'airbag-control-module', 'exhaust-pipes']), studio: 0.75, dim: 0.75, 'hl:transmission': 0.25 },
    focus: ['transmission'],
    requires: ['car'],
  },
  differential: {
    id: 'differential',
    shot: { id: 'differential', target: V(DIFF_C.x + 0.02, DIFF_C.y + 0.01, 0), az: -2.05, el: 0.42, dist: 1.95, fov: 17, ox: 0.1, subject: { w: 0.5, h: 0.4 }, orbit: { az: [-0.5, 0.5], el: [0.05, 0.8], dist: [0.9, 1.3] } },
    channels: { ...all(1), 'cut:diff': 1, ...hideAll(['muffler', 'tailpipes', 'exhaust-pipes', 'exhaust-hangers', 'rear-subframe', 'anti-roll-bar-rear', 'fuel-tank', 'seat-rear', 'head-restraints', 'cabin-floor', 'structure-mild', 'wiring-harness']), studio: 0.75, dim: 0.75, 'hl:driveline': 0.25 },
    focus: ['driveline', 'wheels'],
    requires: ['car'],
  },
  'rear-contact': {
    id: 'rear-contact',
    shot: { id: 'rear-contact', target: V(BODY.xRear + 0.05, 0.22, -0.82), az: 3.0, el: 0.06, dist: 1.9, fov: 30, ox: 0.08, subject: { w: 1.0, h: 0.6 }, orbit: false },
    channels: { ...bodyGhost(['doorRL', 'shell', 'bumperRear'], 0.85), 'show:road': 1, 'arrow:tyre': 1, studio: 0.4, dim: 0.4, 'flow:torque': 0.6 },
    focus: ['wheels', 'driveline', 'brakes', 'suspension'],
    requires: ['car'],
  },
  'drive-away': {
    id: 'drive-away',
    shot: { id: 'drive-away', target: V(0.0, 0.6, 0), az: 2.55, el: 0.12, dist: 8.4, fov: 28, ox: 0.08, subject: { w: 5.0, h: 1.6 }, orbit: false },
    channels: { 'show:road': 1, 'arrow:tyre': 0.8 },
    requires: ['car'],
  },
};

export const SYSTEM_VIEWS: Record<string, string> = {
  power: 'sys-power',
  air: 'sys-air',
  cooling: 'sys-cooling',
  driveline: 'sys-driveline',
  chassis: 'sys-chassis',
  brakes: 'sys-brakes',
  electrical: 'sys-electrical',
  body: 'sys-body',
  cabin: 'sys-cabin',
  safety: 'sys-safety',
};

/** The body's collision capsules (for the camera), in vehicle coordinates. */
export const KEEP_OUT: { a: Vector3; b: Vector3; r: number }[] = [
  { a: V(-1.95, 0.56, -0.42), b: V(1.78, 0.56, -0.42), r: 0.48 },
  { a: V(-1.95, 0.56, 0.42), b: V(1.78, 0.56, 0.42), r: 0.48 },
  { a: V(-1.2, 1.0, -0.32), b: V(0.35, 1.0, -0.32), r: 0.42 },
  { a: V(-1.2, 1.0, 0.32), b: V(0.35, 1.0, 0.32), r: 0.42 },
];
void WHEEL_Y;
