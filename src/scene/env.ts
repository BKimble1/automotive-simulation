/**
 * The reflection environment: a virtual car-photography studio rendered once into a cube map
 * and prefiltered (PMREM). What a car's paint shows is its environment, so this is designed
 * like a real automotive set: a long overhead softbox ("the scrim") that draws a clean line
 * along the shoulders and the roof, two tall strip boxes at the corners for the vertical
 * highlights on the doors, a dim warm bounce from the floor and dark walls everywhere else.
 * It matches the positions of the scene's actual lights (src/scene/studio.ts).
 */
import { BackSide, BoxGeometry, Color, Mesh, MeshBasicMaterial, PlaneGeometry, PMREMGenerator, Scene, type Texture, type WebGLRenderer } from 'three';

function panel(w: number, h: number, color: string, intensity: number): Mesh {
  const m = new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity), side: 2 });
  return new Mesh(new PlaneGeometry(w, h), m);
}

export function buildEnvironment(renderer: WebGLRenderer): Texture {
  const scene = new Scene();
  scene.background = new Color('#0b0c0f');
  const room = new Mesh(new BoxGeometry(22, 8, 22), new MeshBasicMaterial({ color: new Color('#15171b'), side: BackSide }));
  room.position.y = 3.6;
  scene.add(room);
  // floor bounce: dim and slightly warm
  const floor = panel(22, 22, '#2b2824', 0.5);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.05;
  scene.add(floor);
  // the scrim: a long soft overhead box along the car, a little forward
  const scrim = panel(7.5, 2.4, '#f4f1ea', 3.2);
  scrim.position.set(0.2, 5.2, 0.2);
  scrim.rotation.x = Math.PI / 2;
  scene.add(scrim);
  // a brighter core in the scrim: the crisp line on the paint
  const core = panel(6.8, 0.5, '#ffffff', 3.6);
  core.position.set(0.2, 5.15, 0.6);
  core.rotation.x = Math.PI / 2;
  scene.add(core);
  // key box, front left (the camera's usual side)
  const key = panel(2.4, 3.4, '#fff4e6', 3.4);
  key.position.set(3.6, 2.6, 4.2);
  key.lookAt(0, 0.8, 0);
  scene.add(key);
  // strip boxes at the rear corners: vertical lines down the doors and quarters
  for (const [x, z] of [
    [-4.6, 3.2],
    [-4.2, -3.6],
    [4.8, -3.4],
  ]) {
    const s = panel(0.5, 4.4, '#e3ebff', 3.8);
    s.position.set(x, 2.2, z);
    s.lookAt(0, 0.9, 0);
    scene.add(s);
  }
  // two broad, dim fills low at the sides: the lower body's surfaces turn into the light
  // instead of falling into black
  for (const z of [-7, 7]) {
    const fill = panel(9, 2.2, '#c9d0dc', 0.55);
    fill.position.set(0.5, 1.4, z);
    fill.lookAt(0, 0.7, 0);
    scene.add(fill);
  }
  // a low horizon strip: a soft line along the lower doors and sills
  const horizon = panel(14, 0.25, '#cfd6e2', 1.6);
  horizon.position.set(0, 0.9, -9);
  scene.add(horizon);
  const horizon2 = panel(14, 0.25, '#cfd6e2', 1.2);
  horizon2.position.set(0, 0.9, 9);
  horizon2.rotation.y = Math.PI;
  scene.add(horizon2);

  const pmrem = new PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.015, 0.1, 40);
  pmrem.dispose();
  scene.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
    }
  });
  return rt.texture;
}
