/**
 * In-scene labels: short names pinned to points on the car (a dot on the part, the name beside
 * it). They are HTML over the canvas, placed every frame from the camera, so they stay sharp at
 * any size and are read by screen readers as plain text. Each label has its own channel
 * (`label:<id>`), so labels arrive and leave with the rest of a view's overlays, never popping.
 * A label whose point is behind the camera or outside the free part of the view fades out.
 */
import { Matrix4, Vector3, type PerspectiveCamera } from 'three';

export interface LabelDef {
  text: string;
  /** Anchor in the car's frame (moves with the body unless `ground`), or a function giving a
   * world position every frame (a moving part). */
  at: Vector3 | (() => Vector3);
  /** Which side of the dot the text sits on. */
  side?: 'left' | 'right';
  /** A colour key (a dot in this colour; matches a part's colour coding). */
  color?: string;
  ground?: boolean;
}

const _v = new Vector3();

export class LabelLayer {
  readonly root: HTMLDivElement;
  private items = new Map<string, { def: LabelDef; el: HTMLDivElement; shown: boolean }>();
  /** Free area of the view (fractions), as the camera uses it. */
  free = { l: 0, t: 0, r: 1, b: 1 };

  constructor(parent: HTMLElement, defs: Record<string, LabelDef>) {
    this.root = document.createElement('div');
    this.root.className = 'labels';
    this.root.setAttribute('aria-hidden', 'false');
    parent.appendChild(this.root);
    for (const [id, def] of Object.entries(defs)) {
      const el = document.createElement('div');
      el.className = `label label--${def.side ?? 'right'}`;
      el.style.opacity = '0';
      el.style.visibility = 'hidden';
      const dot = document.createElement('i');
      if (def.color) dot.style.background = def.color;
      const tx = document.createElement('span');
      tx.textContent = def.text;
      el.append(dot, tx);
      this.root.appendChild(el);
      this.items.set(id, { def, el, shown: false });
    }
  }

  /** Place and fade every label: `opacity(id)` is its channel, `body` the car body's matrix. */
  update(camera: PerspectiveCamera, body: Matrix4, width: number, height: number, opacity: (id: string) => number) {
    for (const [id, it] of this.items) {
      let o = opacity(id);
      if (o > 0.004) {
        const at = it.def.at;
        if (typeof at === 'function') _v.copy(at());
        else {
          _v.copy(at);
          if (!it.def.ground) _v.applyMatrix4(body);
        }
        _v.project(camera);
        const x = (_v.x * 0.5 + 0.5) * width;
        const y = (-_v.y * 0.5 + 0.5) * height;
        const fx = x / width;
        const fy = y / height;
        // behind the camera, or under the interface: fade with the distance into it
        if (_v.z > 1) o = 0;
        const m = 0.03;
        const inside = Math.min(fx - this.free.l, this.free.r - fx, fy - this.free.t, this.free.b - fy);
        o *= Math.max(0, Math.min(1, inside / m + 0.5));
        if (o > 0.004) {
          it.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)${it.def.side === 'left' ? ' translateX(-100%)' : ''}`;
          it.el.style.opacity = o.toFixed(3);
          if (!it.shown) {
            it.el.style.visibility = 'visible';
            it.shown = true;
          }
          continue;
        }
      }
      if (it.shown) {
        it.el.style.opacity = '0';
        it.el.style.visibility = 'hidden';
        it.shown = false;
      }
    }
  }

  /** The labels showing now (tests). */
  visible(): string[] {
    return [...this.items].filter(([, it]) => it.shown).map(([id]) => id);
  }

  dispose() {
    this.root.remove();
  }
}
