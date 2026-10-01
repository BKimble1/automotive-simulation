/**
 * The chassis: four corners (upright, hub, brake disc and caliper, wheel and tyre), the
 * double-wishbone front and multi-link rear suspension, springs and dampers, anti-roll bars,
 * the subframes, the electrically assisted rack-and-pinion steering, the column and the
 * steering wheel, the half shafts and the wheel-speed sensors.
 *
 * Corners are not part of the body: each has its own group that the mechanism moves by the
 * wheel's travel and steer angle; its spinning parts (disc, wheel) are a child that turns with
 * the wheel. The tyre is drawn in the corner's non-spinning frame: its shader turns it by the
 * wheel's angle and flattens it against the road by the tyre's deflection, so the contact patch
 * stays where the road is. Links (arms, tie rods, dampers, springs, half shafts) are posed every
 * frame between their body-side and wheel-side points.
 */
import { BufferGeometry, CircleGeometry, DataTexture, Group, LinearFilter, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, Quaternion, RGBAFormat, SRGBColorSpace, Vector3, type Texture } from 'three';
import { BODY, BRAKES, TIRE, WHEEL_Y } from '../../spec/vehicle';
import { alongAxis, at, extrude, lathe, merge, rbox, rod, spring, tube } from '../geo/shapes';
import { DIFF_C } from './drivetrainGeo';
import type { MatPair } from '../materials';
import type { PartNode, Rig } from './rig';

export const CORNERS = [
  { id: 'FL', x: BODY.xFront, z: -BODY.trackFront / 2, front: true, side: -1 },
  { id: 'FR', x: BODY.xFront, z: BODY.trackFront / 2, front: true, side: 1 },
  { id: 'RL', x: BODY.xRear, z: -BODY.trackRear / 2, front: false, side: -1 },
  { id: 'RR', x: BODY.xRear, z: BODY.trackRear / 2, front: false, side: 1 },
] as const;

const RIM_R = (18 * 0.0254) / 2;
const RIM_W = 8.5 * 0.0254;
const TYRE_W = TIRE.widthMm / 1000;

/** A link: two attachment points (body side a, wheel side b) at rest, in vehicle coordinates. */
export interface Link {
  node: PartNode;
  a: Vector3;
  b: Vector3;
  /** Which corner's wheel-side point b follows. */
  corner: number;
  /** b is on the body too (an anti-roll bar's centre, the rack). */
  rigid?: boolean;
  kind: 'arm' | 'stretch' | 'spring' | 'damperBody' | 'damperRod' | 'halfshaft' | 'tierod';
  /** For an A-arm: its second inner pivot (the hinge axis is a → a2). */
  a2?: Vector3;
  restLen: number;
}

export interface CornerParts {
  group: Group;
  spin: Group;
  tyre: Mesh;
  tyreMat: MeshPhysicalMaterial & { userData: { u: { uSpin: { value: number }; uFlat: { value: number }; uRadius: { value: number }; uBlur: { value: number } } } };
  rotorNode: PartNode;
  wheelNode: PartNode;
  calipers: PartNode;
  pads: PartNode[];
  /** Wheel-side link points in the corner's frame (origin at the wheel centre). */
  local: Record<string, Vector3>;
  /** The spin blur over the spokes (opacity from how far the wheel turns per drawn frame). */
  blur: Mesh<CircleGeometry, MeshStandardMaterial>;
}

export interface ChassisParts {
  corners: CornerParts[];
  links: Link[];
  steeringWheel: PartNode;
  column: PartNode;
  rack: PartNode;
  rackPinion: PartNode;
  root: Group;
}

/** The tyre: a lathe profile (bead, sidewall bulge, shoulder, tread with four grooves). */
function tyreGeometry(): BufferGeometry {
  const R = TIRE.radius;
  const hw = TYRE_W / 2;
  const prof: [number, number][] = [];
  // from the inner bead, round the inner sidewall, across the tread, down the outer sidewall
  const side = (s: number) => {
    const pts: [number, number][] = [];
    for (let k = 0; k <= 8; k++) {
      const u = k / 8;
      const r = RIM_R + 0.004 + (R - 0.02 - RIM_R - 0.004) * u;
      const bulge = Math.sin(Math.PI * Math.min(1, u * 1.15)) * 0.016;
      pts.push([r, s * (RIM_W / 2 + 0.006 + bulge + u * (hw - RIM_W / 2 - 0.01))]);
    }
    return pts;
  };
  prof.push([RIM_R - 0.004, -RIM_W / 2 - 0.004]);
  prof.push(...side(-1));
  // shoulder and tread with grooves
  const tread: [number, number][] = [
    [R - 0.008, -hw + 0.004],
    [R, -hw + 0.016],
  ];
  const grooves = [-0.065, -0.022, 0.022, 0.065];
  for (const g of grooves) {
    tread.push([R, g - 0.005]);
    tread.push([R - 0.007, g - 0.004]);
    tread.push([R - 0.007, g + 0.004]);
    tread.push([R, g + 0.005]);
  }
  tread.push([R, hw - 0.016]);
  tread.push([R - 0.008, hw - 0.004]);
  prof.push(...tread);
  prof.push(...side(1).reverse());
  prof.push([RIM_R - 0.004, RIM_W / 2 + 0.004]);
  // lathe around +y with the profile's second value as height: we want the axle along z
  const g = lathe(
    prof.map(([r, h]) => [r, h]),
    'y',
    96,
  );
  return alongAxis(g, 'z');
}

/** The tyre material: the wheel's spin, the contact patch and a tread pattern, in the shader. */
type TyreU = { uSpin: { value: number }; uFlat: { value: number }; uRadius: { value: number }; uBlur: { value: number } };
function tyreMaterial(src: MeshPhysicalMaterial, u: TyreU, ghost: boolean) {
  const m = src.clone() as MeshPhysicalMaterial;
  const base = src.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    base.call(src, shader, r);
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uSpin; uniform float uFlat; uniform float uRadius;\nvarying vec3 vTyre;')
      .replace(
        '#include <begin_vertex>',
        `// turn by the wheel's spin (forward rolling turns about −z), then flatten against the road
        float cs = cos(-uSpin), sn = sin(-uSpin);
        vec3 transformed = vec3(position.x * cs - position.y * sn, position.x * sn + position.y * cs, position.z);
        vTyre = position;
        float lim = -(uRadius - uFlat);
        if (transformed.y < lim) {
          float push = lim - transformed.y;
          transformed.y = lim;
          // the squeezed rubber bulges the sidewall a little
          transformed.z += sign(transformed.z) * push * 0.6 * smoothstep(0.08, 0.12, abs(transformed.z));
        }
        vPmObj = transformed;`,
      )
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(normal.x * cos(-uSpin) - normal.y * sin(-uSpin), normal.x * sin(-uSpin) + normal.y * cos(-uSpin), normal.z);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTyre;\nuniform float uBlur;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // tread blocks and sipes across the tread (in the tyre's own turning frame)
          float rr = length(vTyre.xy);
          float ang = atan(vTyre.y, vTyre.x);
          float onTread = smoothstep(${(TIRE.radius - 0.012).toFixed(4)}, ${(TIRE.radius - 0.004).toFixed(4)}, rr);
          float blocks = abs(fract(ang * 70.0 / 6.2831 + vTyre.z * 4.0) - 0.5);
          float cut = smoothstep(0.42, 0.47, blocks) * (1.0 - uBlur);
          diffuseColor.rgb *= 1.0 - onTread * cut * 0.75;
          // a quiet sidewall ring
          float ring = 1.0 - smoothstep(0.0015, 0.003, abs(rr - ${(RIM_R + 0.052).toFixed(4)}));
          diffuseColor.rgb += ring * 0.025 * (1.0 - onTread);
        }`,
      );
  };
  m.customProgramCacheKey = () => (ghost ? 'tyre-g' : 'tyre');
  m.userData = { ...src.userData, u };
  return m as MeshPhysicalMaterial & { userData: { u: typeof u } };
}

let blurTex: Texture | null = null;
/** The spinning wheel as the eye sees it: spoke metal smeared into rings around a clear hub. Built
 * from numbers (no canvas), so the scene also builds where there is no document. */
function spinBlurTexture(): Texture {
  if (blurTex) return blurTex;
  const N = 128;
  // radius (0 centre … 1 rim) → grey level and opacity, linear between the stops
  // the hub and centre cap stay clear (they read the same turning or not); the spoke band smears
  const STOPS: [number, number, number][] = [
    [0.0, 40, 0],
    [0.22, 40, 0],
    [0.3, 120, 0.85],
    [0.7, 150, 0.8],
    [0.9, 110, 0.8],
    [1.0, 70, 0.6],
  ];
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const r = Math.min(1, Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2));
      let k = 1;
      while (k < STOPS.length - 1 && STOPS[k][0] < r) k++;
      const [r0, g0, a0] = STOPS[k - 1];
      const [r1, g1, a1] = STOPS[k];
      const f = Math.min(1, Math.max(0, (r - r0) / (r1 - r0)));
      const g = g0 + (g1 - g0) * f;
      const i = (y * N + x) * 4;
      data[i] = g;
      data[i + 1] = g + 4;
      data[i + 2] = g + 9;
      data[i + 3] = (a0 + (a1 - a0) * f) * 255;
    }
  const t = new DataTexture(data, N, N, RGBAFormat);
  t.colorSpace = SRGBColorSpace;
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.needsUpdate = true;
  blurTex = t;
  return t;
}

/** The rim: barrel, five double spokes, lug nuts and the centre cap. */
function rimGeometry(): { metal: BufferGeometry; back: BufferGeometry; dark: BufferGeometry } {
  const w = RIM_W;
  const barrel = lathe(
    [
      [RIM_R + 0.018, -w / 2 - 0.004],
      [RIM_R + 0.016, -w / 2 + 0.006],
      [RIM_R - 0.004, -w / 2 + 0.012],
      [RIM_R - 0.006, w / 2 - 0.03],
      [RIM_R - 0.004, w / 2 - 0.012],
      [RIM_R + 0.016, w / 2 - 0.006],
      [RIM_R + 0.02, w / 2 + 0.004],
      [RIM_R - 0.012, w / 2 + 0.006],
      [RIM_R - 0.02, w / 2 - 0.002],
    ],
    'y',
    96,
  );
  // lathe height runs along y: turn the axle onto z, outer face at +z
  barrel.rotateX(Math.PI / 2);
  const spokes: BufferGeometry[] = [];
  const faceZ = w / 2 - 0.012;
  for (let k = 0; k < 5; k++) {
    for (const s of [-1, 1]) {
      const a = (k / 5) * Math.PI * 2 + s * 0.12;
      // a spoke: tapered, from the hub to the rim, slightly concave (dished toward the hub)
      const pts: [number, number][] = [
        [-0.013, 0.07],
        [0.013, 0.07],
        [0.009, RIM_R - 0.01],
        [-0.009, RIM_R - 0.01],
      ];
      const g = extrude(pts, 0.022, { bevel: 0.003 });
      // dish: push the hub end inward
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        const t = (RIM_R - y) / (RIM_R - 0.07);
        p.setZ(i, p.getZ(i) - 0.03 * Math.max(0, Math.min(1, t)));
      }
      g.computeVertexNormals();
      g.rotateZ(-a);
      g.translate(0, 0, faceZ - 0.006);
      spokes.push(g);
    }
  }
  const hub = lathe(
    [
      [0.0, faceZ - 0.05],
      [0.085, faceZ - 0.05],
      [0.085, faceZ - 0.032],
      [0.07, faceZ - 0.026],
      [0.0, faceZ - 0.026],
    ],
    'y',
    40,
  );
  hub.rotateX(Math.PI / 2);
  const nuts: BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + Math.PI / 5;
    const g = alongAxis(lathe([[0, 0], [0.011, 0], [0.011, 0.016], [0.007, 0.022], [0, 0.022]], 'y', 6), 'z');
    g.translate(Math.cos(a) * 0.0572, Math.sin(a) * 0.0572, faceZ - 0.045);
    nuts.push(g);
  }
  const cap = alongAxis(lathe([[0, 0], [0.03, 0], [0.03, 0.006], [0.026, 0.01], [0, 0.011]], 'y', 32), 'z');
  cap.translate(0, 0, faceZ - 0.04);
  // two-tone: machined spoke faces over a graphite barrel and hub
  return { metal: merge(spokes), back: merge([barrel, hub]), dark: merge([...nuts, cap]) };
}

export function buildChassis(rig: Rig, parent: Object3D, sprung: Object3D): ChassisParts {
  const root = new Group();
  root.name = 'chassis-root';
  parent.add(root);
  const corners: CornerParts[] = [];
  const links: Link[] = [];
  const W = 'wheels';
  const S = 'suspension';
  const B = 'brakes';
  const rim = rimGeometry();
  const tyreGeo = tyreGeometry();

  CORNERS.forEach((c, ci) => {
    const sd = c.side;
    const group = new Group();
    group.name = `corner-${c.id}`;
    group.position.set(c.x, WHEEL_Y, c.z);
    root.add(group);
    rig.adopt(group, `corner-${c.id}`, c.front ? 'front-suspension' : 'rear-suspension', S, [], []);
    const spin = new Group();
    spin.name = `corner-${c.id}-spin`;
    // the outer face of the wheel looks outward: on the left (−z) side, mirror by turning half a turn about y
    if (sd < 0) spin.rotation.y = Math.PI;
    group.add(spin);
    const spinNode = rig.adopt(spin, `wheel-spin-${c.id}`, 'wheel', W, [], []);
    void spinNode;
    // wheel (rim) and tyre
    const wheelNode = rig.part(spin, `wheel-${c.id}`, 'wheel', W, [['machined', rim.metal.clone(), '#c3c8ce'], ['aluminium', rim.back.clone(), '#3c4047'], ['polymerGloss', rim.dark.clone()]], { local: true });
    const plain = rig.mat(W, 'tyre');
    const tu: TyreU = { uSpin: { value: 0 }, uFlat: { value: 0.012 }, uRadius: { value: TIRE.radius }, uBlur: { value: 0 } };
    const tm = tyreMaterial(plain.opaque, tu, false);
    // its own pair, so a ghosted tyre still turns and flattens
    const tyrePair: MatPair = { kind: 'tyre', u: plain.u, opaque: tm as unknown as MatPair['opaque'], ghost: tyreMaterial(plain.ghost, tu, true) as unknown as MatPair['ghost'] };
    const tyre = new Mesh(tyreGeo.clone(), tm);
    tyre.name = `tyre-${c.id}:tyre`;
    tyre.castShadow = true;
    tyre.receiveShadow = true;
    const tyreHolder = new Group();
    tyreHolder.name = `tyre-${c.id}`;
    if (sd < 0) tyreHolder.rotation.y = Math.PI;
    tyreHolder.add(tyre);
    // the spin blur: a disc over the spokes that fades in when the wheel turns too far between
    // two drawn frames for its spokes to be read (they would strobe, or seem to turn backwards)
    const blurMat = new MeshStandardMaterial({ map: spinBlurTexture(), transparent: true, opacity: 0, depthWrite: false, metalness: 0.7, roughness: 0.38 });
    const blur = new Mesh(new CircleGeometry(RIM_R - 0.004, 48), blurMat);
    blur.position.z = RIM_W / 2 - 0.002;
    blur.name = `wheel-blur-${c.id}`;
    blur.visible = false;
    blur.renderOrder = 3;
    tyreHolder.add(blur);
    group.add(tyreHolder);
    rig.adopt(tyreHolder, `tyre-${c.id}`, 'tyre', W, [tyre], [tyrePair]);
    // brake disc (vented), on the spinning hub, inboard of the wheel
    const rR = (c.front ? BRAKES.rotorFront : BRAKES.rotorRear) / 2;
    const discZ = -0.045; // inboard of the wheel centre (in the spin frame: −z is toward the car)
    const disc: BufferGeometry[] = [];
    const t = c.front ? 0.03 : 0.022;
    for (const s2 of [-1, 1]) disc.push(at(alongAxis(lathe([[rR * 0.55, -0.004], [rR, -0.004], [rR, 0.004], [rR * 0.55, 0.004]], 'y', 72), 'z'), 0, 0, discZ + s2 * (t / 2 - 0.004)));
    const vanes: BufferGeometry[] = [];
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      const g = rbox(rR * 0.4, 0.004, t - 0.008, 0.001, rR * 0.77, 0, discZ);
      g.rotateZ(a);
      vanes.push(g);
    }
    const hat = lathe([[0.0, 0], [rR * 0.56, 0], [rR * 0.56, 0.035], [0.075, 0.04], [0, 0.04]], 'y', 48);
    hat.rotateX(Math.PI / 2); // height → +z: from the disc outboard to the hub face
    hat.translate(0, 0, discZ + t / 2);
    const rotorNode = rig.part(spin, `brake-disc-${c.id}`, 'brake-rotor', B, [['rotor', merge([...disc, ...vanes]), undefined, `rotor-${c.id}`], ['steel', hat]], { local: true });
    // caliper (fixed to the upright), behind the axle, slightly above centre
    const ca = (c.front ? 1.0 : 1.15) * Math.PI; // angle round the disc, from the front
    const cpx = Math.cos(ca) * rR * 0.86;
    const cpy = Math.sin(ca) * rR * 0.86 + 0.02;
    const zDisc = -sd * (0.045); // the disc's plane in the corner frame (inboard)
    const calBody: BufferGeometry[] = [];
    const arcSeg = 6;
    for (let k = 0; k < arcSeg; k++) {
      const a0 = ca - 0.32 + (0.64 * k) / arcSeg;
      const x0 = Math.cos(a0) * rR * 0.84;
      const y0 = Math.sin(a0) * rR * 0.84;
      calBody.push(rbox(0.032, 0.032, t + 0.05, 0.008, x0, y0, zDisc));
    }
    const calipers = rig.part(group, `caliper-${c.id}`, 'brake-caliper', B, [['caliper', merge(calBody)], ['steel', rbox(0.05, 0.03, 0.03, 0.006, cpx, cpy + 0.02, zDisc - sd * 0.04)]], { local: true });
    const pads: PartNode[] = [];
    for (const s2 of [-1, 1]) {
      const pg = rbox(0.09, 0.045, 0.008, 0.004, Math.cos(ca) * rR * 0.8, Math.sin(ca) * rR * 0.8, 0);
      pg.rotateZ(0);
      const pz = zDisc + s2 * (t / 2 + 0.006);
      pg.translate(0, 0, pz);
      pads.push(rig.part(group, `brake-pad-${c.id}-${s2 < 0 ? 'in' : 'out'}`, 'brake-pad', B, [['pad', pg]], { local: true }));
    }
    // upright / knuckle with its hub, and the wheel-speed sensor
    const kz = -sd * 0.11;
    const up = merge([
      rbox(0.07, 0.3, 0.05, 0.02, 0.0, c.front ? 0.04 : 0.02, kz),
      at(alongAxis(lathe([[0.0, -0.03], [0.06, -0.03], [0.065, 0.02], [0.0, 0.02]], 'y', 32), 'z'), 0, 0, kz + sd * 0.0),
      ...(c.front ? [rod(new Vector3(0, -0.02, kz), new Vector3(0.17, -0.04, kz - sd * 0.02), 0.014, 10)] : []),
    ]);
    rig.part(group, `upright-${c.id}`, c.front ? 'steering-knuckle' : 'rear-upright', S, [['castAl', up]], { local: true });
    rig.part(group, `hub-${c.id}`, 'wheel-hub-bearing', S, [['machined', rod(new Vector3(0, 0, -sd * 0.09), new Vector3(0, 0, sd * 0.03), 0.045, 28)]], { local: true });
    rig.part(group, `wss-${c.id}`, 'wheel-speed-sensor', 'control', [['polymerGloss', rod(new Vector3(-0.03, 0.065, kz), new Vector3(-0.05, 0.11, kz - sd * 0.03), 0.007, 8)]], { local: true });

    // link points (corner frame: origin at the wheel centre)
    const z0 = c.z;
    const P = (x: number, y: number, z: number) => new Vector3(x, y, z);
    const local: Record<string, Vector3> = {};
    if (c.front) {
      local.lbj = P(0.005, 0.17 - WHEEL_Y, -sd * 0.07);
      local.ubj = P(-0.02, 0.53 - WHEEL_Y, -sd * 0.13);
      local.tie = P(0.17, 0.28 - WHEEL_Y, -sd * 0.09);
      local.damper = P(0.015, 0.21 - WHEEL_Y, -sd * 0.17);
      const lowerIn = [P(c.x + 0.17, 0.2, sd * 0.36), P(c.x - 0.2, 0.2, sd * 0.36)];
      const upperIn = [P(c.x + 0.1, 0.56, sd * 0.43), P(c.x - 0.12, 0.56, sd * 0.43)];
      const toWorld = (v: Vector3) => v.clone().add(new Vector3(c.x, WHEEL_Y, z0));
      // lower A-arm
      links.push(armLink(rig, root, `lower-arm-${c.id}`, 'lower-control-arm', S, lowerIn[0], lowerIn[1], toWorld(local.lbj), ci, 0.016));
      links.push(armLink(rig, root, `upper-arm-${c.id}`, 'upper-control-arm', S, upperIn[0], upperIn[1], toWorld(local.ubj), ci, 0.012));
      // tie rod from the rack's end to the steering arm
      const rackEnd = P(c.x + 0.17, 0.3, sd * 0.33);
      links.push(stretchLink(rig, root, `tie-rod-${c.id}`, 'tie-rod', 'steering', rackEnd, toWorld(local.tie), ci, 0.009, 'tierod'));
      // coil-over: damper body on the arm, rod and spring up to the tower
      const top = P(c.x + 0.03, 0.74, sd * 0.56);
      links.push(...coilover(rig, root, c.id, S, top, toWorld(local.damper), ci, true));
    } else {
      local.lower = P(-0.005, 0.18 - WHEEL_Y, -sd * 0.08);
      local.upper = P(0.0, 0.5 - WHEEL_Y, -sd * 0.11);
      local.toe = P(-0.155, 0.26 - WHEEL_Y, -sd * 0.1);
      local.trail = P(0.125, 0.28 - WHEEL_Y, -sd * 0.1);
      local.damper = P(-0.075, 0.24 - WHEEL_Y, -sd * 0.14);
      local.spring = P(0.005, 0.22 - WHEEL_Y, -sd * 0.22);
      const toWorld = (v: Vector3) => v.clone().add(new Vector3(c.x, WHEEL_Y, z0));
      links.push(armLink(rig, root, `rear-lower-arm-${c.id}`, 'rear-lower-arm', S, P(c.x + 0.12, 0.22, sd * 0.3), P(c.x - 0.1, 0.22, sd * 0.3), toWorld(local.lower), ci, 0.016));
      links.push(stretchLink(rig, root, `rear-upper-arm-${c.id}`, 'rear-upper-arm', S, P(c.x + 0.02, 0.5, sd * 0.4), toWorld(local.upper), ci, 0.011, 'stretch'));
      links.push(stretchLink(rig, root, `toe-link-${c.id}`, 'toe-link', S, P(c.x - 0.155, 0.28, sd * 0.38), toWorld(local.toe), ci, 0.009, 'stretch'));
      links.push(stretchLink(rig, root, `trailing-link-${c.id}`, 'trailing-link', S, P(c.x + 0.42, 0.3, sd * 0.62), toWorld(local.trail), ci, 0.011, 'stretch'));
      links.push(...coilover(rig, root, c.id, S, P(c.x - 0.12, 0.62, sd * 0.6), toWorld(local.damper), ci, false));
      // a separate coil spring on the lower arm
      const sTop = P(c.x + 0.005, 0.5, sd * 0.58);
      const sBot = toWorld(local.spring);
      const sl = sTop.distanceTo(sBot);
      const g = spring(0.055, 0.0065, sl, 6.5);
      const node = rig.part(root, `rear-spring-${c.id}`, 'coil-spring', S, [['steel', g, '#3b3f46']], { pivot: sBot.clone(), quat: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), sTop.clone().sub(sBot).normalize()), local: true });
      links.push({ node, a: sTop, b: sBot, corner: ci, kind: 'spring', restLen: sl });
      // half shaft: from the differential's side to the hub
      const inner = new Vector3(DIFF_C.x, DIFF_C.y, sd * 0.15);
      const outer = new Vector3(c.x, WHEEL_Y, c.z - sd * 0.12);
      links.push(halfShaft(rig, root, c.id, inner, outer, ci));
    }
    corners.push({ group, spin, tyre, tyreMat: tm as CornerParts['tyreMat'], rotorNode, wheelNode, calipers, pads, local, blur });
  });

  // ───────────────────────── anti-roll bars, subframes ─────────────────────────
  {
    const bar = (x: number, y: number, zEnd: number, xArm: number) =>
      tube(
        [new Vector3(x + xArm, y + 0.02, -zEnd), new Vector3(x, y, -zEnd + 0.06), new Vector3(x, y, 0), new Vector3(x, y, zEnd - 0.06), new Vector3(x + xArm, y + 0.02, zEnd)],
        0.012,
        { radial: 10, tension: 0.2 },
      );
    rig.part(sprung, 'anti-roll-bar-front', 'anti-roll-bar', S, [['steel', bar(BODY.xFront - 0.24, 0.24, 0.55, 0.18), '#2b2e33']]);
    rig.part(sprung, 'anti-roll-bar-rear', 'anti-roll-bar', S, [['steel', bar(BODY.xRear + 0.2, 0.28, 0.55, -0.16), '#2b2e33']]);
    const fsub: BufferGeometry[] = [];
    fsub.push(rbox(0.09, 0.06, 0.82, 0.012, BODY.xFront - 0.0, 0.2, 0));
    for (const s of [-1, 1]) fsub.push(rod(new Vector3(BODY.xFront + 0.25, 0.22, s * 0.36), new Vector3(BODY.xFront - 0.3, 0.2, s * 0.36), 0.028, 8));
    rig.part(sprung, 'front-subframe', 'front-subframe', 'structure', [['steel', merge(fsub), '#2a2d32']]);
    const rsub: BufferGeometry[] = [];
    for (const dx of [0.2, -0.22]) rsub.push(rbox(0.07, 0.06, 0.9, 0.012, BODY.xRear + dx, 0.27, 0));
    for (const s of [-1, 1]) rsub.push(rod(new Vector3(BODY.xRear + 0.26, 0.29, s * 0.42), new Vector3(BODY.xRear - 0.26, 0.29, s * 0.42), 0.026, 8));
    rig.part(sprung, 'rear-subframe', 'rear-subframe', 'structure', [['steel', merge(rsub), '#2a2d32']]);
  }

  // ───────────────────────── steering ─────────────────────────
  const rackY = 0.3;
  const rackX = BODY.xFront + 0.17;
  const rack = rig.part(
    sprung,
    'steering-rack',
    'steering-rack',
    'steering',
    [
      ['machined', rod(new Vector3(rackX, rackY, -0.33), new Vector3(rackX, rackY, 0.33), 0.012, 14)],
    ],
    { pivot: new Vector3(rackX, rackY, 0) },
  );
  rig.part(sprung, 'steering-gear-housing', 'steering-rack', 'steering', [
    ['castAl', rod(new Vector3(rackX, rackY, -0.26), new Vector3(rackX, rackY, 0.22), 0.026, 18)],
    ['rubber', merge([-1, 1].map((s) => rod(new Vector3(rackX, rackY, s * 0.22), new Vector3(rackX, rackY, s * 0.31), 0.022, 14, 0.014)))],
  ]);
  rig.part(sprung, 'eps-motor', 'eps-motor', 'steering', [
    ['castAl', at(alongAxis(lathe([[0, 0], [0.045, 0], [0.045, 0.13], [0.035, 0.14], [0, 0.14]], 'y', 28), 'x'), rackX - 0.16, rackY - 0.02, -0.18)],
    ['polymerGloss', rbox(0.06, 0.04, 0.05, 0.008, rackX - 0.12, rackY + 0.035, -0.18)],
  ]);
  const pinionPt = new Vector3(rackX, rackY + 0.02, -0.28);
  const rackPinion = rig.part(sprung, 'steering-pinion', 'steering-rack', 'steering', [['machined', rod(pinionPt, pinionPt.clone().add(new Vector3(-0.02, 0.06, 0)), 0.01, 10)]], { pivot: pinionPt.clone() });
  // column: from the steering wheel to the firewall, then the intermediate shaft down to the pinion
  const wheelC = new Vector3(0.42, 0.96, -0.37);
  const colDir = new Vector3(Math.cos(0.42), -Math.sin(0.42), 0).normalize();
  const fw = wheelC.clone().addScaledVector(colDir, 0.5);
  const column = rig.part(
    sprung,
    'steering-column',
    'steering-column',
    'steering',
    [
      ['steel', rod(wheelC.clone().addScaledVector(colDir, 0.06), fw, 0.016, 12)],
      ['polymer', rod(wheelC.clone().addScaledVector(colDir, 0.08), wheelC.clone().addScaledVector(colDir, 0.3), 0.04, 16)],
      ['steel', tube([fw, fw.clone().add(new Vector3(0.25, -0.18, 0.03)), pinionPt.clone().add(new Vector3(-0.02, 0.06, 0))], 0.011, { radial: 8 })],
    ],
  );
  // the steering wheel: rim, three spokes, the hub with the driver's airbag
  const sw: BufferGeometry[] = [];
  const ring = lathe([[0.17, -0.012], [0.182, -0.008], [0.183, 0.008], [0.17, 0.014], [0.162, 0.002]], 'y', 64);
  sw.push(ring);
  const spokesG: BufferGeometry[] = [];
  for (const a of [0, Math.PI * 0.78, -Math.PI * 0.78]) {
    const g = rbox(0.022, 0.012, 0.13, 0.005, 0, 0, 0.1);
    g.rotateY(a + Math.PI / 2);
    spokesG.push(g);
  }
  const hubG = lathe([[0, -0.03], [0.07, -0.03], [0.075, 0.0], [0.065, 0.02], [0, 0.025]], 'y', 32);
  const swGeo = merge([...sw, ...spokesG]);
  const swQ = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), colDir.clone().negate());
  const steeringWheel = rig.part(sprung, 'steering-wheel', 'steering-wheel', 'cabin', [['leather', swGeo, '#1d1e21'], ['polymer', hubG]], { pivot: wheelC.clone(), quat: swQ, local: true });

  return { corners, links, steeringWheel, column, rack, rackPinion, root };
}

/** An A-arm: a hinge between two inner pivots and a ball joint at the wheel. */
function armLink(rig: Rig, root: Object3D, name: string, comp: string, asm: string, a1: Vector3, a2: Vector3, b: Vector3, corner: number, r: number): Link {
  // built in a frame with the hinge axis along +x through the origin at a1
  const mid = a1.clone().add(a2).multiplyScalar(0.5);
  const geos = [rod(a1, b, r, 10), rod(a2, b, r, 10), at(alongAxis(lathe([[0, -0.025], [0.025, -0.025], [0.025, 0.025], [0, 0.025]], 'y', 14), 'x'), a1.x, a1.y, a1.z), at(alongAxis(lathe([[0, -0.025], [0.025, -0.025], [0.025, 0.025], [0, 0.025]], 'y', 14), 'x'), a2.x, a2.y, a2.z), at(lathe([[0, -0.02], [0.022, -0.02], [0.022, 0.02], [0, 0.02]], 'y', 14), b.x, b.y, b.z)];
  const node = rig.part(root, name, comp, asm, [['steel', merge(geos), '#2f3238']], { pivot: mid.clone() });
  return { node, a: mid, a2: a2.clone(), b: b.clone(), corner, kind: 'arm', restLen: mid.distanceTo(b) };
}

/** A straight link (tie rod, lateral link) between two points, posed by aiming and stretching. */
function stretchLink(rig: Rig, root: Object3D, name: string, comp: string, asm: string, a: Vector3, b: Vector3, corner: number, r: number, kind: Link['kind']): Link {
  const len = a.distanceTo(b);
  // local frame: from the origin (a) along +y to b
  const g = merge([rod(new Vector3(0, 0, 0), new Vector3(0, len, 0), r, 10), at(lathe([[0, -0.016], [r * 1.9, -0.016], [r * 1.9, 0.016], [0, 0.016]], 'y', 12), 0, 0, 0), at(lathe([[0, -0.016], [r * 1.9, -0.016], [r * 1.9, 0.016], [0, 0.016]], 'y', 12), 0, len, 0)]);
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
  const node = rig.part(root, name, comp, asm, [['steel', g, '#33363c']], { pivot: a.clone(), quat: q, local: true });
  return { node, a: a.clone(), b: b.clone(), corner, kind, restLen: len };
}

/** A damper with its coil spring (front) or alone (rear): body on the wheel side, rod to the body. */
function coilover(rig: Rig, root: Object3D, id: string, asm: string, top: Vector3, bottom: Vector3, corner: number, withSpring: boolean): Link[] {
  const len = top.distanceTo(bottom);
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), top.clone().sub(bottom).normalize());
  // body (tube) from the bottom up 55 % of the length, built along +y in its own frame
  const bodyLen = len * 0.55;
  const body = merge([
    lathe([[0, 0], [0.026, 0], [0.026, bodyLen], [0.012, bodyLen + 0.008], [0, bodyLen + 0.008]], 'y', 24),
    at(alongAxis(lathe([[0, -0.02], [0.016, -0.02], [0.016, 0.02], [0, 0.02]], 'y', 12), 'z'), 0, 0, 0),
  ]);
  const nodeBody = rig.part(root, `damper-${id}`, 'damper', asm, [['steel', body, '#2c2f35']], { pivot: bottom.clone(), quat: q, local: true });
  // the rod hangs from the top mount down into the body
  const rodLen = len * 0.55;
  const rodG = merge([lathe([[0, -rodLen], [0.009, -rodLen], [0.009, 0], [0, 0]], 'y', 14), lathe([[0, -0.01], [0.04, -0.01], [0.04, 0.01], [0, 0.01]], 'y', 24)]);
  const nodeRod = rig.part(root, `damper-rod-${id}`, 'damper', asm, [['machined', rodG]], { pivot: top.clone(), quat: q.clone(), local: true });
  const out: Link[] = [
    { node: nodeBody, a: top.clone(), b: bottom.clone(), corner, kind: 'damperBody', restLen: len },
    { node: nodeRod, a: top.clone(), b: bottom.clone(), corner, kind: 'damperRod', restLen: len },
  ];
  if (withSpring) {
    const sLen = len * 0.62;
    const g = spring(0.052, 0.0062, sLen, 6);
    const base = bottom.clone().lerp(top, 0.3);
    const sNode = rig.part(root, `coil-spring-${id}`, 'coil-spring', asm, [['steel', g, '#3b3f46']], { pivot: base, quat: q.clone(), local: true });
    out.push({ node: sNode, a: top.clone(), b: base.clone(), corner, kind: 'spring', restLen: top.distanceTo(base) });
  }
  return out;
}

/** A half shaft with an inner tripod joint and an outer ball joint in their boots. */
function halfShaft(rig: Rig, root: Object3D, id: string, inner: Vector3, outer: Vector3, corner: number): Link {
  const len = inner.distanceTo(outer);
  const g: BufferGeometry[] = [];
  g.push(lathe([[0, 0], [0.042, 0], [0.042, 0.07], [0.02, 0.09], [0, 0.09]], 'y', 24));
  g.push(lathe([[0, 0.08], [0.014, 0.08], [0.014, len - 0.08], [0, len - 0.08]], 'y', 14));
  const boot: BufferGeometry[] = [];
  for (const [y0, dir] of [
    [0.07, 1],
    [len - 0.07, -1],
  ] as [number, number][]) {
    const prof: [number, number][] = [];
    for (let k = 0; k <= 10; k++) {
      const u = k / 10;
      prof.push([0.04 - 0.024 * u + 0.006 * Math.sin(u * Math.PI * 6), y0 + dir * u * 0.08]);
    }
    if (dir < 0) prof.reverse();
    boot.push(lathe(prof, 'y', 18));
  }
  g.push(lathe([[0, len - 0.09], [0.02, len - 0.09], [0.045, len - 0.07], [0.045, len], [0, len]], 'y', 24));
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), outer.clone().sub(inner).normalize());
  const node = rig.part(root, `half-shaft-${id}`, 'half-shaft', 'driveline', [['steel', merge(g), '#4a4e55'], ['rubber', merge(boot)]], { pivot: inner.clone(), quat: q, local: true });
  return { node, a: inner.clone(), b: outer.clone(), corner, kind: 'halfshaft', restLen: len };
}
