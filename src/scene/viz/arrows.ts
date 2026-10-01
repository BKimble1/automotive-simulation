/**
 * Force and torque arrows: a pool of arrows (shaft and head) placed every frame from the
 * model's forces — tyre forces at the contact patches, the load on each tyre, the pedal's push,
 * the brake's clamp. An arrow's length is its force at a stated scale (newtons per metre of
 * arrow), so arrows can be compared; arrows below a threshold are hidden, never jittering.
 */
import { Color, ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, Object3D, Quaternion, Vector3 } from 'three';

const UP = new Vector3(0, 1, 0);

export class Arrow {
  group = new Group();
  shaft: Mesh;
  head: Mesh;
  mat: MeshBasicMaterial;
  private headLen: number;
  constructor(color: string, radius = 0.012) {
    this.headLen = radius * 6;
    this.mat = new MeshBasicMaterial({ color: new Color(color), transparent: true, opacity: 0, depthWrite: false, depthTest: true, toneMapped: false });
    const sg = new CylinderGeometry(radius, radius, 1, 10);
    sg.translate(0, 0.5, 0);
    this.shaft = new Mesh(sg, this.mat);
    const hg = new ConeGeometry(radius * 2.6, radius * 6, 14);
    hg.translate(0, radius * 3, 0);
    this.head = new Mesh(hg, this.mat);
    this.group.add(this.shaft, this.head);
    this.group.renderOrder = 9;
    this.shaft.renderOrder = 9;
    this.head.renderOrder = 9;
    this.group.visible = false;
  }
  /** Point from `origin` along `dir` (any length) for `length` metres. */
  set(origin: Vector3, dir: Vector3, length: number, opacity: number) {
    const show = opacity > 0.01 && length > 0.02;
    this.group.visible = show;
    if (!show) return;
    this.mat.opacity = opacity;
    this.group.position.copy(origin);
    _d.copy(dir).normalize();
    this.group.quaternion.setFromUnitVectors(UP, _d);
    const s = Math.max(0.001, length - this.headLen);
    this.shaft.scale.set(1, s, 1);
    this.head.position.set(0, s, 0);
  }
}
const _d = new Vector3();
void Quaternion;

export class ArrowSet {
  group = new Group();
  arrows = new Map<string, Arrow>();
  constructor(parent: Object3D) {
    this.group.name = 'arrows';
    parent.add(this.group);
  }
  get(id: string, color: string, radius?: number): Arrow {
    let a = this.arrows.get(id);
    if (!a) {
      a = new Arrow(color, radius);
      this.arrows.set(id, a);
      this.group.add(a.group);
    }
    return a;
  }
  hideAll() {
    for (const a of this.arrows.values()) a.group.visible = false;
  }
}
