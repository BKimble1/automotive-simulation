/**
 * The renderer: one WebGL context, one scene, one camera, a post-processing chain chosen by the
 * quality tier, and WebGL context-loss handling. Nothing here decides what is shown; the World
 * does.
 *
 *   high / medium   render → ambient occlusion (N8AO) → subtle bloom → AgX tone mapping →
 *                   vignette, with MSAA on the scene target (SMAA when recording)
 *   low             direct render with AgX tone mapping (software renderers, weak devices)
 */
import { EffectComposer, EffectPass, RenderPass, BloomEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect, SMAAEffect, SMAAPreset } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { AgXToneMapping, Color, HalfFloatType, NoToneMapping, PCFSoftShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer, type Texture } from 'three';
import { buildEnvironment } from './env';
import { FrameMonitor, FrameStats, TIERS, initialTier, useQuality, type Tier } from './quality';
import { CAPTURE, frameTime } from './time';

export class Stage {
  renderer: WebGLRenderer;
  scene = new Scene();
  camera = new PerspectiveCamera(30, 16 / 9, 0.05, 120);
  env: Texture;
  private composer: EffectComposer | null = null;
  private ao: N8AOPostPass | null = null;
  private tier: Tier;
  private monitor = new FrameMonitor();
  frames = new FrameStats();
  width = 1;
  height = 1;
  canvas: HTMLCanvasElement;
  private unsub: () => void;
  stats = { calls: 0, triangles: 0, programs: 0 };
  /** Set while the WebGL context is lost: nothing is drawn, the world holds its clocks. */
  contextLost = false;
  onContextChange?: (lost: boolean) => void;
  onTier?: (t: Tier) => void;
  onResize?: (w: number, h: number) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: CAPTURE,
      stencil: false,
      depth: true,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.info.autoReset = false;
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    const nav = navigator as Navigator & { deviceMemory?: number };
    this.tier = initialTier(rendererName, navigator.hardwareConcurrency || 4, nav.deviceMemory, matchMedia('(pointer: coarse)').matches, window.devicePixelRatio || 1);
    useQuality.setState({ tier: this.tier, renderer: rendererName, reason: useQuality.getState().reason === 'default' ? 'device' : useQuality.getState().reason });
    this.scene.background = new Color('#0b0c0e');
    this.env = buildEnvironment(this.renderer);
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.9;
    this.applyTier(this.tier);
    this.unsub = useQuality.subscribe((s) => {
      if (s.tier !== this.tier) {
        this.applyTier(s.tier);
        this.onTier?.(s.tier);
      }
    });
    canvas.addEventListener('webglcontextlost', this.lost, false);
    canvas.addEventListener('webglcontextrestored', this.restored, false);
  }

  private lost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
    this.onContextChange?.(true);
  };

  private restored = () => {
    // three.js re-uploads geometry, textures and programs on demand; the environment map is a
    // render target, so it is rebuilt
    this.env.dispose();
    this.env = buildEnvironment(this.renderer);
    this.scene.environment = this.env;
    this.applyTier(this.tier);
    this.contextLost = false;
    this.onContextChange?.(false);
  };

  get currentTier(): Tier {
    return this.tier;
  }

  private applyTier(t: Tier) {
    this.tier = t;
    const spec = TIERS[t];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, spec.dprMax));
    this.scene.traverse((o) => {
      const l = o as unknown as { isLight?: boolean; castShadow?: boolean; shadow?: { mapSize: { set(a: number, b: number): void }; map: { dispose(): void } | null } };
      if (l.isLight && l.castShadow && l.shadow) {
        l.shadow.mapSize.set(spec.shadowMap, spec.shadowMap);
        l.shadow.map?.dispose();
        l.shadow.map = null;
      }
    });
    this.composer?.dispose();
    this.composer = null;
    this.ao = null;
    if (spec.ao || spec.bloom) {
      this.renderer.toneMapping = NoToneMapping;
      const msaa = CAPTURE ? 0 : spec.msaa;
      const composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType, multisampling: msaa });
      composer.addPass(new RenderPass(this.scene, this.camera));
      if (spec.ao) {
        const ao = new N8AOPostPass(this.scene, this.camera, this.width, this.height);
        ao.configuration.aoRadius = 0.35;
        ao.configuration.distanceFalloff = 0.8;
        ao.configuration.intensity = 2.0;
        ao.configuration.halfRes = true;
        ao.configuration.depthAwareUpsampling = true;
        ao.configuration.gammaCorrection = false;
        ao.setQualityMode(spec.aoQuality);
        composer.addPass(ao);
        this.ao = ao;
      }
      const effects = [];
      if (spec.bloom) effects.push(new BloomEffect({ intensity: 0.28, luminanceThreshold: 0.95, luminanceSmoothing: 0.18, mipmapBlur: true, radius: 0.5 }));
      effects.push(new ToneMappingEffect({ mode: ToneMappingMode.AGX }));
      effects.push(new VignetteEffect({ offset: 0.3, darkness: 0.38 }));
      if (!msaa) effects.push(new SMAAEffect({ preset: SMAAPreset.HIGH }));
      composer.addPass(new EffectPass(this.camera, ...effects));
      this.composer = composer;
    } else {
      this.renderer.toneMapping = AgXToneMapping;
      this.renderer.toneMappingExposure = 1;
    }
    this.resize(this.width, this.height);
  }

  resize(w: number, h: number) {
    this.width = Math.max(1, Math.floor(w));
    this.height = Math.max(1, Math.floor(h));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.onResize?.(this.width, this.height);
    this.composer?.setSize(this.width, this.height);
    this.ao?.setSize(this.width, this.height);
  }

  render(dt: number) {
    if (this.contextLost) return;
    // the quality monitor and the statistics read the real interval, not the clamped step
    this.monitor.update(frameTime.raw);
    if (!frameTime.virtual) this.frames.push(frameTime.raw);
    this.renderer.info.reset();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.stats.calls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
    this.stats.programs = this.renderer.info.programs?.length ?? 0;
  }

  /** Compile every material in the scene before it is first drawn (no hitch mid-move). */
  async prewarm(scene: Scene = this.scene) {
    const r = this.renderer as WebGLRenderer & { compileAsync?: (s: Scene, c: PerspectiveCamera) => Promise<unknown> };
    // hidden objects are compiled too: force them visible for the compile
    const hidden: { visible: boolean }[] = [];
    scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    try {
      if (r.compileAsync) await r.compileAsync(scene, this.camera);
      else this.renderer.compile(scene, this.camera);
    } finally {
      for (const o of hidden) o.visible = false;
    }
  }

  /** Test hook: simulate a lost context (and restore it). */
  loseContext(restoreAfterMs = 600) {
    const ext = this.renderer.getContext().getExtension('WEBGL_lose_context');
    if (!ext) return false;
    ext.loseContext();
    setTimeout(() => ext.restoreContext(), restoreAfterMs);
    return true;
  }

  dispose() {
    this.unsub();
    this.canvas.removeEventListener('webglcontextlost', this.lost);
    this.canvas.removeEventListener('webglcontextrestored', this.restored);
    this.composer?.dispose();
    this.env.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
