/** Run a scenario's (or fault's) program live on the car. */
import { NO_FAULTS } from '../../sim/car';
import type { ScenarioProgram } from '../../content/scenarios';
import type { World } from '../../world/world';

export function runScenario(world: World, p: ScenarioProgram) {
  world.setLive({
    id: 'scenario',
    start: p.start,
    drive: p.drive,
    timeScale: p.timeScale,
    loop: p.loop,
    setup: (car) => {
      car.road = { mu: 1, ...(p.road ?? {}) };
      car.faults = { ...NO_FAULTS, ...(p.faults ?? {}) };
    },
  });
}
