/**
 * The rig: every drawn part of the car, registered once with an immutable local baseline.
 *
 * A part's transform is recomputed from scratch every frame as
 *
 *     position = baseline.position + mechanism offset + explode offset × explode amount
 *     rotation = explode rotation^amount × mechanism rotation × baseline.rotation
 *
 * The mechanism (src/world/mechanism.ts) writes only the offsets of the parts it moves, from
 * the car's model state; the explode amounts come from the scene channels. Nothing is ever
 * accumulated into a transform, so explode → reassemble any number of times, or any
 * interruption, returns every part exactly to its baseline (tested in rig.test.ts).
 */
import { Box3, BufferGeometry, Group, Mesh, Object3D, Plane, Quaternion, Vector3 } from 'three';
import { makePair, type MatKind, type MatPair } from '../materials';

export interface Baseline {
  readonly p: Vector3;
  readonly q: Quaternion;
  readonly s: Vector3;
}

export interface Explode {
  group: string;
  offset: Vector3;
  q: Quaternion | null;
  delay: number;
}

export interface PartNode {
  /** Unique node name (stable; tests and the registry refer to it). */
  name: string;
  /** Component id in the content registry. */
  component: string;
  /** Assembly (highlight and ghost group). */
  assembly: string;
  object: Object3D;
  base: Baseline;
  /** Mechanism offsets, parent space (reset to identity by the mechanism when it stops driving),
   * and a scale along the part's own axes (a spring compressing). */
  mp: Vector3;
  mq: Quaternion;
  ms: Vector3;
  /**
   * Explodes: for each channel that moves this part, the offset at full amount (parent space),
   * an optional rotation, and a delay (0 … 0.6) within the channel, so parts leave in order.
   */
  explodes: Explode[];
  meshes: Mesh[];
  mats: MatPair[];
}

export class Rig {
  parts = new Map<string, PartNode>();
  byComponent = new Map<string, PartNode[]>();
  byAssembly = new Map<string, PartNode[]>();
  /** Material pairs per (assembly, kind). */
  private matCache = new Map<string, MatPair>();
  allMats: MatPair[] = [];
  /** Section planes by assembly (assemblies that can be cut away). */
  clips = new Map<string, Plane>();
  /** Which section plane cuts a material group (its assembly, or a named group), or none; the
   * part's name lets moving parts stay whole inside a cut housing. */
  clipOf: (group: string, part?: string) => string | null = () => null;

  /**
   * A material pair. Shared (cached by group, kind and colour) unless `part` is given: every
   * part has its own pair, so its ghosting, highlight, heat and fading are its own.
   */
  mat(assembly: string, kind: MatKind, color?: string, part?: string): MatPair {
    const key = `${assembly}|${kind}|${color ?? ''}`;
    let m = part ? undefined : this.matCache.get(key);
    if (!m) {
      const cut = this.clipOf(assembly, part);
      let plane: Plane | undefined;
      if (cut) {
        plane = this.clips.get(cut);
        if (!plane) {
          plane = new Plane(new Vector3(1, 0, 0), 1000);
          this.clips.set(cut, plane);
        }
      }
      m = makePair(kind, { color, clip: plane });
      if (!part) this.matCache.set(key, m);
      this.allMats.push(m);
    }
    return m;
  }

  /**
   * Make a part: one group whose origin is its pivot (in its parent's space), holding one mesh
   * per material kind. Geometry is given in the parent's space and moved to the pivot.
   */
  part(
    parent: Object3D,
    name: string,
    component: string,
    assembly: string,
    /** [material kind, geometry, colour override, material group override (its own highlight/heat)] */
    geos: [MatKind, BufferGeometry, string?, string?][],
    opts: {
      pivot?: Vector3;
      /** Geometry is already in the part's own frame; place the part at `pivot`, turned by `quat`. */
      local?: boolean;
      quat?: Quaternion;
      explode?: Vector3;
      explodeQ?: Quaternion;
      explodeGroup?: string;
      explodeDelay?: number;
      shadow?: boolean;
      receive?: boolean;
      renderOrder?: number;
    } = {},
  ): PartNode {
    if (this.parts.has(name)) throw new Error(`rig: part "${name}" registered twice`);
    const g = new Group();
    g.name = name;
    const pivot = opts.pivot ?? new Vector3();
    g.position.copy(pivot);
    if (opts.quat) g.quaternion.copy(opts.quat);
    const meshes: Mesh[] = [];
    const mats: MatPair[] = [];
    for (const [kind, geo, color, group] of geos) {
      if (!opts.local) geo.translate(-pivot.x, -pivot.y, -pivot.z);
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      const pair = this.mat(group ?? assembly, kind, color, name);
      const m = new Mesh(geo, pair.opaque);
      m.name = `${name}:${kind}`;
      // only parts large enough to darken the floor cast shadows (a cheaper shadow pass)
      m.castShadow = opts.shadow ?? (geo.boundingSphere?.radius ?? 0) > 0.14;
      m.userData.casts = m.castShadow;
      m.receiveShadow = opts.receive ?? true;
      if (opts.renderOrder !== undefined) m.renderOrder = opts.renderOrder;
      m.userData.part = name;
      m.userData.pair = pair;
      g.add(m);
      meshes.push(m);
      if (!mats.includes(pair)) mats.push(pair);
    }
    parent.add(g);
    return this.adopt(g, name, component, assembly, meshes, mats, opts);
  }

  /** Register an existing object (built elsewhere) as a part. */
  adopt(
    object: Object3D,
    name: string,
    component: string,
    assembly: string,
    meshes: Mesh[],
    mats: MatPair[],
    opts: { explode?: Vector3; explodeQ?: Quaternion; explodeGroup?: string; explodeDelay?: number } = {},
  ): PartNode {
    const node: PartNode = {
      name,
      component,
      assembly,
      object,
      base: Object.freeze({ p: object.position.clone(), q: object.quaternion.clone(), s: object.scale.clone() }),
      mp: new Vector3(),
      mq: new Quaternion(),
      ms: new Vector3(1, 1, 1),
      explodes: opts.explodeGroup ? [{ group: opts.explodeGroup, offset: opts.explode ?? new Vector3(), q: opts.explodeQ ?? null, delay: opts.explodeDelay ?? 0 }] : [],
      meshes,
      mats,
    };
    // the baseline can never be changed after registration
    Object.freeze(node.base.p);
    Object.freeze(node.base.q);
    Object.freeze(node.base.s);
    this.parts.set(name, node);
    const c = this.byComponent.get(component) ?? [];
    c.push(node);
    this.byComponent.set(component, c);
    const a = this.byAssembly.get(assembly) ?? [];
    a.push(node);
    this.byAssembly.set(assembly, a);
    return node;
  }

  /** Add an explode channel to a part. */
  explode(n: PartNode, group: string, offset: Vector3, opts: { q?: Quaternion; delay?: number } = {}) {
    n.explodes.push({ group, offset, q: opts.q ?? null, delay: opts.delay ?? 0 });
  }

  /** Recompose every part's transform from its baseline, mechanism offsets and explode amounts. */
  apply(explodeAmount: (group: string) => number) {
    for (const n of this.parts.values()) {
      const o = n.object;
      o.position.copy(n.base.p).add(n.mp);
      o.quaternion.copy(n.mq).multiply(n.base.q);
      for (const ex of n.explodes) {
        const e0 = explodeAmount(ex.group);
        if (e0 <= 0) continue;
        // staggered: a part with a delay starts later and arrives with the rest
        const e = ex.delay > 0 ? Math.min(1, Math.max(0, (e0 - ex.delay) / (1 - ex.delay))) : e0;
        const s = e * e * (3 - 2 * e);
        o.position.addScaledVector(ex.offset, s);
        if (ex.q && s > 0) {
          _q.identity().slerp(ex.q, s);
          o.quaternion.premultiply(_q);
        }
      }
      o.scale.copy(n.base.s).multiply(n.ms);
    }
  }

  /** Reset every mechanism offset to identity. */
  resetMechanism() {
    for (const n of this.parts.values()) {
      n.mp.set(0, 0, 0);
      n.mq.identity();
      n.ms.set(1, 1, 1);
    }
  }

  /** Ghost (x-ray) an assembly: 0 solid … 1 a faint shell. Swaps to the ghost variant above 0. */
  setGhost(assembly: string, g: number) {
    for (const n of this.byAssembly.get(assembly) ?? []) this.setPartGhost(n, g);
  }

  setPartGhost(n: PartNode, g: number, hide = 0) {
    for (const m of n.meshes) {
      const pair = m.userData.pair as MatPair | undefined;
      if (!pair) continue;
      pair.u.uGhost.value = g;
      pair.u.uHide.value = hide;
      m.material = g > 0.001 || hide > 0.001 ? pair.ghost : pair.opaque;
      m.castShadow = g < 0.5 && hide < 0.5 && m.userData.casts === true;
    }
  }


  /** World bounds of a set of parts (as currently placed). */
  bounds(nodes: PartNode[], out = new Box3()): Box3 {
    out.makeEmpty();
    for (const n of nodes) for (const m of n.meshes) if (m.geometry.boundingBox) out.union(_b.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld));
    return out;
  }
}

const _q = new Quaternion();
const _b = new Box3();
