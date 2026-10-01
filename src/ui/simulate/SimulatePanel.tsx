/**
 * Simulate: the car doing everyday things with its gauges live, and six faults to diagnose the
 * way a technician would — the complaint, inspections, measurements, a conclusion, the reveal and
 * the repair. The faults are real faults in the car's model, so every gauge tells the truth.
 */
import { useEffect, useState } from 'react';
import { useApp, useReadouts } from '../../state/store';
import { FAULTS, FAULT_BY_ID, SCENARIOS, SCENARIO_BY_ID, type FaultCase } from '../../content/scenarios';
import { BY_ID } from '../../content/registry';
import { NO_FAULTS } from '../../sim/car';
import type { World } from '../../world/world';
import { viewFor } from '../../world/partViews';
import { VIEWS } from '../../world/views';
import { READOUTS } from '../Readouts';
import { runScenario } from './run';

const LAMPS: { key: 'engine' | 'oil' | 'battery' | 'temp' | 'abs' | 'brake'; label: string; red?: boolean }[] = [
  { key: 'engine', label: 'Engine' },
  { key: 'oil', label: 'Oil pressure', red: true },
  { key: 'battery', label: 'Charging', red: true },
  { key: 'temp', label: 'Temperature', red: true },
  { key: 'abs', label: 'ABS' },
  { key: 'brake', label: 'Brakes', red: true },
];

export function Cluster({ gauges }: { gauges: string[] }) {
  const r = useReadouts();
  return (
    <div className="cluster" role="group" aria-label="Instruments">
      <div className="cluster__gauges">
        {gauges.map((id) => {
          const d = READOUTS[id];
          if (!d) return null;
          return (
            <div className="gauge" key={id}>
              <span className="gauge__label">{d.label}</span>
              <span className="gauge__value num">
                {d.value(r)}
                {d.unit && <small> {d.unit}</small>}
              </span>
            </div>
          );
        })}
      </div>
      <ul className="lamps" aria-label="Warning lights">
        {LAMPS.map((l) => {
          const on = r.warnings[l.key];
          return (
            <li key={l.key} className={on ? (l.red ? 'lamp lamp--red' : 'lamp lamp--amber') : 'lamp'} aria-label={`${l.label} warning ${on ? 'on' : 'off'}`}>
              <i />
              {l.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const STEPS = ['Complaint', 'Inspect', 'Measure', 'Conclude', 'Reveal'] as const;

function look(world: World, id: string) {
  const v = VIEWS[id] ?? (BY_ID.has(id) ? viewFor(id, world.car) : null);
  if (v) world.request(v);
}

function Diagnose({ f, world }: { f: FaultCase; world: World }) {
  const [step, setStep] = useState(0);
  const [seen, setSeen] = useState<string[]>([]);
  const [choice, setChoice] = useState<string | null>(null);
  const [repaired, setRepaired] = useState(false);
  useEffect(() => {
    setStep(0);
    setSeen([]);
    setChoice(null);
    setRepaired(false);
  }, [f]);
  const right = f.causes.find((c) => c.right)!;
  const picked = f.causes.find((c) => c.id === choice);
  return (
    <>
      <ol className="steps" aria-label="Diagnosis steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined} className={i < step ? 'done' : ''}>
            <button disabled={i > step && !(i === 4 && picked?.right)} onClick={() => setStep(i)}>
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>
      {step === 0 && (
        <>
          <p className="ex-fn">“{f.complaint}”</p>
          <Cluster gauges={f.gauges} />
          <button className="pbtn pbtn--wide pbtn--accent" onClick={() => setStep(1)}>
            Start the diagnosis
          </button>
        </>
      )}
      {step === 1 && (
        <>
          <p>Choose what to look at. Each check shows you the part and what you find.</p>
          <ul className="checks">
            {f.inspections.map((i) => {
              const done = seen.includes(i.id);
              return (
                <li key={i.id}>
                  <button
                    className="ex-row"
                    aria-expanded={done}
                    onClick={() => {
                      if (!done) setSeen((s) => [...s, i.id]);
                      look(world, i.look);
                    }}
                  >
                    <span className="ex-row__name">{i.label}</span>
                    {done && <span className="ex-row__fn finding">{i.finding}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <button className="pbtn pbtn--wide pbtn--accent" disabled={seen.length < 2} onClick={() => setStep(2)}>
            {seen.length < 2 ? 'Check at least two things' : 'Take measurements'}
          </button>
        </>
      )}
      {step === 2 && (
        <>
          <p>These values are live from the car. Compare them with normal.</p>
          <Cluster gauges={f.gauges} />
          <dl className="ex-facts">
            {f.measures.map((m) => (
              <div key={m.readout}>
                <dt>{READOUTS[m.readout]?.label ?? m.readout}: normal</dt>
                <dd>{m.normal}</dd>
              </div>
            ))}
          </dl>
          <button className="pbtn pbtn--wide pbtn--accent" onClick={() => setStep(3)}>
            Decide the cause
          </button>
        </>
      )}
      {step === 3 && (
        <>
          <fieldset className="causes">
            <legend>What is the most likely cause?</legend>
            {f.causes.map((c) => (
              <label key={c.id} className={choice === c.id ? (c.right ? 'cause cause--right' : 'cause cause--wrong') : 'cause'}>
                <input type="radio" name="cause" value={c.id} checked={choice === c.id} onChange={() => setChoice(c.id)} />
                <span>{c.label}</span>
              </label>
            ))}
          </fieldset>
          {picked && (
            <p className={picked.right ? 'verdict verdict--right' : 'verdict verdict--wrong'} aria-live="polite">
              <b>{picked.right ? 'Yes. ' : 'Not this one. '}</b>
              {picked.why}
            </p>
          )}
          <button className="pbtn pbtn--wide pbtn--accent" disabled={!picked?.right} onClick={() => (setStep(4), look(world, f.reveal.look))}>
            Show what failed
          </button>
        </>
      )}
      {step === 4 && (
        <>
          <h3>{right.label}</h3>
          <p>{f.reveal.text}</p>
          <p className="ex-compare">
            <b>The repair.</b> {f.reveal.repair}
          </p>
          <Cluster gauges={f.gauges} />
          <button
            className="pbtn pbtn--wide pbtn--accent"
            disabled={repaired}
            onClick={() => {
              world.model.faults = { ...NO_FAULTS };
              if (world.live) world.live = { ...world.live, setup: undefined };
              setRepaired(true);
            }}
          >
            {repaired ? 'Repaired: watch the gauges recover' : 'Repair it'}
          </button>
        </>
      )}
    </>
  );
}

export function SimulatePanel({ world }: { world: World }) {
  const id = useApp((s) => s.scenario);
  const go = useApp((s) => s.go);
  const sc = id ? SCENARIO_BY_ID[id] : null;
  const fault = id ? FAULT_BY_ID[id] : null;
  return (
    <aside className="panel panel--right eng sim pe" data-occludes="right" aria-label="Simulate">
      {!sc && !fault ? (
        <>
          <h2>Simulate</h2>
          <p>Drive the car through everyday situations, or diagnose a fault the way a technician would.</p>
          <h3>Drive</h3>
          <ul className="ex-list">
            {SCENARIOS.map((s) => (
              <li key={s.id}>
                <button className="ex-row" onClick={() => go({ scenario: s.id })}>
                  <span className="ex-row__name">{s.title}</span>
                  <span className="ex-row__fn">{s.summary}</span>
                </button>
              </li>
            ))}
          </ul>
          <h3>Diagnose</h3>
          <ul className="ex-list">
            {FAULTS.map((f) => (
              <li key={f.id}>
                <button className="ex-row" onClick={() => go({ scenario: f.id })}>
                  <span className="ex-row__name">{f.title}</span>
                  <span className="ex-row__fn">“{f.complaint}”</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="ex-crumbs">
            <button className="ex-back" onClick={() => go({ scenario: null })} aria-label="Back to the list">
              ‹
            </button>
            <span className="eng-kicker">{sc ? 'Drive' : 'Diagnose'}</span>
          </div>
          <h2>{sc?.title ?? fault!.title}</h2>
          {sc ? (
            <>
              <p className="ex-fn">{sc.summary}</p>
              <Cluster gauges={sc.gauges} />
              <p className="ex-compare">
                <b>Watch for.</b> {sc.watch}
              </p>
              <button className="pbtn pbtn--wide" onClick={() => runScenario(world, sc.program)}>
                Start again
              </button>
            </>
          ) : (
            <Diagnose f={fault!} world={world} />
          )}
        </>
      )}
    </aside>
  );
}
