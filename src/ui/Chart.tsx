/**
 * A small line chart (SVG): the current run bold, earlier runs faint behind it, an optional
 * reference curve dashed. Axes get round-number ticks. Colours come from the visual language;
 * each series is also named in the legend, so colour is never the only key.
 */
import type { Sample } from '../content/labs';

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

export function Chart({ spec, runs, height = 170 }: { spec: ChartSpec; runs: Sample[][]; height?: number }) {
  const W = 320;
  const H = height;
  const m = { l: 40, r: 10, t: 10, b: 30 };
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
        {runs.map((run, ri) =>
          spec.series.map((se) => (
            <path key={`${ri}-${se.key}`} d={path(run.map((s) => [s[spec.x], s[se.key]]))} stroke={se.color} className={ri === runs.length - 1 ? 'chart__line' : 'chart__line chart__line--old'} />
          )),
        )}
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
        {runs.length > 1 && <span className="chart__old">Faint: earlier runs</span>}
      </figcaption>
    </figure>
  );
}
