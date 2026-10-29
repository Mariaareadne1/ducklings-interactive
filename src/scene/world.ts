import * as THREE from 'three';

/**
 * One light rig shared by every material. The look is painted rather than
 * photographic: a warm sun over a soft two-tone ramp, with shade that turns
 * cool lavender instead of simply darker. Colours are linear-light.
 */

// the sun sits high to the upper-left and a little in front, so what the camera
// sees is lit and shadows fall to the right, like the references
export const SUN_DIR = new THREE.Vector3(-0.62, 0.74, 0.26).normalize();

// THREE.Color parses hex as sRGB and stores linear values (ColorManagement is on).
const linear = (hex: string) => new THREE.Color(hex);

export const PAPER_HEX = '#f4efe4';

export interface WorldUniforms {
  [name: string]: THREE.IUniform;
  uTime: THREE.IUniform<number>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunColor: THREE.IUniform<THREE.Color>;
  uShadeColor: THREE.IUniform<THREE.Color>;
  uPaper: THREE.IUniform<THREE.Color>;
  uShadowMap: THREE.IUniform<THREE.Texture | null>;
  uShadowMatrix: THREE.IUniform<THREE.Matrix4>;
  uShadowUvPerMeter: THREE.IUniform<number>;
  uShadowDepthRange: THREE.IUniform<number>;
  uShadowEnabled: THREE.IUniform<number>;
  uWind: THREE.IUniform<number>;
  /** 0..1 — a breeze that leans reeds and turns pads. */
  uBreeze: THREE.IUniform<number>;
  /** Ripple rings on the water: (x, z, start time, strength). */
  uRipples: THREE.IUniform<THREE.Vector4[]>;
  /** Watercolour stains on the water as a creature is painted in: (x, z, start time, radius) and colour. */
  uBlooms: THREE.IUniform<THREE.Vector4[]>;
  uBloomColors: THREE.IUniform<THREE.Color[]>;
}

export const MAX_BLOOMS = 4;

export const MAX_RIPPLES = 48;

export function createWorldUniforms(): WorldUniforms {
  return {
    uTime: { value: 0 },
    uSunDir: { value: SUN_DIR.clone() },
    // multipliers on albedo: lit paint a touch warm, shade a soft lavender
    uSunColor: { value: linear('#fff7ea') },
    uShadeColor: { value: linear('#bdb9e3') },
    uPaper: { value: linear(PAPER_HEX) },
    uShadowMap: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowUvPerMeter: { value: 0.02 },
    uShadowDepthRange: { value: 40 },
    uShadowEnabled: { value: 0 },
    uWind: { value: 1 },
    uBreeze: { value: 0 },
    uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0)) },
    uBlooms: { value: Array.from({ length: MAX_BLOOMS }, () => new THREE.Vector4(0, 0, -100, 1)) },
    uBloomColors: { value: Array.from({ length: MAX_BLOOMS }, () => new THREE.Color(1, 1, 1)) },
  };
}
