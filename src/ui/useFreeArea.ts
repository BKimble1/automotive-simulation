/**
 * Measures the part of the view the interface leaves free (header, panels, the lesson bar, the
 * phone's sheet) and tells the camera, so a shot's subject is framed where it can be seen.
 */
import { useEffect } from 'react';
import type { World } from '../world/world';

export function useFreeArea(world: World | null) {
  useEffect(() => {
    if (!world) return;
    let raf = 0;
    let last = '';
    const measure = () => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      let l = 0;
      let t = 0;
      let r = W;
      let b = H;
      const header = document.querySelector('.top');
      if (header) t = Math.max(t, header.getBoundingClientRect().bottom - 6);
      // (the header's height includes the phone's mode tabs)
      for (const el of document.querySelectorAll<HTMLElement>('[data-occludes]')) {
        const rc = el.getBoundingClientRect();
        if (rc.width === 0 || rc.height === 0) continue;
        // a panel spanning most of the width (a phone's bottom sheet) occludes from below
        const side = rc.width > W * 0.6 ? (rc.top > H * 0.5 ? 'bottom' : 'top') : el.dataset.occludes;
        if (side === 'left') l = Math.max(l, rc.right + 8);
        else if (side === 'right') r = Math.min(r, rc.left - 8);
        else if (side === 'bottom') b = Math.min(b, rc.top - 8);
        else if (side === 'top') t = Math.max(t, rc.bottom + 8);
      }
      const key = `${l}|${t}|${r}|${b}|${W}|${H}`;
      if (key !== last) {
        const first = last === '';
        last = key;
        world.setFree(l / W, t / H, r / W, b / H, first);
      }
      raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [world]);
}
