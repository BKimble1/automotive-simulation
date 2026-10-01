/**
 * Explore: the car as a hierarchy — vehicle → system → assembly → part — with search. Choosing
 * anything moves the scene to it (the director takes the camera and the scene's channels there
 * from what is on screen); Back goes up one level the same way. A part's card says what it does,
 * where it is, what goes in and out, what changes while it works, what it is made of and how it
 * fails, with links to its neighbours and to the lesson that shows it working.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../state/store';
import { BY_ID, childrenOf, pathTo, search, SYSTEMS, type Component } from '../../content/registry';
import { LESSONS } from '../../content/lessons';
import type { World } from '../../world/world';
import { SheetHandle, useSheet } from '../Sheet';
import { SYSTEM_VIEWS, VIEWS, viewModes, viewVariant, type ViewMode } from '../../world/views';
import { viewFor } from '../../world/partViews';
import { BackIcon } from '../icons';

/** Lessons that show each system working. */
const SYSTEM_LESSONS: Record<string, string[]> = {
  power: ['four-stroke', 'firing-order', 'start'],
  air: ['four-stroke'],
  cooling: ['cooling'],
  driveline: ['torque-path', 'differential'],
  chassis: ['suspension'],
  brakes: ['braking'],
  electrical: ['electrical', 'start'],
  body: ['exploded'],
  cabin: ['start'],
  safety: [],
};

const DEPTH = ['', 'Every learner', 'Going further', 'Engineering detail'];

function Lessons({ ids }: { ids: string[] }) {
  const set = useApp((s) => s.set);
  if (!ids.length) return null;
  return (
    <div className="ex-lessons">
      {ids.map((id) => (
        <button key={id} className="pbtn pbtn--wide pbtn--accent" onClick={() => set({ lesson: id })}>
          Show how it works: {LESSONS[id]?.title ?? id}
        </button>
      ))}
    </div>
  );
}

function Row({ c, onPick }: { c: Component; onPick: (id: string) => void }) {
  return (
    <li>
      <button className="ex-row" onClick={() => onPick(c.id)}>
        <span className="ex-row__name">{c.name}</span>
        {c.kind !== 'part' && <span className="ex-row__count num">{childrenOf(c.id).length}</span>}
        <span className="ex-row__fn">{c.function}</span>
      </button>
    </li>
  );
}

/**
 * A part's details, a little at a time: where it is first, then how it works with the rest,
 * what it is made of, how it fails, and what it connects to, each opened on request.
 */
function Facts({ c }: { c: Component }) {
  const go = useApp((s) => s.go);
  const list = (v: string | string[]) => (Array.isArray(v) ? (v.length > 1 ? <ul>{v.map((x) => <li key={x}>{x}</li>)}</ul> : v[0]) : v);
  const has = (v: string | string[] | undefined) => (Array.isArray(v) ? v.length > 0 : !!v);
  return (
    <>
      {has(c.location) && (
        <p className="ex-where">
          <b>Where</b> {c.location}
        </p>
      )}
      {(has(c.inputs) || has(c.outputs) || has(c.changes)) && (
        <details className="ex-more">
          <summary>How it works with the rest</summary>
          <dl className="ex-facts">
            {has(c.inputs) && (
              <div>
                <dt>Takes in</dt>
                <dd>{list(c.inputs)}</dd>
              </div>
            )}
            {has(c.outputs) && (
              <div>
                <dt>Gives out</dt>
                <dd>{list(c.outputs)}</dd>
              </div>
            )}
            {has(c.changes) && (
              <div>
                <dt>While it works</dt>
                <dd>{list(c.changes)}</dd>
              </div>
            )}
          </dl>
        </details>
      )}
      {(has(c.material) || c.compare) && (
        <details className="ex-more">
          <summary>How it is made</summary>
          {has(c.material) && (
            <p>
              <b>Made of.</b> {c.material}
            </p>
          )}
          {c.compare && (
            <p>
              <b>Other designs.</b> {c.compare}
            </p>
          )}
        </details>
      )}
      {has(c.failures) && (
        <details className="ex-more">
          <summary>When it fails</summary>
          <div className="ex-fail">{list(c.failures)}</div>
        </details>
      )}
      {c.neighbours.length > 0 && (
        <details className="ex-more" open>
          <summary>Connected to</summary>
          <div className="ex-links">
            {c.neighbours.map((n) => {
              const nb = BY_ID.get(n);
              return nb ? (
                <button key={n} className="ex-link" onClick={() => go({ system: nb.system, part: nb.kind === 'system' ? null : nb.id })}>
                  {nb.name}
                </button>
              ) : null;
            })}
          </div>
        </details>
      )}
    </>
  );
}

const MODE_LABEL: Record<ViewMode, string> = { explained: 'Explained', exterior: 'Exterior', opened: 'Opened', cutaway: 'Cutaway', exploded: 'Exploded' };

/** The view choices for the place shown: the same subject drawn another way. */
function ViewChoices({ world, here }: { world: World; here: Component | null }) {
  const [mode, setMode] = useState<ViewMode>('explained');
  const kind = !here ? 'car' : here.kind;
  const system = here?.system ?? null;
  const modes = viewModes(system, kind as 'car' | 'system' | 'assembly' | 'part');
  // a new place starts explained
  useEffect(() => setMode('explained'), [here?.id]);
  const choose = (m: ViewMode) => {
    setMode(m);
    const base = here ? (here.kind === 'system' ? VIEWS[SYSTEM_VIEWS[here.id]] : viewFor(here.id, world.car)) : VIEWS.xray;
    if (base) world.request(viewVariant(base, m, system));
  };
  return (
    <div className="seg ex-views" role="group" aria-label="How to show it">
      {modes.map((m) => (
        <button key={m} aria-pressed={mode === m} onClick={() => choose(m)}>
          {MODE_LABEL[m]}
        </button>
      ))}
    </div>
  );
}

/** Tap a part in the scene to go to it (a tap, not a drag: the camera keeps its drags). */
function usePicking(world: World) {
  const go = useApp((s) => s.go);
  useEffect(() => {
    const el = world.canvas;
    let start: { x: number; y: number; t: number; id: number } | null = null;
    const down = (e: PointerEvent) => {
      start = e.isPrimary ? { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId } : null;
    };
    const up = (e: PointerEvent) => {
      const s0 = start;
      start = null;
      if (!s0 || e.pointerId !== s0.id) return;
      if (Math.hypot(e.clientX - s0.x, e.clientY - s0.y) > 7 || performance.now() - s0.t > 450) return;
      if (world.director.busy) return;
      const id = world.pick(e.clientX, e.clientY);
      const c = id ? BY_ID.get(id) : null;
      if (c) go({ system: c.system, part: c.kind === 'system' ? null : c.id });
    };
    const cancel = () => (start = null);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
    };
  }, [world, go]);
}

export function ExplorePanel({ world }: { world: World }) {
  usePicking(world);
  const sheet = useSheet();
  const system = useApp((s) => s.system);
  const part = useApp((s) => s.part);
  const go = useApp((s) => s.go);
  const [q, setQ] = useState('');
  const results = useMemo(() => search(q), [q]);
  const panel = useRef<HTMLElement>(null);
  const here = part ? BY_ID.get(part) : system ? BY_ID.get(system) : null;
  const path = here ? pathTo(here.id) : [];
  const pick = (id: string) => {
    const c = BY_ID.get(id);
    if (!c) return;
    setQ('');
    go({ system: c.system, part: c.kind === 'system' ? null : c.id });
  };
  const back = () => {
    if (!here) return;
    const parent = here.parent ? BY_ID.get(here.parent) : null;
    if (!parent) go({ system: null, part: null });
    else go({ system: parent.system, part: parent.kind === 'system' ? null : parent.id });
  };
  // a new place starts at the top of the panel
  useEffect(() => {
    panel.current?.scrollTo({ top: 0 });
  }, [here?.id]);
  // Escape (or Backspace outside the search field) goes up one level
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement)?.tagName === 'INPUT';
      if (e.key === 'Escape' && q) setQ('');
      else if ((e.key === 'Escape' || (e.key === 'Backspace' && !inField)) && here) {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const lessons = here ? (here.kind === 'system' ? SYSTEM_LESSONS[here.id] ?? [] : here.animation ? [here.animation] : []) : [];
  return (
    <nav className={`panel panel--left ex pe ${sheet.className}`} style={sheet.style} data-occludes="left" aria-label="Explore the car" ref={panel}>
      <SheetHandle />
      <div className="ex-search">
        <input type="search" placeholder="Search parts and systems" aria-label="Search parts and systems" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {q ? (
        <section aria-live="polite">
          <h3>{results.length ? `${results.length} found` : 'Nothing found'}</h3>
          <ul className="ex-list">
            {results.map((c) => (
              <li key={c.id}>
                <button className="ex-row" onClick={() => pick(c.id)}>
                  <span className="ex-row__name">{c.name}</span>
                  <span className="ex-row__fn">{c.kind === 'system' ? 'System' : pathTo(c.id).slice(0, -1).map((p) => p.name).join(' › ')}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : !here ? (
        <section>
          <h2>The car</h2>
          <p>A front-engined, rear-wheel-drive four-door sedan with a 2.5-litre four-cylinder engine and an eight-speed automatic. Choose a system, or tap a part of the car, to look inside.</p>
          <ViewChoices world={world} here={null} />
          <ul className="ex-list">
            {SYSTEMS.map((c) => (
              <Row key={c.id} c={c} onPick={pick} />
            ))}
          </ul>
        </section>
      ) : (
        <section>
          <div className="ex-crumbs">
            <button className="ex-back" onClick={back} aria-label={`Back to ${path.length > 1 ? path[path.length - 2].name : 'the car'}`}>
              <BackIcon />
            </button>
            <ol aria-label="Where you are">
              <li>
                <button onClick={() => go({ system: null, part: null })}>Car</button>
              </li>
              {path.slice(0, -1).map((p) => (
                <li key={p.id}>
                  <button onClick={() => pick(p.id)}>{p.name}</button>
                </li>
              ))}
            </ol>
          </div>
          <h2>{here.name}</h2>
          {here.kind === 'part' && <span className="ex-depth">{DEPTH[here.depth]}</span>}
          {here.aliases.length > 0 && <p className="ex-aka">Also called {here.aliases.slice(0, 4).join(', ')}</p>}
          <p className="ex-fn">{here.function}</p>
          <Lessons ids={lessons} />
          <ViewChoices world={world} here={here} />
          {here.kind !== 'part' ? (
            <>
              <h3>{here.kind === 'system' ? 'Assemblies' : 'Parts'}</h3>
              <ul className="ex-list">
                {childrenOf(here.id).map((c) => (
                  <Row key={c.id} c={c} onPick={pick} />
                ))}
              </ul>
              {here.kind === 'system' && <Facts c={here} />}
            </>
          ) : (
            <Facts c={here} />
          )}
        </section>
      )}
    </nav>
  );
}
