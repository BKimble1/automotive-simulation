/**
 * The driving workbench (Simulate → Drive it yourself): the visitor drives the car's model.
 * The panel has the engine button, the selector, the road, the view, compact instruments and a
 * disclosure with more readings; the pedals and the steering are pads at the foot of the
 * screen. The controls only write the model's inputs (world/driver.ts), so the picture, the
 * instruments and the mechanisms all answer the same model.
 *
 * Keys (when no field, slider or button has the keyboard): W / ↑ accelerate, S / ↓ brake,
 * A D / ← → steer, Space brake hard, P R N D select, Enter start or stop. Dragging on a pad never
 * turns the camera: the pads take their pointers.
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp, useReadouts, useRun } from '../../state/store';
import type { World } from '../../world/world';
import { DRIVE_RUN } from '../../world/controller';
import { Driver } from '../../world/driver';
import { TIRE } from '../../spec/vehicle';
import type { Selector } from '../../sim/car';
import { BackIcon } from '../icons';

const SURFACES = [
  { id: 'dry', label: 'Dry', mu: TIRE.muDry },
  { id: 'wet', label: 'Wet', mu: TIRE.muWet },
  { id: 'snow', label: 'Snow', mu: TIRE.muSnow },
] as const;

const VIEWS = [
  { id: 'drive-chase', label: 'Car' },
  { id: 'torque-path', label: 'Torque path' },
  { id: 'braking-side', label: 'Brakes' },
  { id: 'corner-top', label: 'Steering' },
] as const;

/**
 * Is the keyboard busy with a control of its own? Fields and sliders keep their keys, and so
 * do the page's other buttons and links; the workbench's own buttons and pads do not (after
 * pressing Start, the arrows still drive).
 */
function keyboardTaken(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null;
  if (!e || e === document.body) return false;
  if (e.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName)) return true;
  if (['BUTTON', 'A'].includes(e.tagName)) return !e.closest('.wb, .pads');
  return false;
}

/** A pedal or steering pad: follows its own pointer (capture), released on up or cancel. */
function Pad({ kind, label, driver, hint }: { kind: 'throttle' | 'brake' | 'steer'; label: string; driver: Driver; hint: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useRef<number | null>(null);
  const [, redraw] = useReducer((x: number) => x + 1, 0);
  const valueAt = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    if (kind === 'steer') return Math.max(-1, Math.min(1, -((e.clientX - (r.left + r.width / 2)) / (r.width / 2)) * 1.15));
    return Math.max(0, Math.min(1, ((r.bottom - e.clientY) / r.height) * 1.1));
  };
  const set = (v: number | null) => {
    driver.pads[kind] = v;
    redraw();
  };
  const down = (e: React.PointerEvent) => {
    if (id.current !== null) return;
    id.current = e.pointerId;
    try {
      ref.current!.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no capture */
    }
    e.preventDefault();
    set(valueAt(e));
  };
  const move = (e: React.PointerEvent) => {
    if (e.pointerId !== id.current) return;
    set(valueAt(e));
  };
  const up = (e: React.PointerEvent) => {
    if (e.pointerId !== id.current) return;
    id.current = null;
    set(null);
  };
  const v = driver.pads[kind];
  const applied = kind === 'throttle' ? driver.throttle : kind === 'brake' ? driver.brake : driver.steer / Driver.steerLimit(0);
  return (
    <div
      ref={ref}
      className={`pad pad--${kind} ${v !== null ? 'pad--on' : ''}`}
      role={kind === 'steer' ? 'slider' : 'button'}
      aria-label={label}
      aria-valuenow={kind === 'steer' ? Math.round(applied * 100) : undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
    >
      <span className="pad__fill" style={kind === 'steer' ? { transform: `translateX(${(-applied * 50).toFixed(1)}%)` } : { transform: `scaleY(${applied.toFixed(3)})` }} />
      <span className="pad__label">{label}</span>
      <kbd className="pad__key">{hint}</kbd>
    </div>
  );
}

export function Workbench({ world }: { world: World }) {
  const go = useApp((s) => s.go);
  const r = useReadouts();
  const run = useRun();
  const driver = world.driver;
  const [, redraw] = useReducer((x: number) => x + 1, 0);
  const [surface, setSurface] = useState<(typeof SURFACES)[number]['id']>('dry');
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('drive-chase');
  const [more, setMore] = useState(false);

  // the driver's messages and the pads' fills, redrawn at the readouts' pace
  useEffect(() => {
    driver.onChange = redraw;
    const t = setInterval(redraw, 100);
    return () => {
      driver.onChange = undefined;
      clearInterval(t);
      driver.releaseAll();
    };
  }, [driver]);

  // keys, and letting go of everything when the page loses the keyboard or the pointer
  useEffect(() => {
    const map = (e: KeyboardEvent, on: boolean) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'arrowup') driver.keys.up = on;
      else if (k === 's' || k === 'arrowdown') driver.keys.down = on;
      else if (k === 'a' || k === 'arrowleft') driver.keys.left = on;
      else if (k === 'd' || k === 'arrowright') driver.keys.right = on;
      else if (k === ' ') driver.keys.hard = on;
      else return false;
      return true;
    };
    const down = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || keyboardTaken(e.target)) return;
      // Enter on one of the workbench's buttons presses that button, not the engine
      if (e.key === 'Enter' && (e.target as HTMLElement)?.tagName === 'BUTTON') return;
      if (!e.shiftKey && map(e, true)) return e.preventDefault();
      if (e.repeat) return;
      const k = e.key.toUpperCase();
      // P, R and N select; Drive is Shift + D (plain D steers)
      if (k === 'P' || k === 'R' || k === 'N' || (k === 'D' && e.shiftKey)) driver.select(k as Selector);
      else if (e.key === 'Enter') driver.pressStart();
      else return;
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (map(e, false)) e.preventDefault();
    };
    const release = () => driver.releaseAll();
    const vis = () => document.hidden && release();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [driver]);

  const chooseSurface = (id: (typeof SURFACES)[number]['id']) => {
    setSurface(id);
    const mu = SURFACES.find((x) => x.id === id)!.mu;
    world.setRoad({ ...world.model.road.spec, mu });
  };
  const addBump = () => world.setRoad({ ...world.model.road.spec, bumpAt: world.model.s.s + 22 });
  const chooseView = (id: (typeof VIEWS)[number]['id']) => {
    setView(id);
    world.request(id);
  };
  const reset = () => {
    world.setLive(DRIVE_RUN);
    world.setPaused(false);
    setSurface('dry');
  };
  const running = r.engine === 'running';
  const status = run.status === 'paused' ? 'Paused' : r.engine === 'cranking' ? 'Cranking' : running ? 'Live · you are driving' : 'Engine off';
  const warnings = Object.entries(r.warnings).filter(([, on]) => on);
  return (
    <>
      <div className="ex-crumbs">
        <button className="ex-back" onClick={() => go({ scenario: null })} aria-label="Back to the list">
          <BackIcon />
        </button>
        <span className="eng-kicker">Drive</span>
        <span className={`run-state run-state--${running ? 'live' : 'off'}`}>{status}</span>
      </div>
      <h2>Drive it yourself</h2>
      <div className="wb-row">
        <button className={`wb-start ${running ? 'wb-start--on' : ''}`} onClick={() => driver.pressStart()} aria-label={running ? 'Stop the engine' : 'Start the engine'}>
          <span>{running ? 'Stop' : 'Start'}</span>
          <small>{driver.starting ? '…' : 'Enter'}</small>
        </button>
        <div className="wb-selector" role="group" aria-label="Selector">
          {(['P', 'R', 'N', 'D'] as Selector[]).map((sel) => (
            <button key={sel} aria-pressed={r.selector === sel} className={r.selectorWanted === sel && r.selector !== sel ? 'wb-sel--wanted' : ''} onClick={() => driver.select(sel)}>
              {sel}
            </button>
          ))}
        </div>
      </div>
      <p className="wb-msg" role="status" aria-live="polite">
        {driver.message}
      </p>
      <div className="wb-gauges" role="group" aria-label="Instruments">
        <div className="wb-gauge wb-gauge--big">
          <span className="num">{Math.round(Math.abs(r.kmh))}</span>
          <small>km/h</small>
        </div>
        <div className="wb-gauge">
          <span className="num">{Math.round(r.rpm).toLocaleString('en-GB')}</span>
          <small>rpm</small>
        </div>
        <div className="wb-gauge">
          <span className="num">{r.gear}</span>
          <small>gear</small>
        </div>
        {warnings.length > 0 && (
          <ul className="wb-warn" aria-label="Warning lights on">
            {warnings.map(([k]) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        )}
      </div>
      <fieldset className="ctl ctl--choice">
        <legend>Road</legend>
        <div className="seg">
          {SURFACES.map((x) => (
            <button key={x.id} aria-pressed={surface === x.id} onClick={() => chooseSurface(x.id)}>
              {x.label}
            </button>
          ))}
          <button onClick={addBump}>Bump ahead</button>
        </div>
      </fieldset>
      <fieldset className="ctl ctl--choice">
        <legend>Show</legend>
        <div className="seg">
          {VIEWS.map((x) => (
            <button key={x.id} aria-pressed={view === x.id} onClick={() => chooseView(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
      </fieldset>
      <button className="pbtn pbtn--wide pbtn--text" aria-expanded={more} onClick={() => setMore(!more)}>
        {more ? 'Fewer readings' : 'More readings'}
      </button>
      {more && (
        <dl className="ex-facts wb-more">
          <div>
            <dt>Throttle · brake</dt>
            <dd className="num">
              {Math.round(driver.throttle * 100)} % · {Math.round(r.brakeBar)} bar
            </dd>
          </div>
          <div>
            <dt>Converter</dt>
            <dd className="num">
              turbine {Math.round(r.turbineRpm).toLocaleString('en-GB')} rpm · lock-up {Math.round(r.lockup * 100)} %
            </dd>
          </div>
          <div>
            <dt>Shift elements</dt>
            <dd className="num">{[...r.elements, ...(r.applying ? [`${r.applying}↑`] : []), ...(r.releasing ? [`${r.releasing}↓`] : [])].join(' ') || '–'}</dd>
          </div>
          <div>
            <dt>Front wheels (left · right)</dt>
            <dd className="num">
              {r.wheelAngleDeg[0].toFixed(1)}° · {r.wheelAngleDeg[1].toFixed(1)}°
            </dd>
          </div>
          <div>
            <dt>Rear wheels (left · right)</dt>
            <dd className="num">
              {r.wheelKmh[2].toFixed(1)} · {r.wheelKmh[3].toFixed(1)} km/h
            </dd>
          </div>
          <div>
            <dt>Battery · coolant</dt>
            <dd className="num">
              {r.volts.toFixed(1)} V · {Math.round(r.coolantC)} °C
            </dd>
          </div>
        </dl>
      )}
      <p className="ex-hint wb-keys">
        Keys: <kbd>W</kbd>/<kbd>↑</kbd> accelerate · <kbd>S</kbd>/<kbd>↓</kbd> brake · <kbd>A</kbd> <kbd>D</kbd> steer · <kbd>Space</kbd> brake hard · <kbd>P</kbd> <kbd>R</kbd> <kbd>N</kbd> <kbd>Shift</kbd>+<kbd>D</kbd> select · <kbd>Enter</kbd> start or stop
      </p>
      <button className="pbtn pbtn--wide pbtn--text" onClick={reset}>
        Reset: parked, engine off
      </button>
      {createPortal(
        <div className="pads pe" data-occludes="bottom" role="group" aria-label="Driving controls">
          <Pad kind="steer" label="Steer" driver={driver} hint="A D" />
          <Pad kind="brake" label="Brake" driver={driver} hint="S" />
          <Pad kind="throttle" label="Accelerate" driver={driver} hint="W" />
        </div>,
        document.querySelector('.ui') ?? document.body,
      )}
    </>
  );
}
