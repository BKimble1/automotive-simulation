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

function Facts({ c }: { c: Component }) {
  const go = useApp((s) => s.go);
  const facts: [string, string | string[]][] = [
    ['Where', c.location],
    ['Takes in', c.inputs],
    ['Gives out', c.outputs],
    ['While it works', c.changes],
    ['Made of', c.material],
    ['When it fails', c.failures],
  ];
  return (
    <>
      <dl className="ex-facts">
        {facts
          .filter(([, v]) => (Array.isArray(v) ? v.length : v))
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{Array.isArray(v) ? (v.length > 1 ? <ul>{v.map((x) => <li key={x}>{x}</li>)}</ul> : v[0]) : v}</dd>
            </div>
          ))}
      </dl>
      {c.compare && (
        <p className="ex-compare">
          <b>Other designs.</b> {c.compare}
        </p>
      )}
      {c.neighbours.length > 0 && (
        <>
          <h3>Connected to</h3>
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
        </>
      )}
    </>
  );
}

export function ExplorePanel(_: { world: World }) {
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
    <nav className="panel panel--left ex pe" data-occludes="left" aria-label="Explore the car" ref={panel}>
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
          <p>A front-engined, rear-wheel-drive four-door sedan with a 2.5-litre four-cylinder engine and an eight-speed automatic. Choose a system to look inside.</p>
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
