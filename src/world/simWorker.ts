/**
 * The simulation worker: a lab's chart run, or a sequence's car state at a moment, computed off
 * the page's thread with the same model code. Long runs proceed in slices and yield between
 * them, so a newer request (or a cancel) can supersede the one in progress.
 */
import { LAB_BY_ID, labRun } from '../content/labs';
import { Car } from '../sim/car';
import { initRun, type Sample } from '../sim/run';
import { SeekCache, sequenceById } from './seekCache';

const cache = new SeekCache();
const latest: Record<string, number> = { lab: 0, seek: 0 };
const yieldNow = () => new Promise<void>((r) => setTimeout(r, 0));

async function lab(id: number, labId: string, values: Record<string, number | boolean | string>): Promise<Sample[] | null> {
  const lab = LAB_BY_ID[labId];
  const spec = labRun(lab, values);
  const car = new Car();
  initRun(car, spec);
  const every = lab.every ?? 0.05;
  const duration = spec.duration ?? 10;
  const n = Math.round(duration / every);
  const out: Sample[] = [];
  let slice = performance.now();
  for (let i = 0; i <= n; i++) {
    const t = i * every;
    car.runTo(car.programT0 + t);
    out.push(lab.sample(car.s, t, car));
    if (spec.until?.(car.s, t)) break;
    if (performance.now() - slice > 30) {
      await yieldNow();
      if (latest.lab !== id) return null;
      slice = performance.now();
    }
  }
  return out;
}

async function seek(id: number, seqId: string, t: number) {
  const it = cache.run(sequenceById(seqId), t);
  let slice = performance.now();
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    if (performance.now() - slice > 30) {
      await yieldNow();
      if (latest.seek !== id) return null;
      slice = performance.now();
    }
  }
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data as { type: string; id: number; kind?: string; lab?: string; values?: Record<string, number | boolean | string>; seq?: string; t?: number };
  if (m.type === 'cancel') {
    latest[m.kind!] = m.id;
    return;
  }
  latest[m.type] = m.id;
  // let a burst of requests settle: only the newest one is worked on
  await yieldNow();
  if (latest[m.type] !== m.id) return self.postMessage({ id: m.id, ok: false, abandoned: true });
  try {
    const result = m.type === 'lab' ? await lab(m.id, m.lab!, m.values!) : await seek(m.id, m.seq!, m.t!);
    if (result === null) self.postMessage({ id: m.id, ok: false, abandoned: true });
    else self.postMessage({ id: m.id, ok: true, result });
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String(err) });
  }
};
