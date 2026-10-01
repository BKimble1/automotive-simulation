/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The FAB / ONE homepage, when this simulation is built as part of the site (the site's
   * build sets it, with the route as the base: `vite build --base /automotive/`).
   * Unset when the simulation is built or developed on its own.
   */
  readonly VITE_FABONE_HOME?: string;
}

declare module 'n8ao' {
  import type { Camera, Scene } from 'three';
  import type { Pass } from 'postprocessing';
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      halfRes: boolean;
      depthAwareUpsampling: boolean;
      gammaCorrection: boolean;
      aoSamples: number;
      denoiseSamples: number;
      denoiseRadius: number;
      color: import('three').Color;
      screenSpaceRadius: boolean;
    };
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setSize(width: number, height: number): void;
  }
}
