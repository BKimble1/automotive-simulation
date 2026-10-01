/**
 * The phone's information sheet: Explore's, Engineer's and Simulate's panels become a sheet at
 * the foot of the screen with a handle. Tap the handle (or press Enter or Space on it) to switch
 * between compact and expanded; drag it to any height between them. The sheet keeps its scroll
 * position while it changes size, and the camera reframes the subject smoothly into the room it
 * leaves (useFreeArea follows the sheet as it moves).
 */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store';

const COMPACT = 0.3;
const EXPANDED = 0.72;

const narrow = () => typeof window !== 'undefined' && window.innerWidth <= 760;

/** The sheet's height for the panel's style (phones only), and whether a drag is moving it. */
export function useSheet(): { style: React.CSSProperties | undefined; className: string } {
  const h = useApp((s) => s.sheetH);
  const dragging = useApp((s) => s.sheetDragging);
  const [isNarrow, setNarrow] = useState(narrow);
  useEffect(() => {
    const r = () => setNarrow(narrow());
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, []);
  if (!isNarrow) return { style: undefined, className: '' };
  return { style: { height: `calc(${(h * 100).toFixed(2)}dvh - 8px)`, maxHeight: 'none', bottom: 'calc(8px + var(--safe-b))', top: 'auto' }, className: `panel--sheet${dragging ? ' panel--dragging' : ''}` };
}

export function SheetHandle() {
  const h = useApp((s) => s.sheetH);
  const set = useApp((s) => s.set);
  const drag = useRef<{ id: number; y0: number; h0: number; moved: boolean } | null>(null);
  const expanded = h > (COMPACT + EXPANDED) / 2;
  const toggle = () => set({ sheetH: expanded ? COMPACT : EXPANDED });
  return (
    <div
      className="sheet-handle"
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={expanded ? 'Make the panel smaller' : 'Make the panel larger'}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      }}
      onPointerDown={(e) => {
        drag.current = { id: e.pointerId, y0: e.clientY, h0: h, moved: false };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const dy = d.y0 - e.clientY;
        if (Math.abs(dy) > 4) d.moved = true;
        if (d.moved) set({ sheetH: Math.max(0.18, Math.min(0.86, d.h0 + dy / window.innerHeight)), sheetDragging: true });
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d || d.id !== e.pointerId) return;
        if (!d.moved) return toggle();
        // let go: settle at the nearer of the two heights
        const now = useApp.getState().sheetH;
        set({ sheetH: Math.abs(now - COMPACT) < Math.abs(now - EXPANDED) ? COMPACT : EXPANDED, sheetDragging: false });
      }}
      onPointerCancel={() => {
        drag.current = null;
        set({ sheetDragging: false });
      }}
    >
      <span />
    </div>
  );
}
