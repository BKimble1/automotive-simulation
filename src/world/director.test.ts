import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { Director as CameraDirector } from '../scene/camera/director';
import { Channels } from '../scene/channels';
import { AnimationDirector } from './director';
import { KEEP_OUT, VIEWS, type View } from './views';

function rig(ready = () => true) {
  const cam = new PerspectiveCamera(30, 16 / 9, 0.05, 200);
  const camera = new CameraDirector(cam);
  camera.viewW = 1600;
  camera.viewH = 900;
  camera.obstacles = () => KEEP_OUT;
  const channels = new Channels();
  const director = new AnimationDirector(camera, channels, { ready: () => ready(), focus: () => {} });
  const step = (dt = 1 / 60) => {
    director.update(dt);
    channels.update(dt);
    camera.update(dt, dt);
  };
  return { cam, camera, channels, director, step };
}

const runUntilSettled = (r: ReturnType<typeof rig>, max = 20) => {
  for (let t = 0; t < max && !(r.director.settled && r.director.state !== 'transitioning' && r.director.state !== 'returning'); t += 1 / 60) r.step();
};

describe('animation director', () => {
  it('places the first picture instantly, with every channel at its target', () => {
    const r = rig();
    r.director.request(VIEWS['sys-cooling']);
    r.step();
    for (const [k, v] of Object.entries(VIEWS['sys-cooling'].channels)) expect(r.channels.get(k)).toBe(v);
    expect(r.camera.moving).toBe(false);
  });

  it('ends a transition in exactly the view’s channel state, and does not restart for the same view', () => {
    const r = rig();
    r.director.request(VIEWS.hero);
    r.step();
    r.director.request(VIEWS['sys-brakes']);
    const n = r.director.transitions;
    for (let i = 0; i < 30; i++) r.step();
    r.director.request(VIEWS['sys-brakes']);
    expect(r.director.transitions).toBe(n);
    runUntilSettled(r);
    expect(r.director.state).toBe('free-explore');
    for (const k of r.channels.active()) expect(r.channels.get(k)).toBe(VIEWS['sys-brakes'].channels[k] ?? 0);
  });

  it('interrupts a move from what is on screen: no jump in position or speed', () => {
    const r = rig();
    r.director.request(VIEWS.hero);
    r.step();
    r.director.request(VIEWS['sys-cooling']);
    for (let i = 0; i < 40; i++) r.step();
    const p0 = r.cam.position.clone();
    r.step();
    const p1 = r.cam.position.clone();
    const vBefore = p1.clone().sub(p0);
    // a new request mid-move
    r.director.request(VIEWS['sys-brakes']);
    r.step();
    const p2 = r.cam.position.clone();
    const vAfter = p2.clone().sub(p1);
    // the frame after the request moves about as far, in about the same direction, as before
    expect(vAfter.length()).toBeLessThan(vBefore.length() * 1.6 + 0.004);
    expect(vAfter.angleTo(vBefore)).toBeLessThan(0.6);
    // and the channels continue from their values
    runUntilSettled(r);
    expect(r.director.view?.id).toBe('sys-brakes');
  });

  it('holds the picture while a view’s assets are not ready, then goes', () => {
    let ready = false;
    const r = rig(() => ready);
    r.director.request(VIEWS.hero);
    r.step();
    const p = r.cam.position.clone();
    r.director.request(VIEWS.xray);
    expect(r.director.state).toBe('preparing');
    for (let i = 0; i < 10; i++) r.step();
    expect(r.cam.position.distanceTo(p)).toBeLessThan(0.05);
    ready = true;
    r.step();
    expect(r.director.state).toBe('transitioning');
  });

  it('pauses and resumes without moving; nothing it is asked releases the pause', () => {
    const r = rig();
    r.director.request(VIEWS.hero);
    r.step();
    r.director.request(VIEWS['sys-power']);
    for (let i = 0; i < 20; i++) r.step();
    r.director.setPaused(true);
    expect(r.director.state).toBe('paused');
    // the world gives a paused director no time: the move holds where it is
    const p0 = r.cam.position.clone();
    for (let i = 0; i < 30; i++) r.step(0);
    expect(r.cam.position.distanceTo(p0)).toBeLessThan(1e-9);
    r.director.setPaused(false);
    expect(r.director.state).toBe('transitioning');
    runUntilSettled(r);
    // a view asked for while paused moves there (a paused navigation) and arrives still paused
    r.director.setPaused(true);
    r.director.request(VIEWS['sys-brakes']);
    expect(r.director.pausedNavigation).toBe(true);
    expect(r.director.state).toBe('transitioning');
    runUntilSettled(r);
    expect(r.director.paused).toBe(true);
    expect(r.director.state).toBe('paused');
    expect(r.director.pausedNavigation).toBe(false);
  });

  it('never takes the camera into the body or under the floor, between any two views', () => {
    const ids = Object.keys(VIEWS);
    const pairs: [string, string][] = [];
    for (let i = 0; i < ids.length; i++) pairs.push([ids[i], ids[(i * 7 + 3) % ids.length]]);
    const seg = new Vector3();
    const dist = (p: Vector3, a: Vector3, b: Vector3) => {
      seg.subVectors(b, a);
      const t = Math.max(0, Math.min(1, seg.dot(p.clone().sub(a)) / seg.lengthSq()));
      return p.distanceTo(a.clone().addScaledVector(seg, t));
    };
    let worst = Infinity;
    let worstAt = '';
    for (const [a, b] of pairs) {
      const r = rig();
      r.director.request(VIEWS[a] as View);
      r.step();
      r.director.request(VIEWS[b] as View);
      for (let t = 0; t < 4; t += 1 / 30) {
        r.step(1 / 30);
        const p = r.cam.position;
        expect(p.y, `${a}→${b} floor`).toBeGreaterThan(0.07);
        for (const k of KEEP_OUT) {
          const d = dist(p, k.a, k.b) - k.r;
          if (d < worst) {
            worst = d;
            worstAt = `${a}→${b}`;
          }
        }
      }
    }
    expect(worst, worstAt).toBeGreaterThan(-0.02);
  });
});
