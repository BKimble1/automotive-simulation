/**
 * The engineering studio the car stands in: a dark, seamless floor that fades into the
 * background (an infinite cyclorama), a turntable marked by a fine groove, a soft contact
 * shadow under the car, and the lights that match the reflection environment (env.ts): a key
 * from the front left that casts the shadows, a cool rim from behind, a soft overhead fill.
 */
import {
  AmbientLight,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type Texture,
} from 'three';

/** A soft rectangular shadow texture (drawn once on a canvas). */
function contactTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  const img = g.createImageData(256, 128);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 256; x++) {
      // a rounded rectangle falloff
      const u = (x + 0.5) / 256 - 0.5;
      const v = (y + 0.5) / 128 - 0.5;
      const dx = Math.max(0, Math.abs(u) - 0.3) / 0.2;
      const dy = Math.max(0, Math.abs(v) - 0.22) / 0.28;
      const d = Math.min(1, Math.hypot(dx, dy));
      const a = Math.pow(1 - d, 2.2) * (0.85 - 0.25 * Math.min(1, Math.hypot(u * 1.6, v * 2)));
      const i = (y * 256 + x) * 4;
      img.data[i] = 0;
      img.data[i + 1] = 0;
      img.data[i + 2] = 0;
      img.data[i + 3] = Math.round(255 * Math.max(0, a));
    }
  g.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  return t;
}

const FLOOR_VS = /* glsl */ `
varying vec3 vWorld;
varying vec4 vClip;
#include <common>
#include <shadowmap_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  vClip = gl_Position;
  vec3 transformedNormal = normalMatrix * vec3(0.0, 0.0, 1.0);
  vec4 worldPosition = wp;
  #include <shadowmap_vertex>
}
`;

const FLOOR_FS = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uFar;
uniform vec3 uLine;
uniform float uFade;
uniform float uDim;
varying vec3 vWorld;
varying vec4 vClip;
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
  float r = length(vWorld.xz);
  // a soft pool of light under the car, falling off into the background
  float pool = exp(-r * r / 34.0);
  vec3 col = mix(uFar, uBase, pool);
  // the turntable: a fine groove and a hairline, and very faint metre marks inside it
  float aa = fwidth(r);
  float groove = 1.0 - smoothstep(0.0, aa * 1.5, abs(r - 3.6));
  float hair = 1.0 - smoothstep(0.0, aa * 1.2, abs(r - 3.66));
  col = mix(col, col * 0.55, groove * 0.9);
  col += uLine * hair * 0.18;
  vec2 g = abs(fract(vWorld.xz + 0.5) - 0.5) / fwidth(vWorld.xz);
  float grid = 1.0 - min(min(g.x, g.y), 1.0);
  col += uLine * grid * 0.012 * smoothstep(3.6, 3.0, r);
  // shadows from the key light
  float sh = getShadowMask();
  col *= mix(0.55, 1.0, sh);
  // fade into the background with distance
  float fade = smoothstep(uFade * 0.45, uFade, r);
  col = mix(col, uFar, fade);
  // not tone mapped: the far floor must meet the background colour exactly (no horizon line)
  gl_FragColor = vec4(mix(col * uDim, uFar, fade), 1.0);
  #include <colorspace_fragment>
}
`;

export class Studio {
  group = new Group();
  key: DirectionalLight;
  rim: DirectionalLight;
  rim2: DirectionalLight;
  fill: HemisphereLight;
  ambient: AmbientLight;
  floor: Mesh;
  floorMat: ShaderMaterial;
  contact: Mesh;
  /** Overall dimming of the room (a "spotlight on the subject" moment), 0 … 1. */
  dim = 1;

  constructor() {
    const g = this.group;
    this.floorMat = new ShaderMaterial({
      vertexShader: FLOOR_VS,
      fragmentShader: FLOOR_FS,
      lights: true,
      toneMapped: false,
      // `lights: true` needs three's light uniforms (the key light's shadow map among them)
      uniforms: UniformsUtils.merge([
        UniformsLib.lights,
        {
        uBase: { value: new Color('#1d1f24') },
        uFar: { value: new Color('#0b0c0e') },
        uLine: { value: new Color('#9aa3b5') },
        uFade: { value: 15 },
        uDim: { value: 1 },
        },
      ]),
    });
    this.floor = new Mesh(new PlaneGeometry(60, 60, 1, 1), this.floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.floor.renderOrder = -10;
    this.floor.name = 'studio-floor';
    g.add(this.floor);

    this.contact = new Mesh(
      new PlaneGeometry(6.2, 2.9),
      new MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false, opacity: 0.92, color: new Color('#000000') }),
    );
    this.contact.rotation.x = -Math.PI / 2;
    this.contact.position.set(-0.1, 0.002, 0);
    this.contact.renderOrder = -9;
    g.add(this.contact);

    // key: front left, high, warm-neutral; it casts the shadows
    this.key = new DirectionalLight(new Color('#fff3e4'), 2.2);
    this.key.position.set(4.5, 7.5, -5.0);
    this.key.target.position.set(0, 0.4, 0);
    this.key.castShadow = true;
    const s = this.key.shadow;
    s.camera.left = -4;
    s.camera.right = 4;
    s.camera.top = 4;
    s.camera.bottom = -4;
    s.camera.near = 2;
    s.camera.far = 20;
    s.bias = -0.0004;
    s.normalBias = 0.02;
    s.radius = 4;
    s.mapSize.set(1024, 1024);
    g.add(this.key, this.key.target);
    // rims: cool, from behind on both sides (they draw the silhouette against the dark)
    this.rim = new DirectionalLight(new Color('#cfdcff'), 1.4);
    this.rim.position.set(-6, 3.5, 4.5);
    this.rim2 = new DirectionalLight(new Color('#dbe4ff'), 0.9);
    this.rim2.position.set(-5, 2.5, -5.5);
    g.add(this.rim, this.rim2);
    this.fill = new HemisphereLight(new Color('#c9d3e6'), new Color('#1a1714'), 0.45);
    g.add(this.fill);
    this.ambient = new AmbientLight(new Color('#ffffff'), 0.05);
    g.add(this.ambient);
  }

  setShadowFocus(center: Vector3, radius: number) {
    const s = this.key.shadow.camera;
    s.left = -radius;
    s.right = radius;
    s.top = radius;
    s.bottom = -radius;
    s.updateProjectionMatrix();
    this.key.target.position.copy(center);
    this.key.position.copy(center).add(new Vector3(4.5, 7.5, -5.0));
  }

  update(dim: number) {
    this.dim = dim;
    this.floorMat.uniforms.uDim.value = 0.55 + 0.45 * dim;
    this.key.intensity = 2.2 * (0.75 + 0.25 * dim);
    this.fill.intensity = 0.45 * (0.6 + 0.4 * dim);
  }
}
