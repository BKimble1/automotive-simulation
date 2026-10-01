/**
 * Rendering quality: three tiers chosen from the device, lowered (or raised back) from measured
 * frame times, with hysteresis. A tier changes only how the picture is drawn (pixel ratio,
 * shadow resolution, ambient occlusion, bloom, edge smoothing, body detail, particle density),
 * never what is shown or when: the low tier still runs every mechanism and every lesson in full.
 *
 * ?quality=high|medium|low forces a tier (tests, captures). Software renderers (SwiftShader,
 * llvmpipe) start at low.
 */
import { create } from 'zustand';

export type Tier = 'high' | 'medium' | 'low';

export interface TierSpec {
  dprMax: number;
  shadowMap: number;
  ao: boolean;
  bloom: boolean;
  msaa: number;
  aoQuality: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra';
  /** Body mesh detail. */
  bodyLod: 'hi' | 'lo';
  /** Share of flow particles drawn (the flows themselves always run). */
  particles: number;
}

export const TIERS: Record<Tier, TierSpec> = {
  high: { dprMax: 2, shadowMap: 2048, ao: true, bloom: true, msaa: 4, aoQuality: 'Medium', bodyLod: 'hi', particles: 1 },
  medium: { dprMax: 1.5, shadowMap: 1024, ao: true, bloom: true, msaa: 2, aoQuality: 'Low', bodyLod: 'hi', particles: 0.75 },
  low: { dprMax: 1.25, shadowMap: 1024, ao: false, bloom: false, msaa: 0, aoQuality: 'Performance', bodyLod: 'lo', particles: 0.5 },
};

const ORDER: Tier[] = ['low', 'medium', 'high'];
const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
export const FORCED: Tier | null = (() => {
  const q = params.get('quality');
  return q === 'high' || q === 'medium' || q === 'low' ? q : null;
})();

export function initialTier(renderer: string, cores: number, memoryGB: number | undefined, touch: boolean, dpr: number): Tier {
  if (FORCED) return FORCED;
  if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer)) return 'low';
  if (cores <= 2 || (memoryGB !== undefined && memoryGB <= 2)) return 'low';
  if (touch && dpr >= 2) return 'medium';
  if (cores <= 4 && memoryGB !== undefined && memoryGB <= 4) return 'medium';
  return 'high';
}

interface QualityState {
  tier: Tier;
  reason: string;
  renderer: string;
}

export const useQuality = create<QualityState>(() => ({ tier: FORCED ?? 'high', reason: FORCED ? 'forced by ?quality' : 'default', renderer: '' }));

export function stepTier(dir: -1 | 1, reason: string) {
  if (FORCED) return;
  const cur = useQuality.getState().tier;
  const i = Math.max(0, Math.min(ORDER.length - 1, ORDER.indexOf(cur) + dir));
  if (ORDER[i] !== cur) useQuality.setState({ tier: ORDER[i], reason });
}

/**
 * Frame-time monitor with hysteresis: steps the tier down when the median frame of a 1.5 s
 * window is slow, and up only after sustained headroom; ignores the first seconds and the
 * seconds after a change (the pipeline is rebuilt), never raises after it had to lower twice,
 * and makes at most three changes in a session, so quality cannot oscillate. It reads the
 * real interval between frames, never the clamped simulation step.
 */
export class FrameMonitor {
  private samples: number[] = [];
  private span = 0;
  private changes = 0;
  private downs = 0;
  private cooldown = 3;
  /** Consecutive windows with headroom (raising needs several). */
  private good = 0;
  update(dt: number) {
    if (FORCED || this.changes >= 3 || !(dt > 0)) return;
    // a hidden tab or a debugger pause is not a slow frame
    if (dt > 1) return;
    this.cooldown -= dt;
    this.samples.push(dt);
    this.span += dt;
    if (this.span < 1.5 || this.samples.length < 12) return;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    this.samples = [];
    this.span = 0;
    if (this.cooldown > 0) return;
    if (median > 1 / 36) {
      this.good = 0;
      stepTier(-1, `median frame ${(median * 1000).toFixed(0)} ms`);
      this.changes++;
      this.downs++;
      this.cooldown = 4;
    } else if (median < 1 / 57) {
      this.good++;
      if (this.good >= 4 && this.downs < 2 && useQuality.getState().tier !== 'high') {
        stepTier(1, 'headroom');
        this.changes++;
        this.good = 0;
        this.cooldown = 8;
      }
    } else this.good = 0;
  }
}

/** Frame intervals as the visitor experiences them (developer statistics). */
export class FrameStats {
  private ring = new Float32Array(4096);
  private n = 0;
  private i = 0;

  push(dt: number) {
    if (!(dt > 0) || dt > 5) return;
    this.ring[this.i] = dt;
    this.i = (this.i + 1) % this.ring.length;
    this.n = Math.min(this.ring.length, this.n + 1);
  }

  reset() {
    this.n = 0;
    this.i = 0;
  }

  summary(): { frames: number; medianMs: number; p95Ms: number; maxMs: number; stalls100: number } {
    const a = Array.from(this.ring.subarray(0, this.n)).sort((x, y) => x - y);
    const q = (p: number) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] * 1000 : 0);
    return { frames: a.length, medianMs: q(0.5), p95Ms: q(0.95), maxMs: a.length ? a[a.length - 1] * 1000 : 0, stalls100: a.filter((x) => x > 0.1).length };
  }
}
