/**
 * The renderer: one WebGL context, one scene, one camera, a post-processing chain chosen by the
 * quality tier, and WebGL context-loss handling. Nothing here decides what is shown; the World
 * does.
 *
 *   high / medium   render → ambient occlusion (N8AO) → subtle bloom → AgX tone mapping →
 *                   vignette, with MSAA on the scene target (SMAA when recording)
 *   low             render → AgX tone mapping → FXAA: one cheap full-screen pass, so edges are
 *                   smoothed deliberately even on weak devices (the context itself is created
 *                   without antialiasing; every tier owns its edge quality)
 *
 * Every tier draws the same scene, the same mechanisms and the same colours (all tone mapped
 * with AgX): only pixel ratio, shadow resolution, ambient occlusion, bloom, edge smoothing,
 * body detail and particle density change, and they change live (quality.ts).
 */
import { EffectComposer, EffectPass, RenderPass, BloomEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect, SMAAEffect, SMAAPreset, FXAAEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { Color, HalfFloatType, InstancedBufferAttribute, InstancedMesh, Mesh, NoToneMapping, PCFSoftShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer, type Material, type Object3D, type Texture } from 'three';
import { buildEnvironment } from './env';
import { FrameMonitor, FrameStats, TIERS, initialTier, useQuality, type Tier } from './quality';
import { CAPTURE, VIRTUAL_TIME, frameTime } from './time';

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

  /** Shadow resolution for the lights in the scene (call again when lights are added). */
  applyLights() {
    const spec = TIERS[this.tier];
    this.scene.traverse((o) => {
      const l = o as unknown as { isLight?: boolean; castShadow?: boolean; shadow?: { mapSize: { x: number; set(a: number, b: number): void }; map: { dispose(): void } | null } };
      if (l.isLight && l.castShadow && l.shadow && l.shadow.mapSize.x !== spec.shadowMap) {
        l.shadow.mapSize.set(spec.shadowMap, spec.shadowMap);
        l.shadow.map?.dispose();
        l.shadow.map = null;
      }
    });
  }

  private applyTier(t: Tier) {
    this.tier = t;
    const spec = TIERS[t];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, spec.dprMax));
    this.applyLights();
    this.composer?.dispose();
    this.composer = null;
    this.ao = null;
    // every tier tone maps in the effect pass, so colours match across tiers
    this.renderer.toneMapping = NoToneMapping;
    if (!spec.ao && !spec.bloom) {
      const composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType, multisampling: 0 });
      composer.addPass(new RenderPass(this.scene, this.camera));
      composer.addPass(new EffectPass(this.camera, new ToneMappingEffect({ mode: ToneMappingMode.AGX }), new FXAAEffect()));
      this.composer = composer;
    } else {
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
      if (spec.bloom) effects.push(new BloomEffect({ intensity: 0.2, luminanceThreshold: 1.0, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.45 }));
      effects.push(new ToneMappingEffect({ mode: ToneMappingMode.AGX }));
      effects.push(new VignetteEffect({ offset: 0.3, darkness: 0.38 }));
      if (!msaa) effects.push(new SMAAEffect({ preset: SMAAPreset.HIGH }));
      composer.addPass(new EffectPass(this.camera, ...effects));
      this.composer = composer;
    }
    this.resize(this.width, this.height);
  }

  /** What is drawn now: CSS size, drawing-buffer size and pixel ratio (they must agree). */
  get sizes() {
    const c = this.renderer.domElement;
    return { css: [this.width, this.height], buffer: [c.width, c.height], dpr: this.renderer.getPixelRatio(), tier: this.tier, composer: !!this.composer };
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

  /**
   * Compile the programs a scene needs before it is first drawn (no hitch mid-move). The
   * displayed scene is never altered: hidden parts are compiled through stand-ins (below).
   */
  async prewarm(scene: Scene = this.scene, opts: { onlyVisible?: boolean } = {}) {
    await this.compileInto(scene);
    if (opts.onlyVisible) return;
    // the hidden parts: compile their materials on stand-ins in a scene of their own
    const mats: Material[] = [];
    scene.traverse((o) => {
      if (o.visible) return;
      o.traverse((c) => {
        const m = (c as Mesh).material;
        if (m) for (const x of Array.isArray(m) ? m : [m]) mats.push(x);
      });
    });
    await this.compileMaterials(mats);
  }

  /**
   * Compile materials on stand-in meshes (the real geometry of a mesh that uses each one, so the
   * program variant is the one the scene will need) in a scene that is never displayed, lit by
   * the displayed scene's lights. Nothing visible changes while this runs.
   */
  async compileMaterials(materials: Material[]) {
    const wanted = new Set(materials);
    const stand = new Scene();
    const used = new Set<Material>();
    this.scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const pair = o.userData?.pair as Record<string, unknown> | undefined;
      const mats = o.userData?.mats as Record<string, unknown> | undefined;
      const cands: unknown[] = [mesh.material, ...(pair ? Object.values(pair) : []), ...(mats ? Object.values(mats) : [])];
      for (const m of cands) {
        if (!m || !(m as Material).isMaterial || !wanted.has(m as Material) || used.has(m as Material)) continue;
        used.add(m as Material);
        // an instanced mesh needs the instanced program: its stand-in is instanced too
        const inst = (mesh as InstancedMesh).isInstancedMesh ? (mesh as InstancedMesh) : null;
        const p = inst ? new InstancedMesh(mesh.geometry, m as Material, 1) : new Mesh(mesh.geometry, m as Material);
        if (inst?.instanceColor) (p as InstancedMesh).instanceColor = new InstancedBufferAttribute(new Float32Array(3), 3);
        p.castShadow = mesh.castShadow;
        p.receiveShadow = mesh.receiveShadow;
        p.renderOrder = mesh.renderOrder;
        p.matrixAutoUpdate = false;
        p.matrixWorld.copy(mesh.matrixWorld);
        p.frustumCulled = false;
        stand.add(p);
      }
    });
    if (!stand.children.length) return;
    await this.compileInto(stand, this.scene);
    for (const c of stand.children) if ((c as InstancedMesh).isInstancedMesh) (c as InstancedMesh).dispose();
    stand.clear();
  }

  /**
   * Compile for where the scene is really drawn: every tier draws through the composer, into a
   * linear target, so programs compiled for the screen (sRGB output) would be compiled again,
   * mid-move, the first time each is drawn.
   */
  private async compileInto(scene: Object3D, lights: Scene | null = null) {
    const r = this.renderer as WebGLRenderer & { compileAsync?: (s: Object3D, c: PerspectiveCamera, t?: Scene | null) => Promise<unknown> };
    const prev = r.getRenderTarget();
    const target = (this.composer as unknown as { inputBuffer?: import('three').WebGLRenderTarget } | null)?.inputBuffer ?? null;
    r.setRenderTarget(target);
    try {
      // compileAsync compiles synchronously and then waits for the driver: the target only
      // needs to be bound for the first part
      const done = r.compileAsync ? r.compileAsync(scene, this.camera, lights) : (r.compile(scene, this.camera, lights), Promise.resolve());
      r.setRenderTarget(prev);
      await done;
    } finally {
      r.setRenderTarget(prev);
    }
    await this.firstUse();
  }

  /** Programs whose first use is done (see firstUse). */
  private usedPrograms = new WeakSet<object>();
  /** Nothing authored is moving, so a stalled frame would go unseen (the World sets this). */
  quiet: () => boolean = () => true;

  /**
   * Take each new program's first use now, not at its first draw. three.js reads a program's
   * link result and its uniform and attribute tables at first use, and those reads wait for the
   * driver to finish linking. Without KHR_parallel_shader_compile (Firefox, software rendering,
   * some phones) compileAsync returns before anything is linked, so that wait would land on the
   * first frame of a move: seconds on a software renderer. Here it happens while the
   * destination is still being prepared, one program at a time, with the page free to respond
   * in between, and (where the wait is real) at a still moment.
   */
  private async firstUse() {
    const all = () => (this.renderer.info.programs ?? []) as unknown as { getUniforms(): unknown; getAttributes(): unknown }[];
    const gl = this.renderer.getContext();
    const waits = !gl.getExtension('KHR_parallel_shader_compile') && !VIRTUAL_TIME;
    for (const p of [...all()]) {
      if (this.usedPrograms.has(p)) continue;
      // let an authored move finish first (a few seconds at most): a stall then goes unseen
      if (waits) for (let t = 0; t < 3000 && !this.quiet(); t += 50) await new Promise((r) => setTimeout(r, 50));
      if (gl.isContextLost() || !all().includes(p)) continue;
      this.usedPrograms.add(p);
      p.getUniforms();
      p.getAttributes();
      await new Promise((r) => setTimeout(r, 0));
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
