/**
 * Off-screen calculations, off the interface's thread: a lab's chart run and a sequence's car
 * state at a sought moment. The work runs in a worker (simWorker.ts) on the same deterministic
 * model, so its result is identical to computing it here (tested), and the page stays
 * responsive however long the run.
 *
 * Every request has an id; a newer request of the same kind supersedes an older one (the worker
 * abandons it at its next checkpoint, and a late answer is ignored), so dragging a scrubber or
 * changing a lab's setting quickly never queues a calculation per event: at most one runs, and
 * the last one asked for is the one that is answered.
 *
 * Without workers (an old browser, the unit tests) the same functions run here, synchronously.
 */
import type { CarSnapshot } from '../sim/car';
import type { Sample } from '../sim/run';
import { LAB_BY_ID, simulateLab, type LabValues } from '../content/labs';
import { sequenceById, SeekCache } from './seekCache';

type Kind = 'lab' | 'seek';

interface Pending {
  kind: Kind;
  payload: Record<string, unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

export interface JobStats {
  /** Last completed job of each kind: how long it took (ms) and where it ran. */
  last: Partial<Record<Kind, { ms: number; where: 'worker' | 'main' }>>;
  superseded: number;
}

export class SimJobs {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  /** The latest request of each kind (older answers are dropped). */
  private latest: Record<Kind, number> = { lab: 0, seek: 0 };
  private local = new SeekCache();
  stats: JobStats = { last: {}, superseded: 0 };
  private started = new Map<number, number>();

  constructor(useWorker = typeof Worker !== 'undefined') {
    if (!useWorker) return;
    try {
      this.worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module', name: 'automotive-sim' });
      this.worker.onmessage = (e: MessageEvent) => this.answer(e.data);
      this.worker.onerror = (e) => {
        console.warn('simulation worker failed; computing on the page instead', e.message);
        this.failOver();
      };
    } catch {
      this.worker = null;
    }
  }

  get usingWorker(): boolean {
    return this.worker !== null;
  }

  /** A lab's samples for these values. */
  lab(labId: string, values: LabValues): Promise<Sample[]> {
    return this.ask('lab', { lab: labId, values }) as Promise<Sample[]>;
  }

  /** A sequence's whole car run at presentation time t. */
  seek(seqId: string, t: number): Promise<CarSnapshot> {
    return this.ask('seek', { seq: seqId, t }) as Promise<CarSnapshot>;
  }

  /** Drop any outstanding request of a kind (its answer will be ignored). */
  cancel(kind: Kind) {
    this.latest[kind] = this.nextId++;
    this.worker?.postMessage({ type: 'cancel', kind, id: this.latest[kind] });
  }

  private ask(kind: Kind, payload: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    if (this.latest[kind] && this.pending.has(this.latest[kind])) this.stats.superseded++;
    this.latest[kind] = id;
    this.started.set(id, performance.now());
    return new Promise((resolve, reject) => {
      this.pending.set(id, { kind, payload, resolve, reject });
      if (this.worker) this.worker.postMessage({ type: kind, id, ...payload });
      else queueMicrotask(() => this.runLocal(id, kind, payload));
    });
  }

  private runLocal(id: number, kind: Kind, payload: Record<string, unknown>) {
    if (this.latest[kind] !== id) return this.drop(id);
    try {
      const result = kind === 'lab' ? simulateLab(LAB_BY_ID[payload.lab as string], payload.values as LabValues) : this.local.sample(sequenceById(payload.seq as string), payload.t as number);
      this.answer({ id, ok: true, result }, 'main');
    } catch (e) {
      this.answer({ id, ok: false, error: String(e) }, 'main');
    }
  }

  private answer(msg: { id: number; ok: boolean; result?: unknown; error?: string; abandoned?: boolean }, where: 'worker' | 'main' = 'worker') {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    const t0 = this.started.get(msg.id);
    this.started.delete(msg.id);
    // a superseded answer is dropped: nobody is waiting for it any more
    if (msg.abandoned || this.latest[p.kind] !== msg.id) return;
    if (t0 !== undefined) this.stats.last[p.kind] = { ms: performance.now() - t0, where };
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error));
  }

  private drop(id: number) {
    this.pending.delete(id);
    this.started.delete(id);
  }

  /** The worker died: answer what is outstanding here instead. */
  private failOver() {
    this.worker?.terminate();
    this.worker = null;
    for (const [id, p] of [...this.pending]) {
      if (this.latest[p.kind] !== id) this.drop(id);
      else queueMicrotask(() => this.runLocal(id, p.kind, p.payload));
    }
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
