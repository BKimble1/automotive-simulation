/**
 * The body: the baked skin split into its panels (bodyRegions.ts), each a mesh that draws only
 * its own panel (paint and glass), with an opaque and a ghost look. A triangle that a shut line
 * crosses goes to both panels; each discards the other's pixels, so the seam is exact.
 */
import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshPhysicalMaterial, SphereGeometry, Vector3 } from 'three';
import { bodyMaterials, PAINT_COLOR, type BodyMaterialSet } from './bodyMaterial';
import { merge, rbox } from '../geo/shapes';
import { PANELS, panelOf, type PanelName } from './bodyRegions';

export interface BodyPanel {
  name: PanelName;
  id: number;
  group: Group;
  paint: Mesh;
  glass: Mesh;
  mats: BodyMaterialSet;
  /** Centre of the panel's geometry (vehicle coordinates), for the camera and labels. */
  centre: Vector3;
  ghost: number;
  /** Separate meshes that belong to the panel (a door's mirror), with their own two looks. */
  extras: { mesh: Mesh; opaque: MeshPhysicalMaterial; ghost: MeshPhysicalMaterial }[];
}

/** A look for the parts mounted on a panel: opaque, and a ghost that fades with the panel. */
function extraLook(params: ConstructorParameters<typeof MeshPhysicalMaterial>[0]): { opaque: MeshPhysicalMaterial; ghost: MeshPhysicalMaterial } {
  return { opaque: new MeshPhysicalMaterial(params), ghost: new MeshPhysicalMaterial({ ...params, transparent: true, depthWrite: false, opacity: 0.12 }) };
}

/**
 * A door mirror (vehicle coordinates, right side for s = 1): a body-colour housing, a gloss
 * black arm from the door and the dark mirror glass facing back. It rides on its door.
 */
function mirror(s: 1 | -1) {
  const housing = new SphereGeometry(1, 28, 16);
  housing.scale(0.062, 0.046, 0.094);
  // flatten the back (where the glass sits) and sharpen the front a little
  const p = housing.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    if (x < -0.012) p.setX(i, -0.012 + (x + 0.012) * 0.25);
    else p.setX(i, x * (1 + 0.15 * Math.max(0, x / 0.062)));
  }
  housing.computeVertexNormals();
  housing.translate(0.835, 1.035, s * 0.975);
  const arm = rbox(0.05, 0.022, 0.1, 0.008, 0.85, 1.012, s * 0.905);
  const glass = rbox(0.004, 0.07, 0.15, 0.0018, 0.818, 1.035, s * 0.977);
  return { housing, arm: merge([arm]), glass };
}

/** Split an indexed geometry into one sub-geometry per panel (shared triangles go to both). */
export function splitPanels(g: BufferGeometry): BufferGeometry[] {
  const pos = g.getAttribute('position') as BufferAttribute;
  const nrm = g.getAttribute('normal') as BufferAttribute;
  const idx = g.getIndex()!.array as Uint32Array;
  const nv = pos.count;
  const vp = new Int8Array(nv);
  for (let i = 0; i < nv; i++) vp[i] = panelOf(pos.getX(i), pos.getY(i), pos.getZ(i));
  const lists: number[][] = PANELS.map(() => []);
  const seen = new Set<number>();
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), p = new Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
    seen.clear();
    seen.add(vp[i0]).add(vp[i1]).add(vp[i2]);
    // edge midpoints and the centre, for shut lines that cut a corner of the triangle
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    for (const [u, v, w] of [
      [0.5, 0.5, 0],
      [0, 0.5, 0.5],
      [0.5, 0, 0.5],
      [1 / 3, 1 / 3, 1 / 3],
    ]) {
      p.set(0, 0, 0).addScaledVector(a, u).addScaledVector(b, v).addScaledVector(c, w);
      seen.add(panelOf(p.x, p.y, p.z));
    }
    for (const s of seen) lists[s].push(i0, i1, i2);
  }
  return lists.map((list) => {
    // compact the vertices this panel uses
    const remap = new Map<number, number>();
    const outPos: number[] = [];
    const outNrm: number[] = [];
    const outIdx = new Uint32Array(list.length);
    for (let k = 0; k < list.length; k++) {
      const v = list[k];
      let r = remap.get(v);
      if (r === undefined) {
        r = outPos.length / 3;
        remap.set(v, r);
        outPos.push(pos.getX(v), pos.getY(v), pos.getZ(v));
        outNrm.push(nrm.getX(v), nrm.getY(v), nrm.getZ(v));
      }
      outIdx[k] = r;
    }
    const pg = new BufferGeometry();
    pg.setAttribute('position', new BufferAttribute(new Float32Array(outPos), 3));
    pg.setAttribute('normal', new BufferAttribute(new Float32Array(outNrm), 3));
    pg.setIndex(new BufferAttribute(outIdx, 1));
    pg.computeBoundingBox();
    pg.computeBoundingSphere();
    return pg;
  });
}

export function buildBody(g: BufferGeometry): { root: Group; panels: BodyPanel[] } {
  const root = new Group();
  root.name = 'body';
  const geos = splitPanels(g);
  const panels: BodyPanel[] = PANELS.map((name, id) => {
    const group = new Group();
    group.name = `body-${name}`;
    const mats = bodyMaterials(id);
    const paint = new Mesh(geos[id], mats.paint);
    paint.castShadow = true;
    paint.receiveShadow = true;
    paint.name = `${name}-paint`;
    const glass = new Mesh(geos[id], mats.glass);
    glass.name = `${name}-glass`;
    glass.renderOrder = 2;
    group.add(paint, glass);
    root.add(group);
    const centre = new Vector3();
    geos[id].boundingBox?.getCenter(centre);
    const extras: BodyPanel['extras'] = [];
    if (name === 'doorFL' || name === 'doorFR') {
      const m = mirror(name === 'doorFR' ? 1 : -1);
      const looks = [
        [m.housing, extraLook({ color: PAINT_COLOR, metalness: 0.6, roughness: 0.36, clearcoat: 1, clearcoatRoughness: 0.075 })],
        [m.arm, extraLook({ color: new Color('#0b0c0e'), metalness: 0, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 })],
        [m.glass, extraLook({ color: new Color('#1a1e24'), metalness: 1, roughness: 0.04 })],
      ] as const;
      for (const [geo, look] of looks) {
        const mesh = new Mesh(geo, look.opaque);
        mesh.castShadow = true;
        mesh.name = `${name}-mirror`;
        mesh.userData.mats = look;
        group.add(mesh);
        extras.push({ mesh, opaque: look.opaque, ghost: look.ghost });
      }
    }
    return { name, id, group, paint, glass, mats, centre, ghost: 0, extras };
  });
  return { root, panels };
}

/** Apply a ghost amount to a panel: swap to the ghost variant above zero. */
export function setGhost(p: BodyPanel, g: number) {
  p.ghost = g;
  p.mats.uniforms.uGhost.value = g;
  const ghosted = g > 0.001;
  p.paint.material = ghosted ? p.mats.paintGhost : p.mats.paint;
  p.glass.material = ghosted ? p.mats.glassGhost : p.mats.glass;
  p.paint.castShadow = g < 0.5;
  // a fully ghosted panel is drawn last, after what it reveals
  p.paint.renderOrder = ghosted ? 5 : 0;
  p.glass.renderOrder = ghosted ? 6 : 2;
  for (const e of p.extras) {
    e.mesh.material = ghosted ? e.ghost : e.opaque;
    e.ghost.opacity = 0.03 + 0.97 * (1 - g) * (1 - g);
    e.mesh.castShadow = g < 0.5;
    e.mesh.renderOrder = ghosted ? 5 : 0;
  }
}
