/**
 * Engineer: pick a lab, change its settings, run it. Each run is one complete specification
 * (sim/run.ts): its chart is computed off the page (jobs.ts) while the same run plays on the car,
 * and the live run ends where the chart does. Opening a lab runs its baseline (the design
 * values); up to two more runs stay on the chart for comparison, each labelled with what was
 * changed. A run's numbers are always those of the configuration that produced them.
 *
 * States, each shown: computing (only when it takes long enough to notice), playing, paused,
 * finished; Replay plays the active run's configuration again, Reset returns the settings to the
 * design values and the car to idle.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useRun } from '../../state/store';
import { LABS, LAB_BY_ID, defaults, labRun, type Lab, type LabValues, type Sample } from '../../content/labs';
import type { World } from '../../world/world';
import { SheetHandle, useSheet } from '../Sheet';
import { IDLE_RUN } from '../../world/controller';
import { Chart, type ChartRun } from '../Chart';
import { paceLabel } from '../Readouts';
import { BackIcon, PauseIcon, PlayIcon, ReplayIcon } from '../icons';

function Control({ c, value, onChange }: { c: Lab['controls'][number]; value: LabValues[string]; onChange: (v: LabValues[string]) => void }) {
  if (c.kind === 'toggle')
    return (
      <div className="ctl ctl--toggle">
        <span id={`ctl-${c.id}`}>{c.label}</span>
        <button role="switch" aria-checked={!!value} aria-labelledby={`ctl-${c.id}`} className="switch" onClick={() => onChange(!value)}>
          <span>{value ? 'On' : 'Off'}</span>
        </button>
      </div>
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

/** How a configuration differs from the design values, in words ("Final drive 3.60 : 1"). */
function describe(lab: Lab, v: LabValues): string {
  const base = defaults(lab);
  const diffs = lab.controls
    .filter((c) => v[c.id] !== base[c.id])
    .map((c) => {
      const x = v[c.id];
      if (c.kind === 'toggle') return `${c.label} ${x ? 'on' : 'off'}`;
      if (c.kind === 'choice') return `${c.options!.find((o) => o.value === x)?.label ?? x}`;
      return `${c.label} ${c.format ? c.format(x as number) : `${(x as number).toLocaleString('en-GB')}${c.unit ? ` ${c.unit}` : ''}`}`;
    });
  return diffs.length ? diffs.join(', ') : 'Design values';
}

interface Run extends ChartRun {
  values: LabValues;
  pending: boolean;
}

export function EngineerPanel({ world }: { world: World }) {
  const labId = useApp((s) => s.lab);
  const go = useApp((s) => s.go);
  const lab = LAB_BY_ID[labId ?? ''] ?? null;
  const run = useRun();
  const [values, setValues] = useState<LabValues>(() => (lab ? defaults(lab) : {}));
  const [runs, setRuns] = useState<Run[]>([]);
  const [active, setActive] = useState(0);
  const [slow, setSlow] = useState(false);
  const serial = useRef(0);
  const sheet = useSheet();

  /** Start a run: the live car at once, its chart from the worker. */
  const start = (l: Lab, v: LabValues, replaceBaseline = false) => {
    const id = ++serial.current;
    world.setLive(labRun(l, v));
    world.setPaused(false);
    const label = replaceBaseline ? 'Baseline' : describe(l, v);
    setRuns((rs) => {
      const kept = replaceBaseline ? [] : rs.filter((r) => r.label === 'Baseline' || rs.indexOf(r) >= rs.length - 1);
      return [...kept.filter((r) => !(r.label === label && !replaceBaseline)), { id, label, values: v, samples: [], pending: true }];
    });
    setActive(id);
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), 150);
    world.jobs
      .lab(l.id, v)
      .then((samples: Sample[]) => {
        setRuns((rs) => rs.map((r) => (r.id === id ? { ...r, samples, pending: false } : r)));
      })
      .catch(() => setRuns((rs) => rs.filter((r) => r.id !== id || r.samples.length)))
      .finally(() => {
        clearTimeout(timer);
        setSlow(false);
      });
  };

  // a new lab: its baseline runs at once
  useEffect(() => {
    if (!lab) return;
    const v = defaults(lab);
    setValues(v);
    start(lab, v, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lab]);

  const shown = runs.filter((r) => r.samples.length);
  const act = runs.find((r) => r.id === active) ?? null;
  const results = useMemo(() => (lab && act && act.samples.length ? lab.results(act.samples, act.values) : []), [lab, act]);
  const changed = lab ? describe(lab, values) : '';
  const same = act && JSON.stringify(act.values) === JSON.stringify(values);

  const status =
    run.id && lab && run.id === `lab:${lab.id}`
      ? run.status === 'paused'
        ? 'Paused'
        : run.status === 'ended'
          ? 'Run complete'
          : `Playing · ${run.t.toFixed(1)} of ${(run.duration ?? 0).toFixed(1)} s${paceLabel(run.scale) ? ` · ${paceLabel(run.scale)!.toLowerCase()}` : ''}`
      : '';

  return (
    <aside className={`panel panel--right eng pe ${sheet.className}`} style={sheet.style} data-occludes="right" aria-label="Engineer labs">
      <SheetHandle />
      {!lab ? (
        <>
          <h2>Engineer</h2>
          <p>Eight questions engineers ask about this car. Change one thing, run the car’s model, and compare with the design.</p>
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
            <button
              className="ex-back"
              onClick={() => {
                world.setLive(IDLE_RUN);
                go({ lab: null });
              }}
              aria-label="Back to the labs"
            >
              <BackIcon />
            </button>
            <span className="eng-kicker">
              Lab {LABS.indexOf(lab) + 1} of {LABS.length}
            </span>
          </div>
          <h2>{lab.title}</h2>
          <p className="ex-fn">{lab.question}</p>
          <div className="eng-controls">
            {lab.controls.map((c) => (
              <Control key={c.id} c={c} value={values[c.id]} onChange={(v) => setValues((s) => ({ ...s, [c.id]: v }))} />
            ))}
          </div>
          <div className="eng-actions">
            <button className="pbtn pbtn--wide pbtn--accent" onClick={() => start(lab, { ...values })} disabled={!!same && !act?.pending && run.status !== 'ended'}>
              {same ? 'Running this setting' : `Run: ${changed}`}
            </button>
          </div>
          <div className="eng-run" aria-live="polite">
            <span className="eng-run__status">{slow ? 'Computing the chart…' : status}</span>
            <span className="eng-run__btns">
              {run.status !== 'ended' && run.status !== 'none' && (
                <button className="pbtn" onClick={() => world.setPaused(run.status !== 'paused')} aria-label={run.status === 'paused' ? 'Resume the run' : 'Pause the run'}>
                  {run.status === 'paused' ? <PlayIcon /> : <PauseIcon />}
                </button>
              )}
              {act && (
                <button className="pbtn" onClick={() => (world.setLive(labRun(lab, act.values)), world.setPaused(false))} aria-label="Replay the active run on the car">
                  <ReplayIcon />
                </button>
              )}
              <button
                className="pbtn pbtn--text"
                onClick={() => {
                  const v = defaults(lab);
                  setValues(v);
                  start(lab, v, true);
                }}
              >
                Reset
              </button>
            </span>
          </div>
          <Chart spec={lab.chart} runs={shown} active={active} onPick={(id) => setActive(id)} />
          {results.length > 0 && (
            <>
              <h3 className="eng-results__title">{act?.label === 'Baseline' ? 'Baseline (design values)' : act?.label}</h3>
              <dl className="eng-results">
                {results.map((r) => (
                  <div key={r.label}>
                    <dt>{r.label}</dt>
                    <dd className="num">{r.value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          {shown.length > 0 && (
            <p className="ex-compare">
              <b>What to notice.</b> {lab.notice}
            </p>
          )}
        </>
      )}
    </aside>
  );
}
