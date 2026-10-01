import { describe, expect, it } from 'vitest';
import { Channels, phaseOf } from './channels';

const run = (c: Channels, seconds: number, dt = 1 / 60, each?: (t: number) => void) => {
  for (let t = 0; t < seconds; t += dt) {
    c.update(dt);
    each?.(t);
  }
};

describe('scene channels', () => {
  it('classifies moves into phases', () => {
    expect(phaseOf('flow:torque', 1, 0)).toBe('overlay-out');
    expect(phaseOf('flow:torque', 0, 1)).toBe('overlay-in');
    expect(phaseOf('body:hood', 0, 1)).toBe('reveal');
    expect(phaseOf('body:doorFL', 1, 0)).toBe('cover');
    expect(phaseOf('dim', 0, 1)).toBe('ambient');
  });

  it('reveals the next view before it covers the last: solid bodywork never fills the picture mid-move', () => {
    const c = new Channels();
    c.set('body:doorFL', 1);
    c.set('flow:cabinAir', 1);
    c.to({ 'body:hood': 1, 'flow:coolant': 1 });
    let hoodOpenWhileDoorGhosted = false;
    let bothSolid = false;
    run(c, 6, 1 / 60, () => {
      const hood = c.get('body:hood');
      const door = c.get('body:doorFL');
      if (hood > 0.5 && door > 0.5) hoodOpenWhileDoorGhosted = true;
      if (hood < 0.2 && door < 0.2) bothSolid = true;
    });
    expect(hoodOpenWhileDoorGhosted).toBe(true);
    expect(bothSolid).toBe(false);
    expect(c.get('body:hood')).toBe(1);
    expect(c.get('body:doorFL')).toBe(0);
    expect(c.get('flow:coolant')).toBe(1);
    expect(c.busy).toBe(false);
  });

  it('takes overlays away first and brings the new ones last', () => {
    const c = new Channels();
    c.set('flow:a', 1);
    c.to({ 'cut:engine': 1, 'flow:b': 1 });
    let aGoneBeforeCut = true;
    let bAfterCut = true;
    run(c, 6, 1 / 60, () => {
      if (c.get('cut:engine') > 0.05 && c.get('flow:a') > 0.5) aGoneBeforeCut = false;
      if (c.get('flow:b') > 0.05 && c.get('cut:engine') < 0.5) bAfterCut = false;
    });
    expect(aGoneBeforeCut).toBe(true);
    expect(bAfterCut).toBe(true);
  });

  it('reverses a move mid-way from its value, without a jump', () => {
    const c = new Channels();
    c.to({ 'ghost:engine': 1 });
    run(c, 0.4);
    const before = c.get('ghost:engine');
    c.to({});
    c.update(1 / 60);
    expect(Math.abs(c.get('ghost:engine') - before)).toBeLessThan(0.05);
    run(c, 5);
    expect(c.get('ghost:engine')).toBe(0);
  });

  it('lets a move already heading to the same value run on', () => {
    const c = new Channels();
    c.to({ 'show:road': 1 });
    run(c, 0.3);
    const v = c.get('show:road');
    c.to({ 'show:road': 1 });
    c.update(1 / 60);
    expect(c.get('show:road')).toBeGreaterThanOrEqual(v);
  });
});
