/**
 * Flows: particles that move along a path through the car's parts, at a speed that comes from
 * the model (the integral of a flow rate, so they start and stop for physical reasons, and a
 * seek reconstructs them exactly). Each flow has a kind from the visual language (colour,
 * shape, motion). Nothing is allocated per frame: positions come from a precomputed table of
 * the path by arc length, written into one instanced mesh per flow.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  Color,
} from 'three';
import { LANGUAGE, type FlowKind, type FlowStyle } from './language';

function geometryFor(style: FlowStyle, size: number): BufferGeometry {
  switch (style) {
    case 'streak':
      return new CapsuleGeometry(size * 0.18, size * 2.2, 2, 6);
    case 'dash':
      return new CapsuleGeometry(size * 0.38, size * 1.6, 2, 8);
    case 'droplet':
      return new SphereGeometry(size * 0.5, 8, 6);
    case 'puff':
      return new SphereGeometry(size * 0.5, 10, 8);
    case 'packet':
      return new BoxGeometry(size, size * 1.6, size);
    case 'pulse':
      return new BoxGeometry(size * 0.6, size * 2.4, size * 0.6);
    case 'band':
      return new TorusGeometry(size * 1.1, size * 0.35, 6, 14).rotateX(Math.PI / 2);
    case 'chevron':
      return new ConeGeometry(size * 0.55, size * 1.1, 4, 1);
    default:
      return new SphereGeometry(size * 0.5, 6, 4);
  }
}

export interface FlowDef {
  id: string;
  kind: FlowKind;
  points: Vector3[];
  /** Metres of travel per unit of the driving phase. */
  pace?: number;
  /** Particle size multiplier. */
  scale?: number;
  closed?: boolean;
  /** Spread across the path (particles wander up to this far from the centre line), m. */
  spread?: number;
}

const LUT = 256;
const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _t = new Vector3();
const UP = new Vector3(0, 1, 0);

export class Flow {
  id: string;
  kind: FlowKind;
  mesh: InstancedMesh;
  mat: MeshBasicMaterial;
  length: number;
  count: number;
  pace: number;
  private pts: Float32Array;
  private tans: Float32Array;
  private offsets: Float32Array;
  private closed: boolean;
  private spread: number;
  /** Opacity this frame (from its channel × how fast it is moving). */
  opacity = 0;

  constructor(def: FlowDef, parent: Object3D, density = 1) {
    this.id = def.id;
    this.kind = def.kind;
    const lang = LANGUAGE[def.kind];
    this.closed = def.closed ?? false;
    const curve = new CatmullRomCurve3(def.points, this.closed, 'centripetal', 0.5);
    this.length = curve.getLength();
    this.pace = def.pace ?? 1;
    this.spread = def.spread ?? 0;
    this.count = Math.max(4, Math.round(this.length * lang.density * density));
    this.pts = new Float32Array((LUT + 1) * 3);
    this.tans = new Float32Array((LUT + 1) * 3);
    for (let i = 0; i <= LUT; i++) {
      const u = i / LUT;
      curve.getPointAt(u, _p);
      curve.getTangentAt(u, _t);
      _p.toArray(this.pts, i * 3);
      _t.toArray(this.tans, i * 3);
    }
    // each particle's fixed place in the stream and a small sideways jitter
    this.offsets = new Float32Array(this.count * 3);
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < this.count; k++) {
      this.offsets[k * 3] = (k + rnd() * 0.6) / this.count;
      this.offsets[k * 3 + 1] = rnd() * 2 - 1;
      this.offsets[k * 3 + 2] = rnd() * 2 - 1;
    }
    this.mat = new MeshBasicMaterial({ color: new Color(lang.color), transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    this.mesh = new InstancedMesh(geometryFor(lang.style, lang.size * (def.scale ?? 1)), this.mat, this.count);
    this.mesh.name = `flow-${def.id}`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  /**
   * Place the particles: `phase` is the integral of the flow rate (from the model); `opacity`
   * comes from the flow's channel. A flow at rest stays where it stopped.
   */
  update(phase: number, opacity: number) {
    this.opacity = opacity;
    this.mesh.visible = opacity > 0.003;
    if (!this.mesh.visible) return;
    this.mat.opacity = opacity;
    const travel = (phase * this.pace) / Math.max(0.01, this.length);
    const style = LANGUAGE[this.kind].style;
    for (let k = 0; k < this.count; k++) {
      let u = this.offsets[k * 3] + travel;
      u -= Math.floor(u);
      const f = u * LUT;
      const i = Math.min(LUT - 1, Math.floor(f));
      const a = f - i;
      _p.set(this.pts[i * 3], this.pts[i * 3 + 1], this.pts[i * 3 + 2]).lerp(_s.set(this.pts[i * 3 + 3], this.pts[i * 3 + 4], this.pts[i * 3 + 5]), a);
      _t.set(this.tans[i * 3], this.tans[i * 3 + 1], this.tans[i * 3 + 2]);
      if (this.spread > 0) {
        // wander across the stream, perpendicular to the path
        _s.crossVectors(_t, UP);
        if (_s.lengthSq() < 1e-6) _s.set(1, 0, 0);
        _s.normalize();
        _p.addScaledVector(_s, this.offsets[k * 3 + 1] * this.spread);
        _s.cross(_t).normalize();
        _p.addScaledVector(_s, this.offsets[k * 3 + 2] * this.spread);
      }
      // fade in at the start and out at the end of an open path
      let sc = 1;
      if (!this.closed) sc = Math.min(1, u * 12, (1 - u) * 12);
      if (style === 'puff') sc *= 0.7 + 0.6 * u;
      _q.setFromUnitVectors(UP, _t);
      _m.compose(_p, _q, _s.set(sc, sc, sc));
      this.mesh.setMatrixAt(k, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.mesh.removeFromParent();
  }
}

export class Flows {
  group = new Group();
  flows = new Map<string, Flow>();
  constructor(parent: Object3D) {
    this.group.name = 'flows';
    parent.add(this.group);
  }
  add(def: FlowDef, density = 1): Flow {
    const f = new Flow(def, this.group, density);
    this.flows.set(def.id, f);
    return f;
  }
  get(id: string) {
    return this.flows.get(id);
  }
}
