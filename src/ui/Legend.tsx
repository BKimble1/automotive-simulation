/**
 * The visual key: every colour and shape the scene uses, from the visual-language table. Each
 * kind is named and has its own shape, so colour is never the only cue.
 */
import { useApp } from '../state/store';
import { LANGUAGE, LEGEND_ORDER } from '../scene/viz/language';
import { CloseIcon } from './icons';

export function Legend() {
  const on = useApp((s) => s.legend);
  const set = useApp((s) => s.set);
  if (!on) return null;
  return (
    <section className="legend pe" aria-label="Visual key">
      <div className="legend__head">
        <h2>What the colours and shapes mean</h2>
        <button className="pbtn" onClick={() => set({ legend: false })} aria-label="Close the visual key">
          <CloseIcon />
        </button>
      </div>
      <ul>
        {LEGEND_ORDER.map((k) => {
          const l = LANGUAGE[k];
          return (
            <li key={k}>
              <i className={`sw sw--${l.style}`} style={{ color: l.color }} />
              <span>
                <b>{l.label}</b> {l.pattern}
              </span>
            </li>
          );
        })}
        <li>
          <i className="sw sw--hl" />
          <span>
            <b>Subject</b> a lavender edge light on what the step is about
          </span>
        </li>
        <li>
          <i className="sw sw--ghost" />
          <span>
            <b>X-ray</b> bodywork and parts turned to tinted glass to show what is behind
          </span>
        </li>
        <li>
          <i className="sw sw--cut" />
          <span>
            <b>Cut surface</b> hatched grey where a section plane slices a housing
          </span>
        </li>
      </ul>
    </section>
  );
}
