/**
 * Engineer: pick a lab, change its settings, run it. The run is computed at once (the chart and
 * the numbers), and the same program plays on the car in the scene. Up to three earlier runs
 * stay on the chart for comparison; changing lab clears them.
 */
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../state/store';
import { LABS, LAB_BY_ID, defaults, simulateLab, type Lab, type LabValues, type Sample } from '../../content/labs';
import type { World } from '../../world/world';
import { Chart } from '../Chart';

function Control({ c, value, onChange }: { c: Lab['controls'][number]; value: LabValues[string]; onChange: (v: LabValues[string]) => void }) {
  if (c.kind === 'toggle')
    return (
      <label className="ctl ctl--toggle">
        <span>{c.label}</span>
        <button role="switch" aria-checked={!!value} className="switch" onClick={() => onChange(!value)}>
          <span>{value ? 'On' : 'Off'}</span>
        </button>
      </label>
    );
  if (c.kind === 'choice')
    return (
      <fieldset className="ctl ctl--choice">
        <legend>{c.label}</legend>
        <div className="seg">
          {c.options!.map((o) => (
            <button key={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>
    );
  const v = value as number;
  const shown = c.format ? c.format(v) : `${v.toLocaleString('en-GB')}${c.unit ? ` ${c.unit}` : ''}`;
  return (
    <label className="ctl">
      <span className="ctl__row">
        <span>{c.label}</span>
        <output className="num">{shown}</output>
      </span>
      <input type="range" min={c.min} max={c.max} step={c.step} value={v} aria-valuetext={shown} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function EngineerPanel({ world }: { world: World }) {
  const labId = useApp((s) => s.lab);
  const go = useApp((s) => s.go);
  const lab = LAB_BY_ID[labId ?? ''] ?? null;
  const [values, setValues] = useState<LabValues>(() => (lab ? defaults(lab) : {}));
  const [runs, setRuns] = useState<Sample[][]>([]);
  const [last, setLast] = useState<LabValues | null>(null);
  useEffect(() => {
    if (!lab) return;
    setValues(defaults(lab));
    setRuns([]);
    setLast(null);
  }, [lab]);
  const results = useMemo(() => (lab && runs.length && last ? lab.results(runs[runs.length - 1], last) : []), [lab, runs, last]);

  const run = () => {
    if (!lab) return;
    const v = { ...values };
    const samples = simulateLab(lab, v);
    setRuns((r) => [...r.slice(-3), samples]);
    setLast(v);
    const r = lab.run(v);
    world.setLive({
      id: `lab:${lab.id}`,
      start: r.start,
      drive: r.drive,
      timeScale: r.timeScale,
      setup: (car) => {
        car.road = { mu: 1, ...(r.road ?? {}) };
        car.params = { ...car.params, ...(r.params ?? {}) };
        car.faults = { ...car.faults, ...(r.faults ?? {}) };
      },
    });
  };

  return (
    <aside className="panel panel--right eng pe" data-occludes="right" aria-label="Engineer labs">
      {!lab ? (
        <>
          <h2>Engineer</h2>
          <p>Eight questions engineers ask about this car. Change one thing, run the car’s model, and see what happens.</p>
          <ul className="ex-list">
            {LABS.map((l) => (
              <li key={l.id}>
                <button className="ex-row" onClick={() => go({ lab: l.id })}>
                  <span className="ex-row__name">{l.title}</span>
                  <span className="ex-row__fn">{l.question}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="ex-crumbs">
            <button className="ex-back" onClick={() => go({ lab: null })} aria-label="Back to the labs">
              ‹
            </button>
            <span className="eng-kicker">Lab {LABS.indexOf(lab) + 1} of {LABS.length}</span>
          </div>
          <h2>{lab.title}</h2>
          <p className="ex-fn">{lab.question}</p>
          <div className="eng-controls">
            {lab.controls.map((c) => (
              <Control key={c.id} c={c} value={values[c.id]} onChange={(v) => setValues((s) => ({ ...s, [c.id]: v }))} />
            ))}
          </div>
          <div className="eng-actions">
            <button className="pbtn pbtn--wide pbtn--accent" onClick={run}>
              Run
            </button>
            {runs.length > 0 && (
              <button
                className="pbtn pbtn--wide"
                onClick={() => {
                  setRuns([]);
                  setLast(null);
                }}
              >
                Clear
              </button>
            )}
          </div>
          <Chart spec={lab.chart} runs={runs} />
          {results.length > 0 && (
            <dl className="eng-results" aria-live="polite">
              {results.map((r) => (
                <div key={r.label}>
                  <dt>{r.label}</dt>
                  <dd className="num">{r.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {runs.length > 0 && (
            <p className="ex-compare">
              <b>What to notice.</b> {lab.notice}
            </p>
          )}
        </>
      )}
    </aside>
  );
}
