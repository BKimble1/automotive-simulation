/**
 * Resource ownership: everything the world builds (geometry, materials and their inactive
 * variants, textures, render targets) is released exactly once when the world goes. Shared
 * resources (the material caches every part draws from, the environment) are found through the
 * scene and still disposed once, because each is collected into a set before anything is freed.
 */
import type { BufferGeometry, Material, Object3D, Texture } from 'three';

type Disposable = { dispose(): void };

function texturesOf(m: Material, out: Set<Texture>) {
  for (const v of Object.values(m as unknown as Record<string, unknown>)) {
    if (v && (v as Texture).isTexture) out.add(v as Texture);
  }
  const u = (m as unknown as { uniforms?: Record<string, { value: unknown }> }).uniforms;
  if (u) for (const k of Object.keys(u)) {
    const v = u[k]?.value;
    if (v && (v as Texture).isTexture) out.add(v as Texture);
  }
}

/** Collect a tree's resources, including material variants kept in `userData` (ghost, section). */
export function collect(root: Object3D, extra: Material[] = []) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>(extra);
  const textures = new Set<Texture>();
  const addMat = (m: unknown) => {
    if (!m) return;
    if (Array.isArray(m)) m.forEach(addMat);
    else if ((m as Material).isMaterial) materials.add(m as Material);
  };
  root.traverse((o) => {
    const mesh = o as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };
    if (mesh.geometry) geometries.add(mesh.geometry);
    addMat(mesh.material);
    const pair = o.userData?.pair as Record<string, unknown> | undefined;
    if (pair) for (const v of Object.values(pair)) addMat(v);
    const mats = o.userData?.mats as Record<string, unknown> | undefined;
    if (mats) for (const v of Object.values(mats)) addMat(v);
  });
  for (const m of materials) texturesOf(m, textures);
  return { geometries, materials, textures };
}

/** Dispose a tree's resources once each; returns the counts (for the resource telemetry). */
export function disposeTree(root: Object3D, extra: Material[] = []): { geometries: number; materials: number; textures: number } {
  const r = collect(root, extra);
  for (const set of [r.geometries, r.materials, r.textures] as Set<Disposable>[]) for (const x of set) x.dispose();
  return { geometries: r.geometries.size, materials: r.materials.size, textures: r.textures.size };
}
