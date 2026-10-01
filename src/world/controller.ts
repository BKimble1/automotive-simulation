/**
 * The controller: turns the interface's state (the app store) into requests to the world. The
 * interface never moves the camera or the car itself; it says where the visitor wants to be,
 * and the director takes the scene there from whatever is on screen.
 */
import { useApp, type AppState } from '../state/store';
import { LESSONS } from '../content/lessons';
import { FILM } from '../content/film';
import { presetIdle } from '../sim/car';
import { SYSTEM_VIEWS } from './views';
import { viewFor } from './partViews';
import { BY_ID } from '../content/registry';
import { LAB_BY_ID } from '../content/labs';
import { FAULT_BY_ID, SCENARIO_BY_ID } from '../content/scenarios';
import { runScenario } from '../ui/simulate/run';
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
        if (modeChanged) {
          // a shared link may start the film part way (?t=seconds)
          const t = first ? Number(new URLSearchParams(location.search).get('t') ?? 0) : 0;
          world.playSequence(FILM, Number.isFinite(t) ? Math.max(0, t) : 0);
        }
        break;
      case 'explore': {
        if (modeChanged) {
          world.stopSequence();
          world.setLive(IDLE_PROGRAM as never);
        }
        if (modeChanged || s.system !== prev?.system || s.part !== prev?.part || (!s.lesson && prev?.lesson)) {
          // going up the hierarchy reads as returning
          const depth = (st: AppState | null) => (!st?.system ? 0 : !st.part ? 1 : BY_ID.get(st.part)?.kind === 'assembly' ? 2 : 3);
          const returning = !!prev && depth(s) < depth(prev);
          const pv = s.part && world.car ? viewFor(s.part, world.car) : null;
          if (pv) world.request(pv, { instant: first, returning });
          else world.request((s.system && SYSTEM_VIEWS[s.system]) || 'xray', { instant: first, returning });
        }
        break;
      }
      case 'engineer': {
        if (modeChanged) {
          world.stopSequence();
          world.setLive(IDLE_PROGRAM as never);
        }
        if (modeChanged || s.lab !== prev?.lab) {
          const lab = s.lab ? LAB_BY_ID[s.lab] : null;
          if (lab && !modeChanged) world.setLive(IDLE_PROGRAM as never);
          world.request(lab ? lab.view : 'overview', { instant: first, returning: !!prev?.lab && !s.lab });
        }
        break;
      }
      case 'simulate': {
        if (modeChanged) world.stopSequence();
        if (modeChanged || s.scenario !== prev?.scenario) {
          const sc = s.scenario ? (SCENARIO_BY_ID[s.scenario] ?? FAULT_BY_ID[s.scenario]) : null;
          if (sc) runScenario(world, sc.program);
          else world.setLive(IDLE_PROGRAM as never);
          world.request(sc ? sc.view : 'overview', { instant: first, returning: !!prev?.scenario && !s.scenario });
        }
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
