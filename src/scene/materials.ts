/**
 * Materials for everything but the body skin: cast iron, machined steel, satin and cast
 * aluminium, black polymer, rubber, copper, brass, hoses, fabric, leather, the cut faces of a
 * section (hatched, like an engineering drawing), and the glowing elements of the lessons.
 *
 * Every part material is a MeshPhysicalMaterial extended in its shader with:
 *   - uHighlight: the selected assembly's restrained edge light (a fresnel rim, never a glow);
 *   - uGhost:     the x-ray look (a faint shell with brighter silhouette edges);
 *   - uDim:       isolation (the rest of the car recedes while one system is shown);
 *   - uHeat:      a thermal tint (0 … 1 on a black-body ramp), tied to the model's temperatures.
 * Each assembly gets its own instances (so it can be lit or ghosted alone); instances of the
 * same kind share one compiled program. Opaque and ghost variants are separate instances,
 * compiled before they are needed.
 */
import { Color, DoubleSide, FrontSide, MeshPhysicalMaterial, MeshBasicMaterial, AdditiveBlending, type Side } from 'three';

export type MatKind =
  | 'iron'
  | 'steel'
  | 'machined'
  | 'aluminium'
  | 'castAl'
  | 'polymer'
  | 'polymerGloss'
  | 'rubber'
  | 'tyre'
  | 'copper'
  | 'brass'
  | 'hose'
  | 'fabric'
  | 'leather'
  | 'trim'
  | 'rotor'
  | 'caliper'
  | 'pad'
  | 'glassInt'
  | 'screen'
  | 'section'
  | 'chrome'
  | 'paintBlack'
  | 'structure'
  | 'structureHi'
  | 'structureUhss'
  | 'airbag'
  | 'belt'
  | 'catalyst'
  | 'muffler'
  | 'radiator'
  | 'battery'
  | 'filter'
  | 'harness'
  | 'fluidOil'
  | 'fluidCoolant';

interface KindSpec {
  color: string;
  metalness: number;
  roughness: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  side?: Side;
  /** Object-space noise on roughness (cast and machined surfaces are never CG-perfect). */
  noise?: number;
  noiseScale?: number;
  emissive?: string;
  emissiveIntensity?: number;
  sheen?: number;
}

export const KINDS: Record<MatKind, KindSpec> = {
  iron: { color: '#3d3f43', metalness: 0.75, roughness: 0.62, noise: 0.18, noiseScale: 140 },
  steel: { color: '#8a8e95', metalness: 0.92, roughness: 0.34, noise: 0.08, noiseScale: 220 },
  machined: { color: '#b9bdc3', metalness: 1.0, roughness: 0.2, noise: 0.05, noiseScale: 400 },
  aluminium: { color: '#c3c7cd', metalness: 0.95, roughness: 0.36, noise: 0.06, noiseScale: 260 },
  castAl: { color: '#9da2a8', metalness: 0.85, roughness: 0.55, noise: 0.16, noiseScale: 160 },
  polymer: { color: '#17181b', metalness: 0.0, roughness: 0.62, noise: 0.06, noiseScale: 300 },
  polymerGloss: { color: '#111214', metalness: 0.0, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2 },
  rubber: { color: '#121314', metalness: 0.0, roughness: 0.86 },
  tyre: { color: '#0c0c0d', metalness: 0.0, roughness: 0.78, sheen: 0.04 },
  copper: { color: '#b8734a', metalness: 1.0, roughness: 0.32 },
  brass: { color: '#b39255', metalness: 1.0, roughness: 0.35 },
  hose: { color: '#1a1b1e', metalness: 0.0, roughness: 0.7 },
  fabric: { color: '#2a2c31', metalness: 0.0, roughness: 0.95, sheen: 0.5 },
  leather: { color: '#2b2622', metalness: 0.0, roughness: 0.58, clearcoat: 0.15, clearcoatRoughness: 0.5 },
  trim: { color: '#22252a', metalness: 0.2, roughness: 0.45 },
  rotor: { color: '#6f7277', metalness: 0.9, roughness: 0.42, noise: 0.12, noiseScale: 500 },
  caliper: { color: '#2d3036', metalness: 0.6, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.2 },
  pad: { color: '#3a3532', metalness: 0.1, roughness: 0.9 },
  glassInt: { color: '#0a0c10', metalness: 0.0, roughness: 0.05 },
  screen: { color: '#06070a', metalness: 0.0, roughness: 0.12, emissive: '#2a3448', emissiveIntensity: 0.6 },
  section: { color: '#cdbfae', metalness: 0.0, roughness: 0.7 },
  chrome: { color: '#d8dce2', metalness: 1.0, roughness: 0.08 },
  paintBlack: { color: '#0d0e10', metalness: 0.3, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.1 },
  structure: { color: '#7c8592', metalness: 0.7, roughness: 0.45 },
  structureHi: { color: '#5d7fa8', metalness: 0.6, roughness: 0.45 },
  structureUhss: { color: '#b08a3e', metalness: 0.6, roughness: 0.45 },
  airbag: { color: '#d9d6cf', metalness: 0.0, roughness: 0.85, sheen: 0.6 },
  belt: { color: '#1d1f23', metalness: 0.0, roughness: 0.8, sheen: 0.3 },
  catalyst: { color: '#8b8f96', metalness: 0.85, roughness: 0.45, noise: 0.1 },
  muffler: { color: '#5b5e63', metalness: 0.85, roughness: 0.5, noise: 0.12 },
  radiator: { color: '#3b3e44', metalness: 0.7, roughness: 0.5 },
  battery: { color: '#1b1d20', metalness: 0.0, roughness: 0.5 },
  filter: { color: '#3a3d43', metalness: 0.4, roughness: 0.5 },
  harness: { color: '#141517', metalness: 0.0, roughness: 0.75 },
  fluidOil: { color: '#7a4e17', metalness: 0.0, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 },
  fluidCoolant: { color: '#1e7d64', metalness: 0.0, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 },
};

export interface PartUniforms {
  uHighlight: { value: number };
  uHighlightColor: { value: Color };
  uGhost: { value: number };
  uGhostTint: { value: Color };
  uDim: { value: number };
  uHeat: { value: number };
  uNoise: { value: number };
  uNoiseScale: { value: number };
  uSection: { value: number };
}

export type PartMaterial = MeshPhysicalMaterial & { userData: { u: PartUniforms; kind: MatKind; ghost: boolean } };

const NOISE = /* glsl */ `
float pmHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float pmNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(pmHash(i), pmHash(i + vec3(1,0,0)), f.x), mix(pmHash(i + vec3(0,1,0)), pmHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(pmHash(i + vec3(0,0,1)), pmHash(i + vec3(1,0,1)), f.x), mix(pmHash(i + vec3(0,1,1)), pmHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
vec3 pmHeatRamp(float t) {
  // black body: dark red, orange, yellow, toward white; t in 0 … 1
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.35, 0.02, 0.01);
  vec3 b = vec3(0.95, 0.28, 0.03);
  vec3 c = vec3(1.0, 0.75, 0.25);
  return t < 0.5 ? mix(a, b, t * 2.0) : mix(b, c, (t - 0.5) * 2.0);
}
`;

function patch(m: MeshPhysicalMaterial, u: PartUniforms, ghost: boolean, _kind: MatKind) {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPmObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPmObj = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vPmObj;
        uniform float uHighlight; uniform vec3 uHighlightColor; uniform float uGhost; uniform vec3 uGhostTint;
        uniform float uDim; uniform float uHeat; uniform float uNoise; uniform float uNoiseScale; uniform float uSection;
        ${NOISE}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (pmNoise(vPmObj * uNoiseScale) - 0.5) * uNoise, 0.03, 1.0);`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, pmHeatRamp(uHeat) * 0.6, smoothstep(0.0, 0.25, uHeat) * 0.85);`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        #ifdef DOUBLE_SIDED
        // seen from inside a cut part, its back faces are its cut face: drawn below as a section
        bool pmSection = !gl_FrontFacing && uSection > 0.5;
        #else
        bool pmSection = false;
        #endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += pmHeatRamp(uHeat) * smoothstep(0.15, 1.0, uHeat) * 1.6;`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        {
          vec3 V = normalize(vViewPosition);
          float fres = pow(1.0 - clamp(abs(dot(normalize(vNormal), V)), 0.0, 1.0), 2.4);
          gl_FragColor.rgb += uHighlightColor * uHighlight * (0.06 + 0.5 * fres);
          if (pmSection) {
            // a cut face: warm light grey with 45° hatching, evenly lit, like a drawing
            vec2 hp = gl_FragCoord.xy;
            float hh = abs(fract((hp.x + hp.y) * 0.11) - 0.5);
            gl_FragColor.rgb = vec3(0.62, 0.57, 0.5) * mix(0.72, 1.0, smoothstep(0.1, 0.2, hh));
          }
          // isolation: the rest of the car recedes toward the studio's darkness
          gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 0.18 + vec3(0.012, 0.013, 0.016), uDim * 0.82);
          ${
            ghost
              ? `gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 0.2 + uGhostTint * (0.04 + 0.5 * fres), uGhost);
                 gl_FragColor.a *= mix(1.0, 0.03 + 0.28 * fres, uGhost);`
              : ''
          }
        }`,
      );
  };
  m.customProgramCacheKey = () => `pm-std-${ghost ? 'g' : 'o'}`;
}

/** A pair of materials (opaque, ghost) of a kind, with their shared uniforms. */
export interface MatPair {
  kind: MatKind;
  u: PartUniforms;
  opaque: PartMaterial;
  ghost: PartMaterial;
}

export function makePair(kind: MatKind, opts: { color?: string; side?: Side; clip?: import('three').Plane } = {}): MatPair {
  const k = KINDS[kind];
  const u: PartUniforms = {
    uHighlight: { value: 0 },
    uHighlightColor: { value: new Color('#b9b2ff') },
    uGhost: { value: 0 },
    uGhostTint: { value: new Color('#9fb2d6') },
    uDim: { value: 0 },
    uHeat: { value: 0 },
    uNoise: { value: k.noise ?? 0.04 },
    uNoiseScale: { value: k.noiseScale ?? 200 },
    uSection: { value: 0 },
  };
  const base = {
    color: new Color(opts.color ?? k.color),
    metalness: k.metalness,
    roughness: k.roughness,
    clearcoat: k.clearcoat ?? 0,
    clearcoatRoughness: k.clearcoatRoughness ?? 0,
    sheen: k.sheen ?? 0,
    sheenColor: new Color('#ffffff'),
    sheenRoughness: 0.6,
    emissive: new Color(k.emissive ?? '#000000'),
    emissiveIntensity: k.emissiveIntensity ?? 1,
  };
  // an assembly that can be cut away is drawn double-sided (its back faces become the section)
  // and clipped by its own plane (parked far away when it is not cutting)
  const opaque = new MeshPhysicalMaterial({ ...base, side: opts.clip ? DoubleSide : (opts.side ?? k.side ?? FrontSide) }) as PartMaterial;
  patch(opaque, u, false, kind);
  opaque.userData = { u, kind, ghost: false };
  const ghost = new MeshPhysicalMaterial({ ...base, side: FrontSide, transparent: true, depthWrite: false }) as PartMaterial;
  patch(ghost, u, true, kind);
  ghost.userData = { u, kind, ghost: true };
  if (opts.clip) {
    opaque.clippingPlanes = [opts.clip];
    ghost.clippingPlanes = [opts.clip];
    u.uSection.value = 1;
  }
  return { kind, u, opaque, ghost };
}

/** The lessons' own marks (flows, arrows, pulses): unlit, additive or plain. */
export function vizMaterial(color: string, opts: { additive?: boolean; opacity?: number; side?: Side } = {}): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: new Color(color),
    transparent: true,
    opacity: opts.opacity ?? 1,
    depthWrite: false,
    blending: opts.additive ? AdditiveBlending : undefined,
    side: opts.side ?? DoubleSide,
    toneMapped: false,
  });
}
