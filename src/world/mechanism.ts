/**
 * The mechanism: poses every moving part of the drawn car from the car model's state.
 *
 * It reads one interpolated view of the state (between the last two fixed steps, so motion is
 * smooth at any frame rate and in slow motion) and writes only the rig's mechanism offsets;
 * the rig composes them with each part's immutable baseline and the explode channels. Every
 * related motion is derived from a shared quantity, never from its own loop:
 *
 *   crank angle θ      → crankshaft, damper, flexplate, pistons, rods, cams (θ/2), valves,
 *                        springs, timing chain, accessory pulleys, converter impeller
 *   turbine angle      → turbine, lock-up clutch, input shaft, gearset ring gears
 *   driveshaft angle   → output shaft, driveshaft, pinion; gearset carriers between the two
 *   carrier angle      → ring gear and differential carrier
 *   wheel angles       → side gears, half shafts, discs, wheels and tyres
 *   spider angle       → spider gears (on their pin, while the carrier turns)
 *   ride state         → body heave, pitch and roll; wheel travel; every link between them
 */
import { Quaternion, Vector3 } from 'three';
import { STEERING, TIRE } from '../spec/vehicle';
import { CYCLE, pistonDrop, phaseDeg, intakeLift, exhaustLift, CRANK_R, ROD_L } from '../sim/engine';
import { PLANETARY } from '../sim/drivetrain';
import type { CarState } from '../sim/car';
import { CORNERS, type Link } from '../scene/car/chassisGeo';
import { MAX_LIFT_EX, MAX_LIFT_IN, placeChain } from '../scene/car/engineGeo';
import type { Car } from '../scene/car/build';

const DEG = Math.PI / 180;
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const NZ = new Vector3(0, 0, -1);

/** What the mechanism draws: angles and positions, interpolated. */
export interface MechView {
  crank: number;
  turbine: number;
  stator: number;
  driveshaft: number;
  carrier: number;
  spider: number;
  wheel: number[];
  wheelZ: number[];
  steer: number[];
  steerWheel: number;
  heave: number;
  pitch: number;
  roll: number;
  fan: number;
  fz: number[];
  brakeN: number;
  throttle: number;
  cranking: boolean;
  lockup: number;
}

export function emptyView(): MechView {
  return { crank: 0, turbine: 0, stator: 0, driveshaft: 0, carrier: 0, spider: 0, wheel: [0, 0, 0, 0], wheelZ: [0, 0, 0, 0], steer: [0, 0, 0, 0], steerWheel: 0, heave: 0, pitch: 0, roll: 0, fan: 0, fz: [4000, 4000, 3700, 3700], brakeN: 0, throttle: 0, cranking: false, lockup: 0 };
}

/** Unwrapped interpolation of an angle that may have wrapped by `period` between steps. */
function lerpAngle(a: number, b: number, t: number, period: number): number {
  let d = b - a;
  if (d > period / 2) d -= period;
  else if (d < -period / 2) d += period;
  return a + d * t;
}

export function interpolate(prev: CarState, cur: CarState, t: number, out: MechView, extra: { brakeN: number; throttle: number; cranking: boolean }): MechView {
  const L = (a: number, b: number) => a + (b - a) * t;
  out.crank = lerpAngle(prev.crank, cur.crank, t, CYCLE);
  out.turbine = lerpAngle(prev.turbineAngle, cur.turbineAngle, t, Math.PI * 2);
  out.stator = lerpAngle(prev.statorAngle, cur.statorAngle, t, Math.PI * 2);
  out.driveshaft = lerpAngle(prev.driveshaftAngle, cur.driveshaftAngle, t, Math.PI * 2);
  out.carrier = lerpAngle(prev.carrierAngle, cur.carrierAngle, t, Math.PI * 2);
  out.spider = lerpAngle(prev.spiderAngle, cur.spiderAngle, t, Math.PI * 2);
  out.fan = lerpAngle(prev.fanAngle, cur.fanAngle, t, Math.PI * 2);
  for (let i = 0; i < 4; i++) {
    out.wheel[i] = lerpAngle(prev.wheelAngle[i], cur.wheelAngle[i], t, Math.PI * 2);
    out.wheelZ[i] = L(prev.wheelZ[i], cur.wheelZ[i]);
    out.steer[i] = L(prev.steerAngle[i], cur.steerAngle[i]);
    out.fz[i] = cur.fz[i];
  }
  out.steerWheel = L(prev.steerWheel, cur.steerWheel);
  out.heave = L(prev.heave, cur.heave);
  out.pitch = L(prev.pitch, cur.pitch);
  out.roll = L(prev.roll, cur.roll);
  out.brakeN = extra.brakeN;
  out.throttle = extra.throttle;
  out.cranking = extra.cranking;
  out.lockup = cur.lockup;
  return out;
}

const _q = new Quaternion();
const _q2 = new Quaternion();
const _v = new Vector3();
const _v2 = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
/** The body's roll and pitch pivot (about the roll centres' height). */
const BODY_PIVOT = new Vector3(0, 0.12, 0);

export class Mechanism {
  /** Body transform this frame (for links and for anything that rides on the body). */
  bodyQ = new Quaternion();
  bodyT = new Vector3();
  constructor(private car: Car) {}

  /** A point fixed to the body, where it is this frame. */
  bodyPoint(p: Vector3, out = new Vector3()): Vector3 {
    return out.copy(p).sub(BODY_PIVOT).applyQuaternion(this.bodyQ).add(BODY_PIVOT).add(this.bodyT);
  }

  pose(v: MechView) {
    const car = this.car;
    const E = car.engine;
    const D = car.drivetrain;
    const th = v.crank;

    // ── body (sprung mass): heave, pitch (nose up +), roll (right side down +)
    {
      const sprungNode = car.rig.parts.get('sprung')!;
      _q.setFromAxisAngle(Z, v.pitch);
      _q2.setFromAxisAngle(X, v.roll);
      this.bodyQ.copy(_q).multiply(_q2);
      // rotate about the pivot: p' = R(p − P) + P + (0, heave, 0)
      _v.copy(BODY_PIVOT).applyQuaternion(this.bodyQ);
      this.bodyT.set(0, v.heave, 0);
      sprungNode.mq.copy(this.bodyQ);
      sprungNode.mp.copy(BODY_PIVOT).sub(_v).add(this.bodyT);
    }

    // ── crank train
    _q.setFromAxisAngle(X, -th);
    for (const n of E.crank) n.mq.copy(_q);
    E.flexplate.mq.copy(_q);
    for (let i = 0; i < 4; i++) {
      const ph = phaseDeg(i, th);
      const beta = (ph % 360) * DEG;
      const drop = pistonDrop(beta);
      E.pistons[i].mp.set(0, -drop, 0);
      const rod = E.rods[i];
      rod.mp.set(0, -drop, 0);
      const a = Math.asin((CRANK_R * Math.sin(beta)) / ROD_L);
      rod.mq.setFromAxisAngle(X, a);
    }
    _q.setFromAxisAngle(X, -th / 2);
    E.camIn.mq.copy(_q);
    E.camEx.mq.copy(_q);
    for (const vv of E.valves) {
      const ph = phaseDeg(vv.cyl, th);
      const lift = vv.intake ? intakeLift(ph) * MAX_LIFT_IN : exhaustLift(ph) * MAX_LIFT_EX;
      vv.node.mp.copy(vv.dir).multiplyScalar(-lift);
      // the spring is built along its own axis: compress it by the lift
      const restLen = 0.098 - 0.012 - 0.052;
      vv.spring.ms.set(1, (restLen - lift) / restLen, 1);
    }
    placeChain(E.chain, th);
    for (const p of E.pulleys) p.node.mq.setFromAxisAngle(X, -th * p.ratio);
    // starter pinion: slides into mesh and turns while cranking
    E.starterPinion.mp.set(v.cranking ? 0 : -0.016, 0, 0);
    E.starterPinion.mq.setFromAxisAngle(X, v.cranking ? th * (0.148 / 0.012) : 0);

    // ── converter, gearbox
    _q.setFromAxisAngle(X, -th);
    for (const n of D.coverImpeller) n.mq.copy(_q);
    _q.setFromAxisAngle(X, -v.turbine);
    for (const n of D.turbine) n.mq.copy(_q);
    D.lockup.mq.copy(_q);
    D.lockup.mp.set(0.003 * v.lockup, 0, 0);
    D.inputShaft.mq.copy(_q);
    D.stator.mq.setFromAxisAngle(X, -v.stator);
    // gearsets: ring = input, carrier between input and output (set k nearer the output for
    // later sets), sun and planets from Willis' equation, so every mesh is consistent
    const S = PLANETARY.sun;
    const R = PLANETARY.ring;
    const P = PLANETARY.planet;
    D.gearsets.forEach((gs, k) => {
      const ring = v.turbine;
      const f = (k + 1) / 5;
      const carrier = ring + (v.driveshaft - ring) * f;
      const sun = ((S + R) * carrier - R * ring) / S;
      gs.ring.mq.setFromAxisAngle(X, -ring);
      gs.carrier.mq.setFromAxisAngle(X, -carrier);
      gs.sun.mq.setFromAxisAngle(X, -sun);
      const planet = ((ring - carrier) * R) / P;
      for (const pl of gs.planets) pl.mq.setFromAxisAngle(X, -planet);
    });
    _q.setFromAxisAngle(X, -v.driveshaft);
    for (const n of D.output) n.mq.copy(_q);
    D.pinion.mq.copy(_q);
    // driveshaft: about its own (sloping) axis
    {
      const ds = D.driveshaft;
      _v.set(1, 0, 0).applyQuaternion(ds.base.q);
      ds.mq.setFromAxisAngle(_v, v.driveshaft);
    }
    // differential
    _q.setFromAxisAngle(NZ, v.carrier);
    D.ring.mq.copy(_q);
    D.carrier.mq.copy(_q);
    D.spiders.forEach((s, i) => s.mq.setFromAxisAngle(Y, (i === 0 ? -1 : 1) * v.spider));
    D.sideGears[0].mq.setFromAxisAngle(NZ, v.wheel[2]);
    D.sideGears[1].mq.setFromAxisAngle(NZ, v.wheel[3]);

    // ── corners: travel, steer, spin; tyres
    const ch = car.chassis;
    CORNERS.forEach((c, i) => {
      const corner = ch.corners[i];
      const node = car.rig.parts.get(`corner-${c.id}`)!;
      node.mp.set(0, v.wheelZ[i], 0);
      node.mq.setFromAxisAngle(Y, v.steer[i]);
      const spinNode = car.rig.parts.get(`wheel-spin-${c.id}`)!;
      spinNode.mq.setFromAxisAngle(NZ, v.wheel[i]);
      const u = corner.tyreMat.userData.u;
      u.uSpin.value = c.side < 0 ? -v.wheel[i] : v.wheel[i];
      u.uFlat.value = Math.max(0.004, Math.min(0.04, v.fz[i] / TIRE.verticalStiffness));
    });

    // ── links between the body and the corners
    for (const l of ch.links) this.poseLink(l, v);

    // ── steering
    const steer = v.steerWheel;
    ch.rack.mp.set(0, 0, -steer * (STEERING.rackPerRev / (2 * Math.PI)));
    {
      const sw = ch.steeringWheel;
      _v.set(0, 1, 0).applyQuaternion(sw.base.q);
      sw.mq.setFromAxisAngle(_v, steer);
      ch.rackPinion.mq.setFromAxisAngle(Y, steer);
    }

    // ── pedals, fans
    car.systems.pedal.mq.setFromAxisAngle(Z, Math.min(0.32, v.brakeN / 1600));
    car.systems.throttlePedal.mq.setFromAxisAngle(Z, v.throttle * 0.22);
    for (const f of car.systems.fans) f.node.mq.setFromAxisAngle(X, -v.fan);
  }

  private poseLink(l: Link, v: MechView) {
    const ci = l.corner;
    const c = CORNERS[ci];
    // body-side point(s) move with the body; wheel-side ones with the wheel's travel (and the
    // tie rod's with the steer angle, about the kingpin through the wheel centre)
    const a = this.bodyPoint(l.a, _a);
    const b = _b.copy(l.b);
    b.y += v.wheelZ[ci];
    if (l.kind === 'tierod' && c.front) {
      _v.set(c.x, b.y, c.z);
      b.sub(_v).applyAxisAngle(Y, v.steer[ci]).add(_v);
      // the rack moves too
      a.z += -v.steerWheel * (STEERING.rackPerRev / (2 * Math.PI));
    }
    const n = l.node;
    if (l.kind === 'arm') {
      // a hinge on the body: turn about the inner pivots' axis so the ball joint follows
      const h = _v.subVectors(l.a2!, l.a).normalize();
      const restVec = _v2.subVectors(l.b, l.a);
      const r0 = restVec.clone().addScaledVector(h, -restVec.dot(h));
      // the target, in the body's frame
      const inv = this.bodyQ.clone().invert();
      const tgt = b.clone().sub(a).applyQuaternion(inv);
      const r1 = tgt.addScaledVector(h, -tgt.dot(h));
      const ang = Math.atan2(h.dot(r0.clone().cross(r1)), r0.dot(r1));
      _q.setFromAxisAngle(h, ang);
      n.mq.copy(this.bodyQ).multiply(_q);
      n.mp.subVectors(a, l.a);
      return;
    }
    // straight members, re-aimed every frame:
    //   tie rods, lateral links, half shafts  anchored on the body (a), aimed at b, stretched
    //   damper bodies and springs            anchored on the wheel side (b), aimed at a
    //                                        (a spring is compressed to fit; a damper body is not)
    //   damper rods                          hang from the top mount (a), sliding in the body
    const fromWheel = l.kind === 'damperBody' || l.kind === 'spring';
    const from = fromWheel ? b : a;
    const to = fromWheel ? a : b;
    const restFrom = fromWheel ? l.b : l.a;
    const restTo = fromWheel ? l.a : l.b;
    const d0 = _v.subVectors(restTo, restFrom).normalize();
    const d1 = _v2.subVectors(to, from);
    const len = d1.length();
    d1.normalize();
    n.mq.setFromUnitVectors(d0, d1);
    n.mp.subVectors(from, restFrom);
    if (l.kind === 'damperRod' || l.kind === 'damperBody') n.ms.set(1, 1, 1);
    else n.ms.set(1, len / l.restLen, 1);
  }
}

