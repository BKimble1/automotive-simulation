import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, Quaternion } from 'three';
import { buildCar } from './build';
import { Mechanism, emptyView } from '../../world/mechanism';

function car() {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(9), 3));
  g.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  return buildCar(g);
}

describe('rig', () => {
  it('keeps every part’s baseline immutable', () => {
    const c = car();
    const n = c.rig.parts.get('crankshaft')!;
    expect(Object.isFrozen(n.base.p)).toBe(true);
    expect(() => {
      (n.base.p as { x: number }).x = 5;
    }).toThrow();
  });

  it('returns every part exactly to its baseline after taking apart, mechanism and reassembly (no drift)', () => {
    const c = car();
    const mech = new Mechanism(c);
    const v = emptyView();
    const groups = ['explode', 'engine', 'converter', 'brake'];
    for (let k = 0; k < 40; k++) {
      v.crank = k * 0.77;
      v.turbine = k * 0.31;
      v.wheel = [k * 0.2, k * 0.21, k * 0.22, k * 0.23];
      v.wheelZ = [0.01 * Math.sin(k), 0, 0, 0];
      v.pitch = 0.01 * Math.cos(k);
      c.rig.resetMechanism();
      mech.pose(v);
      c.rig.apply((g) => (groups.includes(g) ? (k % 7) / 6 : 0));
    }
    c.rig.resetMechanism();
    c.rig.apply(() => 0);
    const q = new Quaternion();
    for (const n of c.rig.parts.values()) {
      expect(n.object.position.distanceTo(n.base.p), n.name).toBeLessThan(1e-9);
      expect(Math.abs(n.object.quaternion.dot(q.copy(n.base.q))), n.name).toBeGreaterThan(1 - 1e-12);
      expect(n.object.scale.distanceTo(n.base.s), n.name).toBeLessThan(1e-9);
    }
  });
});
