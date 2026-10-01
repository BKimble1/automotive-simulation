/**
 * What happens inside each cylinder, drawn from the engine model so it agrees with the
 * mechanism exactly: a column of gas between the piston crown and the chamber roof whose colour
 * follows the stroke (fresh air drawn in, the fuel mist after injection, the charge being
 * compressed, the flame front spreading from the plug in step with the burned fraction, the
 * exhaust pushed out); the injector's spray while it injects; the spark at the plug's gap.
 *
 * Colours follow the visual language (air sky blue, fuel yellow, flame and heat vermillion,
 * exhaust warm grey). They are visible only where the engine is cut away or ghosted.
 */
import { AdditiveBlending, Color, ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, Object3D, SphereGeometry, Vector3 } from 'three';
import { BORE, CRANK_R, ROD_L, burnFraction, cylinderPressure, intakeLift, exhaustLift, phaseDeg, pistonDrop, sparkPhase } from '../../sim/engine';
import { VALVES } from '../../spec/vehicle';
import { CRANK_Y, DECK_Y, XC } from '../car/engineGeo';
import { LANGUAGE } from './language';

const AIR = new Color(LANGUAGE.air.color);
const FUEL = new Color(LANGUAGE.fuel.color);
const FLAME = new Color('#ff7a2a');
const HOT = new Color('#ffcf7a');
const EXH = new Color(LANGUAGE.exhaust.color);
const DEG = Math.PI / 180;

interface Cyl {
  gas: Mesh;
  gasMat: MeshBasicMaterial;
  flame: Mesh;
  flameMat: MeshBasicMaterial;
  spray: Mesh;
  sprayMat: MeshBasicMaterial;
  spark: Mesh;
  sparkMat: MeshBasicMaterial;
}

export interface CylinderState {
  phase: number;
  stroke: 'intake' | 'compression' | 'power' | 'exhaust';
  pressureBar: number;
  burn: number;
  injecting: boolean;
  sparking: boolean;
  intakeLift: number;
  exhaustLift: number;
  firing: boolean;
}

export class EngineViz {
  group = new Group();
  private cyl: Cyl[] = [];
  /** Per-cylinder state this frame (for readouts and captions). */
  state: CylinderState[] = [];

  constructor(parent: Object3D, injectorTips: Vector3[], plugTips: Vector3[]) {
    this.group.name = 'engine-viz';
    parent.add(this.group);
    for (let i = 0; i < 4; i++) {
      const gasMat = new MeshBasicMaterial({ color: AIR.clone(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
      // unit column (height 1 along y from 0), scaled each frame
      const g = new CylinderGeometry(BORE / 2 - 0.0012, BORE / 2 - 0.0012, 1, 32, 1, false);
      g.translate(0, 0.5, 0);
      const gas = new Mesh(g, gasMat);
      gas.position.set(XC[i], 0, 0);
      gas.renderOrder = 7;
      const flameMat = new MeshBasicMaterial({ color: FLAME.clone(), transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
      const flame = new Mesh(new SphereGeometry(1, 20, 14), flameMat);
      flame.position.copy(plugTips[i]);
      flame.renderOrder = 8;
      const sprayMat = new MeshBasicMaterial({ color: FUEL.clone(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
      const sg = new ConeGeometry(0.012, 0.045, 18, 1, true);
      sg.translate(0, -0.0225, 0);
      const spray = new Mesh(sg, sprayMat);
      spray.position.copy(injectorTips[i]);
      // aimed down and toward the cylinder's centre
      spray.lookAt(new Vector3(XC[i], DECK_Y - 0.04, 0.0));
      spray.rotateX(Math.PI / 2);
      spray.renderOrder = 8;
      const sparkMat = new MeshBasicMaterial({ color: new Color('#e9f0ff'), transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
      const spark = new Mesh(new SphereGeometry(0.0035, 10, 8), sparkMat);
      spark.position.copy(plugTips[i]).add(new Vector3(0, -0.002, 0));
      spark.renderOrder = 9;
      this.group.add(gas, flame, spray, spark);
      this.cyl.push({ gas, gasMat, flame, flameMat, spray, sprayMat, spark, sparkMat });
      this.state.push({ phase: 0, stroke: 'intake', pressureBar: 1, burn: 0, injecting: false, sparking: false, intakeLift: 0, exhaustLift: 0, firing: true });
    }
  }

  /**
   * Update for a crank angle. `opacity` is the cutaway lesson's channel; `combustion` per
   * cylinder (0 for a misfire); `load` 0 … 1 and rpm set the spark timing; `focusCyl` (or −1)
   * shows one cylinder's gas strongly and the others faintly.
   */
  update(theta: number, opts: { opacity: number; combustion: number[]; load: number; rpm: number; map: number; running: boolean; focusCyl: number; sparkWindowDeg: number }) {
    const spark = sparkPhase(opts.load, opts.rpm);
    for (let i = 0; i < 4; i++) {
      const c = this.cyl[i];
      const ph = phaseDeg(i, theta);
      const drop = pistonDrop((ph % 360) * DEG);
      const crown = DECK_Y - drop;
      const roof = DECK_Y + 0.009;
      const fires = opts.running && opts.combustion[i] > 0;
      const burn = fires && ph >= spark - 1 && ph < 540 ? burnFraction(ph, spark) : 0;
      const p = cylinderPressure(ph, opts.map, fires ? 1 : 0, spark);
      const st = this.state[i];
      st.phase = ph;
      st.stroke = ph < 180 ? 'intake' : ph < 360 ? 'compression' : ph < 540 ? 'power' : 'exhaust';
      st.pressureBar = p / 1e5;
      st.burn = burn;
      st.injecting = opts.running && ph >= VALVES.injectStart && ph <= VALVES.injectEnd;
      st.sparking = opts.running && ph >= spark && ph < spark + opts.sparkWindowDeg && opts.combustion[i] > 0;
      st.intakeLift = intakeLift(ph);
      st.exhaustLift = exhaustLift(ph);
      st.firing = fires;
      const weight = opts.focusCyl < 0 || opts.focusCyl === i ? 1 : 0.35;
      const o = opts.opacity * weight;
      // gas column
      c.gas.position.y = crown;
      c.gas.scale.set(1, Math.max(0.001, roof - crown), 1);
      const col = c.gasMat.color;
      let a = 0.0;
      if (st.stroke === 'intake') {
        // fresh air entering, then the fuel mist once the injector has sprayed
        const fuel = Math.min(1, Math.max(0, (ph - VALVES.injectStart) / 80));
        col.copy(AIR).lerp(FUEL, 0.35 * fuel);
        a = 0.22 + 0.25 * Math.min(1, ph / 60);
      } else if (st.stroke === 'compression') {
        // the same charge, squeezed: denser
        const sq = (ph - 180) / 180;
        col.copy(AIR).lerp(FUEL, 0.35).multiplyScalar(1 + 0.3 * sq);
        a = 0.36 + 0.3 * sq;
        if (burn > 0) {
          col.lerp(FLAME, Math.min(1, burn * 1.5));
          a = 0.55 + 0.35 * burn;
        }
      } else if (st.stroke === 'power') {
        if (fires) {
          // burning, then hot gas expanding and cooling
          const cool = (ph - 360) / 180;
          col.copy(HOT).lerp(FLAME, Math.min(1, burn + cool * 0.8)).lerp(EXH, Math.max(0, cool - 0.35) * 1.2);
          a = 0.75 - 0.3 * cool;
        } else {
          // a misfire: the unburnt charge just expands again
          col.copy(AIR).lerp(FUEL, 0.35);
          a = 0.35;
        }
      } else {
        // exhaust pushed out as the piston rises
        col.copy(EXH);
        a = 0.5 * (1 - (ph - 540) / 200);
      }
      c.gasMat.opacity = a * o;
      c.gas.visible = c.gasMat.opacity > 0.005;
      // flame front: a sphere from the plug, growing with the burned fraction, fading after
      const fr = burn > 0 && burn < 0.999 ? 0.006 + (BORE / 2) * Math.pow(burn, 0.6) : 0;
      c.flame.scale.setScalar(Math.max(0.0001, fr));
      c.flameMat.opacity = fr > 0 ? o * (0.85 - 0.6 * burn) : 0;
      c.flame.visible = c.flameMat.opacity > 0.005;
      // injector spray
      const inj = st.injecting ? Math.sin(Math.PI * ((ph - VALVES.injectStart) / (VALVES.injectEnd - VALVES.injectStart))) : 0;
      c.sprayMat.opacity = o * 0.75 * inj;
      c.spray.scale.set(1, 0.4 + 0.6 * inj, 1);
      c.spray.visible = c.sprayMat.opacity > 0.005;
      // spark
      c.sparkMat.opacity = st.sparking ? o * 1.0 : 0;
      c.spark.scale.setScalar(st.sparking ? 1 + 0.5 * Math.sin(ph * 3) : 1);
      c.spark.visible = c.sparkMat.opacity > 0.005;
    }
  }
}

/** Piston crown height at a crank angle (for camera anchors and captions). */
export function crownY(cyl: number, theta: number): number {
  const ph = phaseDeg(cyl, theta);
  return DECK_Y - pistonDrop((ph % 360) * DEG);
}
export const CRANK_CENTRE = new Vector3(XC[0], CRANK_Y, 0);
void CRANK_R;
void ROD_L;
