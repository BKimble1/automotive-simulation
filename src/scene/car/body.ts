/**
 * The body: the baked skin split into its panels (bodyRegions.ts), each a mesh that draws only
 * its own panel (paint and glass), with an opaque and a ghost look. A triangle that a shut line
 * crosses goes to both panels; each discards the other's pixels, so the seam is exact.
 */
import { BufferAttribute, BufferGeometry, Group, Mesh, Vector3 } from 'three';
import { bodyMaterials, type BodyMaterialSet } from './bodyMaterial';
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
    return { name, id, group, paint, glass, mats, centre, ghost: 0 };
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
}
