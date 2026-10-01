/**
 * Sequence states at any moment, fast: each chain of a sequence is re-simulated from its
 * declared start, and complete snapshots are kept along the way (one per simulated second), so
 * a later seek into the same chain starts from the nearest one instead of from the beginning.
 * A snapshot continues exactly as the uninterrupted run would (tested), so this is only a
 * shortcut, never an approximation. Used by the worker, and on the page when there is none.
 */
import { Car, type CarSnapshot } from '../sim/car';
import { FILM } from '../content/film';
import { LESSONS } from '../content/lessons';
import { SequencePlayer, type Sequence } from './sequence';

export function sequenceById(id: string): Sequence {
  const s = id === FILM.id ? FILM : LESSONS[id];
  if (!s) throw new Error(`no sequence ${id}`);
  return s;
}

/** Snapshot spacing in simulated seconds. */
const EVERY = 1;

export class SeekCache {
  private players = new Map<string, SequencePlayer>();
  private cars = new Map<string, Car>();
  /** checkpoints[seq][chain][k] = the run at k·EVERY s of mechanical time into the chain. */
  private checkpoints = new Map<string, Map<number, CarSnapshot[]>>();

  private playerFor(seq: Sequence): { p: SequencePlayer; car: Car } {
    let p = this.players.get(seq.id);
    let car = this.cars.get(seq.id);
    if (!p || !car) {
      car = new Car();
      p = new SequencePlayer(car);
      p.load(seq);
      this.players.set(seq.id, p);
      this.cars.set(seq.id, car);
      this.checkpoints.set(seq.id, new Map());
    }
    return { p, car };
  }

  /** The run at presentation time t (synchronously). */
  sample(seq: Sequence, t: number): CarSnapshot {
    const it = this.run(seq, t);
    for (;;) {
      const r = it.next();
      if (r.done) return r.value;
    }
  }

  /**
   * The run at presentation time t, as steps of one simulated second: the caller may stop
   * between steps (a newer request has replaced this one) and continue another time; every
   * second simulated is kept for later seeks either way.
   */
  *run(seq: Sequence, t: number): Generator<void, CarSnapshot, void> {
    const { p, car } = this.playerFor(seq);
    const tt = Math.max(0, Math.min(p.duration, t));
    const b = p.beatAt(tt);
    const mech = p.mechTime(tt);
    const byChain = this.checkpoints.get(seq.id)!;
    let cps = byChain.get(b.chain);
    if (!cps) byChain.set(b.chain, (cps = []));
    // the nearest saved moment at or before the target
    let k = Math.min(cps.length - 1, Math.floor(mech / EVERY + 1e-9));
    while (k >= 0 && !cps[k]) k--;
    if (k >= 0) {
      car.load(cps[k]);
      p.attachProgram(b.chain, car);
    } else {
      p.startChain(b.chain, car);
      cps[0] = car.save();
      k = 0;
    }
    const t0 = car.programT0;
    for (let j = k + 1; j * EVERY <= mech + 1e-9; j++) {
      yield;
      car.runTo(t0 + j * EVERY);
      if (!cps[j]) cps[j] = car.save();
    }
    car.runTo(t0 + mech);
    return car.save();
  }
}
