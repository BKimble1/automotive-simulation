/**
 * Views for anything in the registry: a system has its authored view; an assembly or a part gets
 * one computed from where it is drawn. The shot frames the part's bounds (at rest, so the frame
 * does not breathe with the mechanism) from its system's side of the car; the channels are its
 * system view's (the bodywork and neighbours already opened for that system), with the part lit
 * and the rest dimmed. An entry with an authored `shot` uses that view instead.
 */
import { Box3, Matrix4, Vector3, type Object3D } from 'three';
import { BY_ID, nodesOf } from '../content/registry';
import type { Car } from '../scene/car/build';
import { SYSTEM_VIEWS, VIEWS, type View } from './views';

/** Views per built car: a rebuilt car (a new scene) gets its own, never a stale one. */
const caches = new WeakMap<Car, Map<string, View>>();

/** The frame a part rides in: a corner (travel, steer) or the sprung body (heave, pitch, roll). */
function carrierOf(o: Object3D, car: Car): Object3D {
  const corners = new Set<Object3D>(car.chassis.corners.map((c) => c.group));
  for (let p: Object3D | null = o; p; p = p.parent) {
    if (corners.has(p)) return p;
    if (p === car.sprung) return p;
  }
  return car.root;
}

export function viewFor(id: string, car: Car): View | null {
  const c = BY_ID.get(id);
  if (!c) return null;
  if (c.kind === 'system') return VIEWS[SYSTEM_VIEWS[c.id]] ?? null;
  let cache = caches.get(car);
  if (!cache) caches.set(car, (cache = new Map()));
  const hit = cache.get(id);
  if (hit) return hit;
  const base = VIEWS[SYSTEM_VIEWS[c.system]];
  const rig = car.rig;
  const nodes = nodesOf(id, (comp) => (rig.byComponent.get(comp) ?? []).map((n) => n.name));
  // bounds of the drawn parts at rest, in the car's frame: the rig is put back on its baselines
  // (no mechanism offsets, nothing taken apart) for the measurement; the next frame poses it again
  rig.resetMechanism();
  rig.apply(() => 0);
  const box = new Box3();
  const tmp = new Box3();
  car.root.updateMatrixWorld(true);
  for (const name of nodes) {
    const n = rig.parts.get(name);
    if (!n) continue;
    for (const m of n.meshes) {
      m.geometry.computeBoundingBox();
      tmp.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
      box.union(tmp);
    }
    // body panels are drawn by the body, not the rig's meshes
    if (name.startsWith('panel-')) {
      const p = car.body.panels.find((q) => `panel-${q.name}` === name);
      if (p) {
        p.paint.geometry.computeBoundingBox();
        tmp.copy(p.paint.geometry.boundingBox!).applyMatrix4(p.paint.matrixWorld);
        box.union(tmp);
      }
    }
  }
  if (box.isEmpty()) return null;
  const centre = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  // the shot follows the part where it is displayed: its centre rides with the frame that
  // carries it (a wheel's corner, the body), not with its own spin or stroke
  const first = nodes.map((n) => rig.parts.get(n)).find((n) => n && !n.name.startsWith('panel-'));
  const carrier = first ? carrierOf(first.object, car) : car.root;
  const local = centre.clone().applyMatrix4(new Matrix4().copy(carrier.matrixWorld).invert());
  const follow = new Vector3();
  const target = carrier === car.root ? centre : () => follow.copy(local).applyMatrix4(carrier.matrixWorld);
  const authored = c.shot ? VIEWS[c.shot] : null;
  const panels = nodes.filter((n) => n.startsWith('panel-')).map((n) => n.slice(6));
  const channels: Record<string, number> = { ...(authored?.channels ?? base?.channels ?? {}) };
  // the subject lit, the rest dimmed; a body panel stays solid while the others turn to glass
  for (const n of nodes) channels[`hl:${n}`] = 0.85;
  channels.dim = Math.max(channels.dim ?? 0, 0.6);
  for (const p of panels) channels[`body:${p}`] = 0;
  for (const n of nodes) {
    delete channels[`ghost:${n}`];
    delete channels[`hide:${n}`];
  }
  const assemblies = [...new Set(nodes.map((n) => rig.parts.get(n)?.assembly).filter(Boolean) as string[])];
  for (const a of assemblies) {
    delete channels[`ghost:${a}`];
    delete channels[`hide:${a}`];
  }
  // the subject's colour fills it (not only its rim), so a small part reads at a glance
  const tint = Object.fromEntries(nodes.filter((n) => !n.startsWith('panel-')).map((n) => [n, '#b9b2ff']));
  if (authored) {
    const v: View = { ...authored, id: `part:${id}`, channels, tint, focus: assemblies.length ? assemblies : authored.focus, free: true };
    cache.set(id, v);
    return v;
  }
  // from the system's side, mirrored to the right for parts on the right of the car
  const sys = base?.shot ?? VIEWS.overview.shot;
  let az = sys.az;
  if (centre.z > 0.2 && Math.cos(az) < 0) az = Math.PI - az;
  if (centre.z < -0.2 && Math.cos(az) > 0) az = Math.PI - az;
  const w = Math.max(0.22, Math.max(size.x, size.z) * 1.15);
  const h = Math.max(0.18, size.y * 1.35, w * 0.45);
  const dist = Math.max(0.9, Math.min(9, Math.max(w, h) * 2.6));
  const v: View = {
    id: `part:${id}`,
    shot: { id: `part:${id}`, target, az, el: Math.max(0.15, Math.min(0.75, sys.el + 0.05)), dist, fov: 30, ox: -0.1, subject: { w, h }, orbit: { az: [-0.9, 0.9], el: [0.02, 1.2], dist: [0.6, 1.8] } },
    channels,
    tint,
    focus: assemblies,
    free: true,
    requires: ['car'],
  };
  cache.set(id, v);
  return v;
}
