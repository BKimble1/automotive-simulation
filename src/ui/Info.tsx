/** About this simulation: what is modelled, what is simplified, and how to use it. */
import { useEffect, useRef } from 'react';
import { useApp } from '../state/store';
import { CloseIcon } from './icons';

export function Info() {
  const on = useApp((s) => s.info);
  const set = useApp((s) => s.set);
  const reduced = useApp((s) => s.reducedMotion);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!on) return;
    dialog.current?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && set({ info: false });
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [on, set]);
  if (!on) return null;
  return (
    <div className="modal pe" role="dialog" aria-modal="true" aria-labelledby="info-title" onClick={(e) => e.target === e.currentTarget && set({ info: false })}>
      <div className="modal__box" ref={dialog} tabIndex={-1}>
        <div className="legend__head">
          <h2 id="info-title">About AUTOMOTIVE / ONE</h2>
          <button className="pbtn" onClick={() => set({ info: false })} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <p>
          One generic modern car, the S-1: a four-door sedan with a 2.5-litre inline-four at the front, an eight-speed automatic and rear-wheel drive. It is an original design made for this simulation; it is not a real product and carries no maker’s marks.
        </p>
        <h3>What is modelled</h3>
        <p>
          The car runs on a physical model stepped every thousandth of a second: the four-stroke cycle with valve timing and cylinder pressure, the starter, the torque converter, the planetary gearbox and its shift elements, the differential, the tyres’ grip, the suspension’s springs and dampers, the brakes with ABS, cooling, lubrication and the electrical system. Everything you see moving is driven by that model, so captions, gauges and motion agree.
        </p>
        <h3>What is simplified</h3>
        <p>
          The engine’s combustion and the gas flows are averaged, not computational fluid dynamics; the tyres use a standard empirical curve; the body is rigid; the thermal models are lumped. Numbers are typical of a car of this size, not of any particular one. Some steps run in slow motion or sped up, and the scene says so.
        </p>
        <h3>Using it</h3>
        <ul>
          <li>Drag, or focus the car and use the arrow keys, to look around; + and − zoom; Home recentres.</li>
          <li>In the film, Space pauses, Shift + arrows step, Escape leaves.</li>
          <li>Captions are on by default; narration plays when sound is on.</li>
        </ul>
        <label className="ctl ctl--toggle">
          <span>Reduce motion (shorter, gentler camera moves)</span>
          <button role="switch" aria-checked={reduced} className="switch" onClick={() => set({ reducedMotion: !reduced })}>
            <span>{reduced ? 'On' : 'Off'}</span>
          </button>
        </label>
        <h3>Credits</h3>
        <p className="info__small">
          Narration: Kokoro-82M v1.0 (Apache-2.0), voice “bm_george”, generated offline and bundled. 3D: three.js. Fonts: Archivo and Inter (SIL OFL). Part of FAB / ONE by Kimble.
        </p>
      </div>
    </div>
  );
}
