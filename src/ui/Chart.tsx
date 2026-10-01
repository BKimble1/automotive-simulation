/**
 * A small line chart (SVG): the active run bold, the other runs (the baseline and up to two
 * comparisons) fainter, each with its own dash pattern and named in the legend, so neither
 * colour nor weight is the only key. An optional reference curve is dotted. Axes get
 * round-number ticks.
 */
import type { Sample } from '../content/labs';

export interface ChartRun {
  id: number;
  label: string;
  samples: Sample[];
}

/** Dash patterns for runs other than the active one (by their place in the list). */
const DASH = ['', '6 3', '2 3', '9 3 2 3'];

export interface ChartSpec {
  x: string;
  xLabel: string;
  yLabel: string;
  series: { key: string; label: string; color: string }[];
  reference?: (x: number) => number;
  referenceLabel?: string;
  xMax?: number;
}

function ticks(lo: number, hi: number, n = 5): number[] {
  const span = hi - lo || 1;
  const raw = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-GB') : Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 1 ? 2 : 1));

export function Chart({ spec, runs: list, active, height = 170, onPick }: { spec: ChartSpec; runs: ChartRun[]; active: number; height?: number; onPick?: (id: number) => void }) {
  const W = 320;
  const H = height;
  const m = { l: 40, r: 10, t: 10, b: 30 };
  const runs = list.map((r) => r.samples);
  const all = runs.flat();
  if (!all.length) return <div className="chart chart--empty">Run the lab to see the result.</div>;
  const xs = all.map((s) => s[spec.x]);
  let x0 = Math.min(0, ...xs);
  let x1 = spec.xMax ?? Math.max(...xs);
  if (x1 - x0 < 1e-6) x1 = x0 + 1;
  const ys = all.flatMap((s) => spec.series.map((se) => s[se.key]));
  const refPts: [number, number][] = [];
  if (spec.reference)
    for (let i = 0; i <= 60; i++) {
      const x = x0 + ((x1 - x0) * i) / 60;
      refPts.push([x, spec.reference(x)]);
    }
  let y0 = Math.min(0, ...ys, ...refPts.map((p) => p[1]));
  let y1 = Math.max(...ys, ...refPts.map((p) => p[1]));
  if (y1 - y0 < 1e-6) y1 = y0 + 1;
  y1 += (y1 - y0) * 0.06;
  const X = (v: number) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v: number) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const path = (pts: [number, number][]) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${X(a).toFixed(1)},${Y(b).toFixed(1)}`).join('');
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${spec.yLabel} against ${spec.xLabel}`}>
        {ticks(y0, y1).map((t) => (
          <g key={`y${t}`}>
            <line x1={m.l} x2={W - m.r} y1={Y(t)} y2={Y(t)} className="chart__grid" />
            <text x={m.l - 5} y={Y(t) + 3.5} textAnchor="end" className="chart__tick">
              {fmt(t)}
            </text>
          </g>
        ))}
        {ticks(x0, x1, 5).map((t) => (
          <text key={`x${t}`} x={X(t)} y={H - m.b + 13} textAnchor="middle" className="chart__tick">
            {fmt(t)}
          </text>
        ))}
        <line x1={m.l} x2={W - m.r} y1={Y(y0)} y2={Y(y0)} className="chart__axis" />
        {refPts.length > 0 && <path d={path(refPts)} className="chart__ref" />}
        {list.map((run, ri) =>
          run.id === active
            ? null
            : spec.series.map((se) => <path key={`${run.id}-${se.key}`} d={path(run.samples.map((s) => [s[spec.x], s[se.key]]))} stroke={se.color} strokeDasharray={DASH[ri % DASH.length] || '6 3'} className="chart__line chart__line--old" />),
        )}
        {list
          .filter((r) => r.id === active)
          .map((run) => spec.series.map((se) => <path key={`${run.id}-${se.key}`} d={path(run.samples.map((s) => [s[spec.x], s[se.key]]))} stroke={se.color} className="chart__line" />))}
        <text x={W - m.r} y={H - 4} textAnchor="end" className="chart__label">
          {spec.xLabel}
        </text>
      </svg>
      <figcaption className="chart__legend">
        <span className="chart__ylabel">{spec.yLabel}</span>
        {spec.series.map((se) => (
          <span key={se.key}>
            <i style={{ background: se.color }} />
            {se.label}
          </span>
        ))}
        {spec.reference && (
          <span>
            <i className="chart__refkey" />
            {spec.referenceLabel}
          </span>
        )}
      </figcaption>
      {list.length > 1 && (
        <div className="chart__runs" role="group" aria-label="Runs on the chart">
          {list.map((r, ri) => (
            <button key={r.id} className="chart__run" aria-pressed={r.id === active} onClick={() => onPick?.(r.id)}>
              <svg width="22" height="8" aria-hidden="true">
                <line x1="1" x2="21" y1="4" y2="4" stroke="currentColor" strokeWidth={r.id === active ? 2.4 : 1.4} strokeDasharray={r.id === active ? '' : DASH[ri % DASH.length] || '6 3'} />
              </svg>
              {r.label}
            </button>
          ))}
        </div>
      )}
    </figure>
  );
}
