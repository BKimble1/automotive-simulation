import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, Quaternion } from 'three';
import { buildCar } from './build';
import { Mechanism, emptyView } from '../../world/mechanism';
import { BODY, STEERING } from '../../spec/vehicle';

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

  it('keeps rigid links rigid: the rack and the rear knuckles move so tie rods and links keep their lengths', () => {
    const c = car();
    const mech = new Mechanism(c);
    const v = emptyView();
    const lim = STEERING.maxWheelAngle;
    const ack = (d: number): [number, number] => {
      if (Math.abs(d) < 1e-6) return [0, 0];
      const R = BODY.wheelbase / Math.tan(Math.abs(d));
      const i = Math.atan(BODY.wheelbase / (R - BODY.trackFront / 2));
      const o = Math.atan(BODY.wheelbase / (R + BODY.trackFront / 2));
      return d > 0 ? [i, o] : [-o, -i];
    };
    let worst = 0;
    for (const z of [-0.04, 0, 0.04])
      for (const k of [-1, -0.5, 0, 0.5, 1])
        for (const roll of [-0.02, 0, 0.02]) {
          const d = lim * k;
          const [l, r] = ack(d);
          v.wheelZ = [z, -z * 0.5, z, -z * 0.5];
          v.steer = [l, r, 0, 0];
          v.steerWheel = d * STEERING.ratio;
          v.roll = roll;
          c.rig.resetMechanism();
          mech.pose(v);
          c.rig.apply(() => 0);
          c.root.updateMatrixWorld(true);
          for (const link of c.chassis.links) {
            if (link.kind !== 'tierod' && link.kind !== 'stretch') continue;
            // never stretched
            expect(link.node.ms.y, link.node.name).toBe(1);
          }
          worst = Math.max(worst, mech.rackResidual, mech.rearResidual);
        }
    // what is left (the model's ideal Ackermann against a real linkage, and straight-up wheel
    // travel): about a centimetre at full lock with the wheel in bump, inside the rack's boot
    expect(worst).toBeLessThan(0.016);
  });
});
