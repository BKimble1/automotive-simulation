/**
 * The controller: turns the interface's state (the app store) into requests to the world. The
 * interface never moves the camera or the car itself; it says where the visitor wants to be,
 * and the director takes the scene there from whatever is on screen.
 */
import { useApp, type AppState } from '../state/store';
import { LESSONS } from '../content/lessons';
import { presetIdle } from '../sim/car';
import { SYSTEM_VIEWS } from './views';
import type { World } from './world';

/** The car idling in Park: the opening and Explore. */
export const IDLE_PROGRAM = {
  id: 'idle',
  start: presetIdle,
  drive: (_t: number, inp: { ignition: boolean; selector: string }) => {
    inp.ignition = true;
    inp.selector = 'P';
  },
};

export function attachController(world: World): () => void {
  const apply = (s: AppState, prev: AppState | null) => {
    const first = prev === null;
    world.camera.reducedMotion = s.reducedMotion;
    world.channels.speed = s.reducedMotion ? 0.6 : 1;
    // a lesson inside Explore ("Show how it works")
    if (s.lesson && (first || s.lesson !== prev?.lesson)) {
      const seq = LESSONS[s.lesson];
      if (seq) {
        world.playSequence(seq);
        return;
      }
    }
    if (!s.lesson && prev?.lesson) {
      world.stopSequence();
      world.setLive(IDLE_PROGRAM as never);
    }
    const modeChanged = first || s.mode !== prev?.mode;
    switch (s.mode) {
      case 'intro':
        if (modeChanged) {
          world.stopSequence();
          world.setLive(IDLE_PROGRAM as never);
          world.request('hero', { instant: first, returning: !first });
        }
        break;
      case 'watch':
        if (modeChanged) world.playSequence(LESSONS.slice);
        break;
      case 'explore': {
        if (modeChanged) {
          world.stopSequence();
          world.setLive(IDLE_PROGRAM as never);
        }
        const v = s.system ? SYSTEM_VIEWS[s.system] : 'xray';
        if (modeChanged || s.system !== prev?.system || (!s.lesson && prev?.lesson)) world.request(v ?? 'xray', { instant: first, returning: !!prev && !s.system && !!prev.system });
        break;
      }
      default:
        if (modeChanged) {
          world.stopSequence();
          world.setLive(IDLE_PROGRAM as never);
          world.request('overview', { instant: first });
        }
    }
  };
  apply(useApp.getState(), null);
  return useApp.subscribe((s, prev) => {
    if (s.mode !== prev.mode || s.system !== prev.system || s.part !== prev.part || s.lesson !== prev.lesson || s.lab !== prev.lab || s.scenario !== prev.scenario || s.reducedMotion !== prev.reducedMotion) apply(s, prev);
  });
}
