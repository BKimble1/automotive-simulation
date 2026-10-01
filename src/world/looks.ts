/**
 * Looks: applies the scene channels to the scene every frame (the channels decide when and how
 * fast; this decides what each value means). It never starts or plans anything.
 *
 *   body:<panel>       a body panel's x-ray ghost (0 solid … 1 a faint shell)
 *   open               hood, doors and trunk open on their hinges
 *   ghost:<assembly>   an assembly ghosts; ghost:<part> a single part
 *   hide:<part>        a part fades out completely (front accessories during a cutaway)
 *   explode:<group>    a take-apart group's amount (see scene/car/build.ts)
 *   cut:<plane>        a section plane slides through its assembly (engine, transmission, diff)
 *   show:<thing>       lesson-only parts: structure, airbags (deployment), road, legend
 *   dim                the rest of the car recedes; `focus` assemblies stay lit
 *   hl:<assembly>      the subject's edge light
 *   heat               the thermal tint, from the model's temperatures
 *   flow:<id>          a flow's visibility (its motion comes from the model)
 *   studio             the room's light (1 normal … 0 a darker room around the subject)
 */
import { Color, Vector3, Matrix4 } from 'three';
import type { Channels } from '../scene/channels';
import type { Car } from '../scene/car/build';
import { setGhost } from '../scene/car/body';
import { LAMPS } from '../scene/car/bodyMaterial';
import type { CarState } from '../sim/car';
import { XC } from '../scene/car/engineGeo';
import { DIFF_C, TRANS } from '../scene/car/drivetrainGeo';
import type { Studio } from '../scene/studio';

const _m = new Matrix4();
const _n = new Vector3();
const _p = new Vector3();

/** Assemblies of the car (material groups), for dimming and highlighting. */
export const ASSEMBLIES = [
  'body',
  'engine',
  'ignition',
  'injection',
  'intake',
  'exhaust',
  'fuel',
  'lubrication',
  'cooling',
  'transmission',
  'driveline',
  'suspension',
  'steering',
  'wheels',
  'brakes',
  'electrical',
  'control',
  'hvac',
  'cabin',
  'controls',
  'safety',
  'structure',
] as const;

const HIGHLIGHT = new Color('#b9b2ff');

export class Looks {
  /** Assemblies kept bright while the rest is dimmed (set by the director from the view). */
  focus = new Set<string>();
  private tint = new Map<string, Color>();
  private dimNow = new Map<string, number>();
  private structureParts: string[] = ['structure-mild', 'structure-high', 'structure-ultra', 'structure-crash'];

  constructor(
    private car: Car,
    private channels: Channels,
    private studio: Studio,
  ) {}

  /** Colour-code parts (a view's tint); the others return to the usual highlight colour. */
  setTint(tint: Record<string, string>) {
    const before = [...this.tint.keys()];
    this.tint = new Map(Object.entries(tint).map(([k, c]) => [k, new Color(c)]));
    for (const name of new Set([...before, ...this.tint.keys()])) {
      const n = this.car.rig.parts.get(name);
      if (!n) continue;
      const c = this.tint.get(name);
      for (const m of n.meshes) {
        const u = m.userData.pair?.u;
        if (!u) continue;
        u.uHighlightColor.value.copy(c ?? HIGHLIGHT);
        u.uHighlightFill.value = c ? 0.5 : 0.06;
      }
    }
  }

  apply(state: CarState, dt: number) {
    const ch = this.channels;
    const car = this.car;
    const rig = car.rig;

    // ── body panels
    for (const p of car.body.panels) {
      const g = Math.max(ch.get(`body:${p.name}`), ch.get('body:all'));
      if (Math.abs(g - p.ghost) > 1e-5 || (g > 0 && p.paint.material !== p.mats.paintGhost) || (g === 0 && p.paint.material !== p.mats.paint)) setGhost(p, g);
    }

    // ── ghosting of assemblies and parts; parts that fade out entirely
    const ghostOf = new Map<string, number>();
    for (const id of ch.active()) {
      if (id.startsWith('ghost:')) ghostOf.set(id.slice(6), ch.get(id));
    }
    const hideOf = new Map<string, number>();
    for (const id of ch.active()) if (id.startsWith('hide:')) hideOf.set(id.slice(5), ch.get(id));
    for (const a of ASSEMBLIES) {
      if (a === 'body') continue;
      const g = ghostOf.get(a) ?? 0;
      const nodes = rig.byAssembly.get(a) ?? [];
      for (const n of nodes) {
        const gg = Math.max(g, ghostOf.get(n.name) ?? 0);
        // hide: a part fades out of the picture, then is not drawn at all
        const hh = Math.max(hideOf.get(n.name) ?? 0, hideOf.get(a) ?? 0);
        const ud = n.object.userData;
        if (gg !== (ud.ghostNow ?? 0) || hh !== (ud.hideNow ?? 0)) {
          rig.setPartGhost(n, gg, hh);
          ud.ghostNow = gg;
          ud.hideNow = hh;
          n.object.visible = hh < 0.995;
        }
      }
    }

    // ── lesson-only parts
    const sStruct = ch.get('show:structure');
    for (const name of this.structureParts) {
      const n = rig.parts.get(name);
      if (!n) continue;
      n.object.visible = sStruct > 0.003;
      if (n.object.visible) rig.setPartGhost(n, 1 - sStruct * 0.92);
    }
    const bag = ch.get('show:airbags');
    for (const b of car.cabin.airbags) {
      b.node.object.visible = bag > 0.002;
      const s = Math.max(0.0001, bag);
      b.node.ms.set(s, s, s);
    }
    for (const b of car.cabin.belts) rig.setPartGhost(b, 0);

    // ── explode amounts are read by the rig (see World.frame)

    // ── section planes, which ride on the body
    const sprung = car.sprung;
    sprung.updateMatrixWorld();
    _m.copy(sprung.matrixWorld);
    const plane = (id: string, normal: Vector3, from: number, to: number, axisPoint: (v: number) => Vector3) => {
      const p = rig.clips.get(id);
      if (!p) return;
      const v = ch.get(`cut:${id}`);
      if (v <= 0.0001) {
        p.set(_n.set(1, 0, 0), 1000);
        return;
      }
      const s = v * v * (3 - 2 * v);
      const at = from + (to - from) * s;
      _n.copy(normal).transformDirection(_m);
      _p.copy(axisPoint(at)).applyMatrix4(_m);
      p.setFromNormalAndCoplanarPoint(_n, _p);
    };
    // the engine: a plane facing the front slides back to cylinder 1's centre line
    plane('engine', new Vector3(-1, 0, 0), XC[0] + 0.35, XC[0], (x) => new Vector3(x, 0, 0));
    // the transmission: a vertical plane along its axis, coming in from the left
    plane('transmission', new Vector3(0, 0, 1), -0.35, 0.0, (z) => new Vector3(TRANS.convX, TRANS.axisY, z));
    // the differential: from behind, its cover and back half cut away
    plane('diff', new Vector3(1, 0, 0), DIFF_C.x - 0.3, DIFF_C.x - 0.012, (x) => new Vector3(x, DIFF_C.y, 0));

    // ── isolation (dimming) and highlight
    const dim = ch.get('dim');
    const k = 1 - Math.exp(-dt * 6);
    for (const a of ASSEMBLIES) {
      const target = this.focus.size && !this.focus.has(a) ? dim : 0;
      const cur = this.dimNow.get(a) ?? 0;
      const v = dt > 0 ? cur + (target - cur) * k : cur;
      this.dimNow.set(a, v);
    }
    for (const n of rig.parts.values()) {
      const d = this.dimNow.get(n.assembly) ?? 0;
      const h = ch.get(`hl:${n.assembly}`) || ch.get(`hl:${n.component}`) || ch.get(`hl:${n.name}`);
      for (const m of n.meshes) {
        const pair = m.userData.pair;
        if (!pair) continue;
        pair.u.uDim.value = d;
        pair.u.uHighlight.value = h;
      }
    }
    LAMPS.uBodyDim.value = this.dimNow.get('body') ?? 0;
    for (const p of car.body.panels) p.mats.uniforms.uHighlight.value = Math.max(ch.get('hl:body'), ch.get(`hl:panel-${p.name}`));

    // ── heat: brake discs from their temperature, exhaust from the engine's work, the engine
    // from its coolant
    const heat = ch.get('heat');
    for (let i = 0; i < 4; i++) {
      const id = ['FL', 'FR', 'RL', 'RR'][i];
      const n = rig.parts.get(`brake-disc-${id}`);
      const t = Math.max(0, Math.min(1, (state.rotorC[i] - 180) / 520));
      for (const m of n?.meshes ?? []) if (m.userData.pair?.kind === 'rotor') m.userData.pair.u.uHeat.value = Math.max(heat * t, t > 0.45 ? (t - 0.45) * 1.4 : 0);
    }
    const exhaustHot = Math.min(1, 0.25 + state.fuelGs / 6);
    for (const name of ['exhaust-manifold', 'catalytic-converter']) {
      const n = rig.parts.get(name);
      for (const m of n?.meshes ?? []) m.userData.pair.u.uHeat.value = heat * exhaustHot * (state.engine === 'running' ? 1 : 0.3);
    }
    const engineHot = Math.max(0, Math.min(1, (state.coolantC - 40) / 90));
    for (const name of ['engine-block', 'cylinder-head']) {
      const n = rig.parts.get(name);
      for (const m of n?.meshes ?? []) m.userData.pair.u.uHeat.value = heat * engineHot * 0.6;
    }

    // ── studio light and the body's lamps
    this.studio.update(ch.get('studio') > 0 ? 1 - 0.55 * ch.get('studio') : 1);
    LAMPS.uBrake.value = state.linePa > 2e5 ? Math.min(1, state.linePa / 10e5) : 0;
  }
}
