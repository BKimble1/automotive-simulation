/**
 * The body's materials: graphite metallic paint with a clear coat, gloss-black trim, tinted
 * glass, lamps, grille and plate, all drawn on the one baked skin. Each panel mesh draws only
 * its own panel (other fragments are discarded), so a door can swing away or a hood can lift
 * with clean edges, and shut lines are real 3 mm gaps found per pixel.
 *
 * Every look has an opaque and an x-ray ("ghost") variant: a ghosted panel keeps its silhouette
 * as a faint glassy shell with brighter edges, so the car stays recognisable while what is
 * inside it is shown. The variants are separate material instances so both shader programs can
 * be compiled before they are first needed; switching between them at a ghost amount of zero
 * is invisible.
 */
import { Color, DoubleSide, FrontSide, MeshPhysicalMaterial, ShaderChunk, Vector3 } from 'three';
import { BODY_REGIONS_GLSL } from './bodyRegions';

export interface BodyUniforms {
  uPanel: { value: number };
  uGhost: { value: number };
  uGhostTint: { value: Color };
  uHighlight: { value: number };
  uHighlightColor: { value: Color };
  uBrake: { value: number };
  uDrl: { value: number };
  uReverse: { value: number };
  uOffset: { value: Vector3 };
}

/** Shared lamp state: every panel's lamps read the same values. */
export const LAMPS = { uBrake: { value: 0 }, uDrl: { value: 1 }, uReverse: { value: 0 }, uBodyDebug: { value: 0 } };

const COMMON = /* glsl */ `
varying vec3 vObj;
varying vec3 vObjN;
uniform int uPanel;
uniform float uGhost;
uniform vec3 uGhostTint;
uniform float uHighlight;
uniform vec3 uHighlightColor;
uniform float uBrake;
uniform float uDrl;
uniform float uReverse;
uniform vec3 uOffset;
uniform float uBodyDebug;
${BODY_REGIONS_GLSL}

// regions: 0 paint, 1 glass, 2 gloss black trim, 3 headlamp lens, 4 tail lamp lens, 5 grille,
// 6 satin black (cladding, diffuser), 7 plate, 8 headlamp chrome, 9 DRL, 10 light bar
int bRegion(vec3 p, vec3 n, out float aux) {
  aux = 0.0;
  float x = p.x; float y = p.y; float az = abs(p.z);
  // side glass, the B-pillar and the quarter-glass divider
  if (az > 0.5 && abs(n.z) > 0.38 && y > bBelt(x) - 0.004) {
    float dl = bDlo(vec2(x, y));
    if (dl < 0.0) {
      float bc = -0.165 - (y - 1.03) * 0.22;
      if (abs(x - bc) < 0.045) return 2;
      if (abs(x - (-1.0 - (y - 1.04) * 0.1)) < 0.009) return 2;
      return 1;
    }
    if (dl < 0.013) return 2;
  }
  // windscreen (with its black frit band)
  if (y > 0.972 && x > 0.12 && n.x > 0.12 && abs(n.z) < 0.4 && az < 0.8) {
    float edge = min(min(0.4 - abs(n.z), (y - 0.972) * 1.2), (x - 0.12) * 1.0);
    return edge < 0.045 ? 2 : 1;
  }
  // rear screen
  if (y > bBelt(x) + 0.018 && x < -0.93 && x > -1.765 && n.x < -0.1 && abs(n.z) < 0.4) {
    float edge = min(0.4 - abs(n.z), min((x + 1.765) * 0.9, (y - bBelt(x) - 0.018) * 1.5));
    return edge < 0.035 ? 2 : 1;
  }
  // A-pillars in gloss black, so the painted roof floats above the glass
  if (x > 0.05 && y > bBelt(x) + 0.004 && y < 1.37 && az > 0.45 && x < 0.97) return 2;
  // headlamps: a slender lens wrapping round the front corners
  if (x > 1.75) {
    float u = az + max(0.0, 2.06 - x);
    float k = clamp((u - 0.46) / 0.58, 0.0, 1.0);
    float top = 0.744 - 0.012 * k * k;
    float bot = 0.668 + 0.052 * pow(k, 1.6);
    if (u > 0.455 && u < 1.04 && y > bot && y < top) {
      aux = k;
      if (y > top - 0.0135 && y < top - 0.0065 && u > 0.49 && u < 1.0) return 9;
      // inside the lens: a chrome reflector band and the dark lens
      if (y < bot + 0.018 && u > 0.5 && u < 0.95) return 8;
      return 3;
    }
    // grille and lower intake
    if (x > 2.0 && n.x > 0.3) {
      vec2 g = vec2(az, y);
      // upper grille: a slim trapezoid between the lamps
      float hw = 0.3 + (0.6 - y) * 0.35;
      vec2 q = abs(g - vec2(0.0, 0.555)) - vec2(hw, 0.05);
      float gr = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.025;
      if (gr < 0.0) { aux = 1.0; return gr > -0.01 ? 2 : 5; }
      // lower intake: one wide opening with the radiator behind it
      float lw = 0.56 - (0.38 - y) * 0.6;
      vec2 q2 = abs(g - vec2(0.0, 0.33)) - vec2(lw, 0.055);
      float lo = length(max(q2, 0.0)) + min(max(q2.x, q2.y), 0.0) - 0.03;
      if (lo < 0.0) { aux = 0.0; return lo > -0.01 ? 2 : 5; }
      // corner air curtains
      vec2 q3 = abs(g - vec2(0.76, 0.36)) - vec2(0.03, 0.07);
      float sv = length(max(q3, 0.0)) + min(max(q3.x, q3.y), 0.0) - 0.012;
      if (sv < 0.0) return 6;
    }
  }
  // tail lamps and the light bar
  if (x < -2.12) {
    float u = az + max(0.0, x + 2.33);
    float k = clamp((u - 0.5) / 0.62, 0.0, 1.0);
    float top = 0.962 - 0.01 * k;
    float bot = 0.872 + 0.03 * k * k;
    if (u > 0.5 && u < 1.12 && y > bot && y < top) {
      // the LED line inside the lens
      aux = (y > top - 0.024 && y < top - 0.014 && u < 1.08) ? 2.0 + k : k;
      return 4;
    }
    if (x < -2.36 && az <= 0.5 && y > 0.913 && y < 0.923) return 10;
    // licence plate
    if (x < -2.38 && az < 0.255 && y > 0.585 && y < 0.705) return 7;
    // diffuser
    if (y < 0.34 && n.y < 0.75) return 6;
  }
  // sills and lower cladding
  if (y < 0.205 && az > 0.55) return 6;
  return 0;
}

// the panel a point belongs to, found a few millimetres away in four directions: a different
// answer means a shut line runs through this pixel
float bGap(vec3 p, vec3 n, int own) {
  vec3 t1 = normalize(abs(n.y) < 0.9 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(n, t1);
  float px = length(fwidth(p));
  float g = max(0.0016, px * 0.6);
  int a = bPanelOf(p + t1 * g);
  int b = bPanelOf(p - t1 * g);
  int c = bPanelOf(p + t2 * g);
  int d = bPanelOf(p - t2 * g);
  float hit = (a != own || b != own || c != own || d != own) ? 1.0 : 0.0;
  // thinner than a pixel far away: fade, as a real gap does
  return hit * clamp(0.0035 / max(px, 1e-5), 0.25, 1.0);
}
`;

function patch(m: MeshPhysicalMaterial, u: BodyUniforms, kind: 'paint' | 'glass', ghost: boolean) {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, LAMPS);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;\nvarying vec3 vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;\nvObjN = normal;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${COMMON}`);
    // which panel and which region this pixel is
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
      vec3 bN = normalize(vObjN);
      int bOwn = bPanelOf(vObj);
      if (bOwn != uPanel) discard;
      float bAux;
      int bReg = bRegion(vObj, bN, bAux);
      ${kind === 'glass' ? 'if (bReg != 1) discard;' : 'if (bReg == 1) discard;'}
      float bGapAmt = ${kind === 'paint' ? 'bGap(vObj, bN, bOwn)' : '0.0'};
      `,
    );
    if (kind === 'paint') {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          if (bReg == 2) diffuseColor.rgb = vec3(0.012, 0.013, 0.015);
          else if (bReg == 3) diffuseColor.rgb = vec3(0.03, 0.033, 0.038);
          else if (bReg == 4) diffuseColor.rgb = bAux >= 2.0 ? vec3(0.35, 0.03, 0.03) : vec3(0.07, 0.006, 0.008);
          else if (bReg == 5) {
            // horizontal slats (upper) or a fine mesh (lower), dark behind
            float slat = abs(fract(vObj.y * (bAux > 0.5 ? 55.0 : 70.0)) - 0.5);
            vec2 g = vec2(vObj.z, vObj.y) * 60.0;
            float mesh = min(abs(fract(g.x + g.y) - 0.5), abs(fract(g.x - g.y) - 0.5));
            float lit = bAux > 0.5 ? smoothstep(0.32, 0.22, slat) : smoothstep(0.1, 0.2, mesh) * 0.5;
            diffuseColor.rgb = mix(vec3(0.002), vec3(0.016, 0.017, 0.019), lit);
          }
          else if (bReg == 6) diffuseColor.rgb = vec3(0.02, 0.021, 0.024);
          else if (bReg == 7) diffuseColor.rgb = vec3(0.62, 0.63, 0.6);
          else if (bReg == 8) diffuseColor.rgb = vec3(0.55, 0.57, 0.6);
          else if (bReg == 9) diffuseColor.rgb = vec3(0.9);
          else if (bReg == 10) diffuseColor.rgb = vec3(0.14, 0.01, 0.012);
          diffuseColor.rgb *= 1.0 - 0.92 * bGapAmt;
          if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.01, 0.011, 0.012);
          `,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          if (bReg == 2 || bReg == 3 || bReg == 4 || bReg == 8 || bReg == 10) roughnessFactor = 0.06;
          else if (bReg == 5 || bReg == 6) roughnessFactor = 0.62;
          else if (bReg == 7) roughnessFactor = 0.45;
          if (!gl_FrontFacing) roughnessFactor = 0.9;`,
        )
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
          if (bReg == 8) metalnessFactor = 1.0;
          else if (bReg != 0) metalnessFactor = 0.0;
          if (!gl_FrontFacing) metalnessFactor = 0.0;`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          if (bReg == 9) totalEmissiveRadiance += vec3(0.85, 0.9, 1.0) * 2.2 * uDrl;
          if (bReg == 4) totalEmissiveRadiance += vec3(1.0, 0.04, 0.03) * (bAux >= 2.0 ? (0.9 + 2.2 * uBrake) : (0.04 + 0.9 * uBrake));
          if (bReg == 10) totalEmissiveRadiance += vec3(1.0, 0.05, 0.03) * (0.5 + 1.6 * uBrake);
          if (bReg == 3) totalEmissiveRadiance += vec3(0.6, 0.65, 0.75) * 0.03 * uDrl;
          totalEmissiveRadiance += uHighlightColor * uHighlight * 0.05;`,
        );
      // clear coat only on paint, gloss trim and lenses (the include is expanded here so the
      // line can be changed; includes are otherwise resolved after this hook)
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_physical_fragment>',
        ShaderChunk.lights_physical_fragment.replace(
          'material.clearcoat = clearcoat;',
          'material.clearcoat = (bReg == 5 || bReg == 6 || bReg == 7 || !gl_FrontFacing) ? 0.0 : clearcoat;',
        ),
      );
    }
    // selection rim and the x-ray ghost
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      {
        vec3 V = normalize(vViewPosition);
        float fres = pow(1.0 - clamp(abs(dot(normalize(vNormal), V)), 0.0, 1.0), 2.2);
        gl_FragColor.rgb += uHighlightColor * uHighlight * fres * 0.35;
        if (uBodyDebug > 0.5) {
          float id = float(bPanelOf(vObj));
          gl_FragColor.rgb = 0.5 + 0.5 * cos(6.2831 * (id * 0.137 + vec3(0.0, 0.33, 0.67)));
          if (!gl_FrontFacing) gl_FragColor.rgb = vec3(1.0, 0.0, 1.0);
        }
        ${
          ghost
            ? `gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 0.25 + uGhostTint * (0.05 + 0.55 * fres), uGhost);
               gl_FragColor.a = mix(gl_FragColor.a, 0.035 + 0.3 * fres, uGhost);`
            : ''
        }
      }`,
    );
  };
  m.customProgramCacheKey = () => `body-${kind}-${ghost ? 'g' : 'o'}`;
}

export interface BodyMaterialSet {
  uniforms: BodyUniforms;
  paint: MeshPhysicalMaterial;
  paintGhost: MeshPhysicalMaterial;
  glass: MeshPhysicalMaterial;
  glassGhost: MeshPhysicalMaterial;
}

export const PAINT_COLOR = new Color('#2c3038');

export function bodyMaterials(panel: number): BodyMaterialSet {
  const u: BodyUniforms = {
    uPanel: { value: panel },
    uGhost: { value: 0 },
    uGhostTint: { value: new Color('#9fb2d6') },
    uHighlight: { value: 0 },
    uHighlightColor: { value: new Color('#b9b2ff') },
    uBrake: LAMPS.uBrake,
    uDrl: LAMPS.uDrl,
    uReverse: LAMPS.uReverse,
    uOffset: { value: new Vector3() },
  };
  const paintParams = {
    color: PAINT_COLOR,
    metalness: 0.62,
    roughness: 0.34,
    clearcoat: 1,
    clearcoatRoughness: 0.035,
    envMapIntensity: 1,
  };
  const paint = new MeshPhysicalMaterial({ ...paintParams, side: DoubleSide });
  patch(paint, u, 'paint', false);
  const paintGhost = new MeshPhysicalMaterial({ ...paintParams, side: FrontSide, transparent: true, depthWrite: false });
  patch(paintGhost, u, 'paint', true);
  const glassParams = {
    color: new Color('#05070a'),
    metalness: 0.0,
    roughness: 0.04,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    envMapIntensity: 1.4,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
  };
  const glass = new MeshPhysicalMaterial({ ...glassParams, side: DoubleSide });
  patch(glass, u, 'glass', false);
  const glassGhost = new MeshPhysicalMaterial({ ...glassParams, side: FrontSide });
  patch(glassGhost, u, 'glass', true);
  return { uniforms: u, paint, paintGhost, glass, glassGhost };
}
