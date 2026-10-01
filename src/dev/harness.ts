/**
 * Development harness (?dev=1, development builds only): the studio and the whole car with
 * orbit controls, the car model running, and hooks for stills (window.__dev) used while
 * modelling: views, ghosting, explode amounts, model inputs.
 */
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Stage } from '../scene/stage';
import { Studio } from '../scene/studio';
import { loadBody } from '../scene/car/bodyData';
import { setGhost } from '../scene/car/body';
import { LAMPS } from '../scene/car/bodyMaterial';
import { buildCar } from '../scene/car/build';
import { Mechanism, emptyView, interpolate } from '../world/mechanism';
import { Car as CarModel, presetIdle } from '../sim/car';

export async function startHarness(canvas: HTMLCanvasElement) {
  const stage = new Stage(canvas);
  const studio = new Studio();
  stage.scene.add(studio.group);
  const lod = new URLSearchParams(location.search).get('lod') === 'hi' ? 'hi' : 'lo';
  const g = await loadBody(lod);
  const car = buildCar(g);
  stage.scene.add(car.root);
  const mech = new Mechanism(car);
  const model = new CarModel(presetIdle());
  model.inputs.ignition = true;
  const view = emptyView();
  const explode: Record<string, number> = {};
  let timeScale = 1;
  const cam = stage.camera;
  cam.position.set(5.2, 1.6, -4.6);
  const controls = new OrbitControls(cam, canvas);
  controls.target.set(0, 0.6, 0);
  controls.update();
  const resize = () => stage.resize(canvas.clientWidth, canvas.clientHeight);
  resize();
  window.addEventListener('resize', resize);
  const step = (dt: number) => {
    const a = model.advance(dt * timeScale);
    interpolate(model.prev, model.s, a, view, { brakeN: model.inputs.brakeN, throttle: model.inputs.throttle, cranking: model.inputs.start && model.s.engine !== 'running' });
    car.rig.resetMechanism();
    mech.pose(view);
    car.rig.apply((gname) => explode[gname] ?? 0);
  };
  let running = true;
  let last = performance.now();
  const loop = () => {
    if (!running) return;
    const now = performance.now();
    step(Math.min(0.05, (now - last) / 1000));
    last = now;
    controls.update();
    stage.render(1 / 60);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const w = window as unknown as Record<string, unknown>;
  w.__dev = {
    stage,
    car,
    model,
    studio,
    lamps: LAMPS,
    view(px: number, py: number, pz: number, tx: number, ty: number, tz: number, fov = 30) {
      cam.position.set(px, py, pz);
      controls.target.set(tx, ty, tz);
      cam.fov = fov;
      cam.updateProjectionMatrix();
      controls.update();
    },
    /** Ghost the body ('*' all panels or one panel name) or an assembly of parts. */
    ghost(name: string, v: number) {
      let hit = false;
      for (const p of car.body.panels)
        if (name === '*' || name === 'body' || p.name === name) {
          setGhost(p, v);
          hit = true;
        }
      if (!hit) car.rig.setGhost(name, v);
    },
    explode(group: string, v: number) {
      explode[group] = v;
    },
    step(n = 1, dt = 1 / 30) {
      for (let i = 0; i < n; i++) step(dt);
    },
    timeScale(s: number) {
      timeScale = s;
    },
    stop() {
      running = false;
    },
    render() {
      stage.render(1 / 60);
    },
    stats: () => ({ ...stage.stats, parts: car.rig.parts.size, mats: car.rig.allMats.length }),
    ready: true,
  };
  return stage;
}
