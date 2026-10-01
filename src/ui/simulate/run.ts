/** Run a scenario's (or fault's) program live on the car: a complete run, nothing inherited. */
import type { ScenarioProgram } from '../../content/scenarios';
import type { RunSpec } from '../../sim/run';
import type { World } from '../../world/world';

export function scenarioRun(id: string, p: ScenarioProgram): RunSpec {
  return { id: `scenario:${id}`, ...p };
}

export function runScenario(world: World, id: string, p: ScenarioProgram) {
  world.setLive(scenarioRun(id, p));
}
