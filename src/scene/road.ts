/**
 * The rolling road: when the car drives, the car stays on the studio's turntable and the road
 * moves under it. The road is drawn in the car's frame; its shader turns each point into road
 * coordinates from the car's position and heading (from the model), so lane markings slide
 * past at exactly the car's speed, and swing round in a corner. A speed bump and a low-grip
 * patch are drawn where the model's road profile puts them.
 */
import { Color, Mesh, PlaneGeometry, ShaderMaterial, Group } from 'three';

const VS = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FS = /* glsl */ `
uniform float uOpacity;
uniform vec3 uCar;      // road x, road z, heading
uniform float uCurve;   // 1/radius of the lane (0 straight), positive turning left
uniform float uCurveX;  // where the curve begins (road x)
uniform float uBumpAt;  // road distance of a bump's centre (or -1e6)
uniform float uLowGrip; // 0 dry, 1 a slippery surface
uniform vec3 uFar;
varying vec2 vLocal;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  // local plane: x forward, y = −z (the plane is rotated flat)
  vec2 loc = vec2(vLocal.x, -vLocal.y);
  float c = cos(uCar.z), s = sin(uCar.z);
  // road coordinates of this point
  vec2 w = vec2(uCar.x + loc.x * c + loc.y * s, uCar.y - loc.x * s + loc.y * c);
  // distance along and across the lane: a straight lane along x (across = z, to the right),
  // turning into an arc of radius 1/uCurve after uCurveX (a left turn for uCurve > 0)
  float along = w.x;
  float across = w.y;
  if (abs(uCurve) > 1e-5 && w.x > uCurveX) {
    float R = 1.0 / uCurve;
    vec2 ctr = vec2(uCurveX, -R);
    vec2 d = w - ctr;
    float r = length(d);
    across = (r - abs(R)) * sign(R);
    along = uCurveX + abs(R) * atan(d.x, sign(R) * d.y);
  }
  float aa = fwidth(along) + fwidth(across);
  vec3 asphalt = vec3(0.05, 0.052, 0.056) + (hash(floor(w * 40.0)) - 0.5) * 0.012;
  if (uLowGrip > 0.0) asphalt = mix(asphalt, vec3(0.42, 0.45, 0.5), 0.55 * uLowGrip);
  vec3 col = asphalt;
  // edge lines and the dashed centre line (in road coordinates: they slide past at road speed)
  float edge = max(1.0 - smoothstep(0.06, 0.06 + aa, abs(across - 1.85)), 1.0 - smoothstep(0.06, 0.06 + aa, abs(across + 5.55)));
  float dash = step(0.5, fract(along / 6.0));
  float centre = (1.0 - smoothstep(0.05, 0.05 + aa, abs(across + 1.85))) * dash;
  col = mix(col, vec3(0.78, 0.78, 0.74), max(edge, centre) * 0.85);
  // a speed bump: yellow and black chevrons across the lane
  float b = along - uBumpAt;
  if (abs(b) < 0.3) {
    float stripe = step(0.5, fract((across + b) * 1.6));
    col = mix(col, mix(vec3(0.75, 0.6, 0.12), vec3(0.04), stripe), 0.85 * (1.0 - smoothstep(0.24, 0.3, abs(b))));
  }
  // fade at the edges of the drawn patch into the studio's darkness
  float r = length(loc);
  float fade = smoothstep(18.0, 7.0, r);
  gl_FragColor = vec4(mix(uFar, col, fade), uOpacity * fade);
  #include <colorspace_fragment>
}`;

export class Road {
  group = new Group();
  mesh: Mesh;
  mat: ShaderMaterial;
  constructor() {
    this.mat = new ShaderMaterial({
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uOpacity: { value: 0 },
        uCar: { value: [0, 0, 0] },
        uCurve: { value: 0 },
        uCurveX: { value: 0 },
        uBumpAt: { value: -1e6 },
        uLowGrip: { value: 0 },
        uFar: { value: new Color('#0b0c0e') },
      },
    });
    this.mesh = new Mesh(new PlaneGeometry(40, 40, 1, 1), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.0015;
    this.mesh.renderOrder = -8;
    this.mesh.name = 'rolling-road';
    this.mesh.visible = false;
    this.group.add(this.mesh);
  }
  update(opacity: number, x: number, z: number, heading: number, opts: { curve?: number; curveX?: number; bumpAt?: number; lowGrip?: number } = {}) {
    this.mesh.visible = opacity > 0.003;
    this.mat.uniforms.uOpacity.value = opacity;
    this.mat.uniforms.uCar.value = [x, z, heading];
    this.mat.uniforms.uCurve.value = opts.curve ?? 0;
    this.mat.uniforms.uCurveX.value = opts.curveX ?? 0;
    this.mat.uniforms.uBumpAt.value = opts.bumpAt ?? -1e6;
    this.mat.uniforms.uLowGrip.value = opts.lowGrip ?? 0;
  }
}
