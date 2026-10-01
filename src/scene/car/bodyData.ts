/**
 * Loads the baked body skin (scripts/bake-body.mjs): gzip data in a .bin file, unpacked in the
 * browser with DecompressionStream, into a BufferGeometry in vehicle coordinates.
 */
import { BufferAttribute, BufferGeometry, Sphere, Box3, Vector3 } from 'three';
import hiUrl from './baked/body-hi.bin?url';
import loUrl from './baked/body-lo.bin?url';

export type BodyLod = 'hi' | 'lo';

/** Unpack gzip data; a server may already have (Content-Encoding), so look at the magic bytes. */
async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const b = new Uint8Array(buf, 0, 2);
  if (!(b[0] === 0x1f && b[1] === 0x8b)) return buf;
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return await new Response(stream).arrayBuffer();
}

export function decodeBody(raw: ArrayBuffer): BufferGeometry {
  const dv = new DataView(raw);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'FOB1') throw new Error('body: not a baked body file');
  const nv = dv.getUint32(4, true);
  const ni = dv.getUint32(8, true);
  const b: number[] = [];
  for (let a = 0; a < 6; a++) b.push(dv.getFloat32(12 + a * 4, true));
  let o = 36;
  const pos = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++)
    for (let a = 0; a < 3; a++) {
      const q = dv.getInt16(o, true);
      o += 2;
      pos[i * 3 + a] = b[a] + ((q + 32767) / 65534) * (b[a + 3] - b[a]);
    }
  const nrm = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    let u = dv.getInt16(o, true) / 32767;
    let v = dv.getInt16(o + 2, true) / 32767;
    o += 4;
    let z = 1 - Math.abs(u) - Math.abs(v);
    if (z < 0) {
      const ou = u;
      u = (1 - Math.abs(v)) * (ou >= 0 ? 1 : -1);
      v = (1 - Math.abs(ou)) * (v >= 0 ? 1 : -1);
    }
    const l = Math.hypot(u, v, z) || 1;
    nrm[i * 3] = u / l;
    nrm[i * 3 + 1] = v / l;
    nrm[i * 3 + 2] = z / l;
  }
  const ind = new Uint32Array(raw, o, ni).slice();
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nrm, 3));
  g.setIndex(new BufferAttribute(ind, 1));
  g.boundingBox = new Box3(new Vector3(b[0], b[1], b[2]), new Vector3(b[3], b[4], b[5]));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new Sphere());
  return g;
}

const cache = new Map<BodyLod, Promise<BufferGeometry>>();

export function loadBody(lod: BodyLod): Promise<BufferGeometry> {
  let p = cache.get(lod);
  if (!p) {
    p = fetch(lod === 'hi' ? hiUrl : loUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`body: ${r.status}`);
        return r.arrayBuffer();
      })
      .then(gunzip)
      .then(decodeBody);
    cache.set(lod, p);
  }
  return p;
}
