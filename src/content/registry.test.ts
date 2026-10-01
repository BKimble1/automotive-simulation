import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import { BY_ID, COMPONENTS, childrenOf, nodesOf, pathTo, search, SYSTEMS } from './registry';
import { buildCar } from '../scene/car/build';
import { VIEWS } from '../world/views';
import { LESSONS } from './lessons';

function car() {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(9), 3));
  g.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  return buildCar(g);
}

/** Scene components that are groupings rather than things to read about. */
const GROUPS = new Set(['front-suspension', 'rear-suspension']);

describe('component registry', () => {
  it('has unique, kebab-case ids', () => {
    const ids = COMPONENTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('has ten systems, each with assemblies, each assembly with parts', () => {
    expect(SYSTEMS.length).toBe(10);
    for (const s of SYSTEMS) {
      const asm = childrenOf(s.id);
      expect(asm.length, s.id).toBeGreaterThan(0);
      for (const a of asm) {
        expect(a.kind).toBe('assembly');
        expect(childrenOf(a.id).length, a.id).toBeGreaterThan(0);
      }
    }
  });

  it('links only to entries that exist, and every entry is complete', () => {
    for (const c of COMPONENTS) {
      if (c.parent) expect(BY_ID.has(c.parent), `${c.id} → ${c.parent}`).toBe(true);
      for (const n of c.neighbours) expect(BY_ID.has(n), `${c.id} neighbour ${n}`).toBe(true);
      expect(c.function.length, c.id).toBeGreaterThan(20);
      if (c.kind === 'part') {
        expect(c.location.length, c.id).toBeGreaterThan(5);
        expect(c.material.length, c.id).toBeGreaterThan(3);
        expect(c.failures.length, c.id).toBeGreaterThan(0);
      }
      if (c.shot) expect(VIEWS[c.shot], `${c.id} shot ${c.shot}`).toBeDefined();
    }
  });

  it('names lessons that exist', () => {
    const known = new Set([...Object.keys(LESSONS)]);
    const missing = COMPONENTS.filter((c) => c.animation && !known.has(c.animation)).map((c) => `${c.id}:${c.animation}`);
    expect(missing).toEqual([]);
  });

  it('draws every entry with real scene parts, and covers every scene component', () => {
    const { rig } = car();
    const byComponent = (id: string) => (rig.byComponent.get(id) ?? []).map((n) => n.name);
    for (const c of COMPONENTS) {
      const nodes = nodesOf(c.id, byComponent);
      expect(nodes.length, c.id).toBeGreaterThan(0);
      for (const n of nodes) expect(rig.parts.has(n), `${c.id} node ${n}`).toBe(true);
      // never the whole car or a corner group
      expect(nodes).not.toContain('sprung');
    }
    const uncovered = [...rig.byComponent.keys()].filter((k) => !BY_ID.has(k) && !GROUPS.has(k));
    expect(uncovered).toEqual([]);
  });

  it('gives a path from the system down', () => {
    const p = pathTo('spider-gear').map((c) => c.id);
    expect(p).toEqual(['driveline', 'differential', 'spider-gear']);
  });

  it('finds things by their other names', () => {
    expect(search('bonnet')[0].id).toBe('hood');
    expect(search('crown wheel')[0].id).toBe('ring-gear');
    expect(search('abs')[0].id).toBe('abs-modulator');
    expect(search('sump')[0].id).toBe('oil-pan');
    expect(search('Lambda')[0].id).toBe('oxygen-sensor');
    expect(search('zzzz')).toEqual([]);
  });
});
