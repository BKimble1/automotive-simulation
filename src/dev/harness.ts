/**
 * Development harness (?dev=1, development builds only): the studio and the car with orbit
 * controls, and hooks for stills (window.__dev.view(...)) used while modelling.
 */
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Stage } from '../scene/stage';
import { Studio } from '../scene/studio';
import { loadBody } from '../scene/car/bodyData';
import { buildBody, setGhost } from '../scene/car/body';
import { LAMPS } from '../scene/car/bodyMaterial';

export async function startHarness(canvas: HTMLCanvasElement) {
  const stage = new Stage(canvas);
  const studio = new Studio();
  stage.scene.add(studio.group);
  const lod = new URLSearchParams(location.search).get('lod') === 'hi' ? 'hi' : 'lo';
  const g = await loadBody(lod);
  const body = buildBody(g);
  stage.scene.add(body.root);
  const cam = stage.camera;
  cam.position.set(5.2, 1.6, -4.6);
  const controls = new OrbitControls(cam, canvas);
  controls.target.set(0, 0.6, 0);
  controls.update();
  const resize = () => stage.resize(canvas.clientWidth, canvas.clientHeight);
  resize();
  window.addEventListener('resize', resize);
  let running = true;
  const loop = () => {
    if (!running) return;
    controls.update();
    stage.render(1 / 60);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const w = window as unknown as Record<string, unknown>;
  w.__dev = {
    stage,
    body,
    studio,
    lamps: LAMPS,
    view(px: number, py: number, pz: number, tx: number, ty: number, tz: number, fov = 30) {
      cam.position.set(px, py, pz);
      controls.target.set(tx, ty, tz);
      cam.fov = fov;
      cam.updateProjectionMatrix();
      controls.update();
      stage.render(1 / 60);
    },
    ghost(name: string, v: number) {
      for (const p of body.panels) if (name === '*' || p.name === name) setGhost(p, v);
      stage.render(1 / 60);
    },
    move(name: string, x: number, y: number, z: number) {
      for (const p of body.panels) if (p.name === name) p.group.position.set(x, y, z);
      stage.render(1 / 60);
    },
    stop() {
      running = false;
    },
    render() {
      stage.render(1 / 60);
    },
    stats: () => ({ ...stage.stats }),
    ready: true,
  };
  return stage;
}
