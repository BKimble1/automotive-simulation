/**
 * The header: the FAB / ONE wordmark (inside the site, a link back to its homepage), the
 * simulation's name, the four ways in (Watch, Explore, Engineer, Simulate), and quiet controls
 * (the visual-language key, sound, captions, about).
 */
import { useApp, type Mode } from '../state/store';
import { BackIcon, CaptionIcon, InfoIcon, KeyIcon, SoundIcon } from './icons';

const SITE_HOME = import.meta.env.VITE_FABONE_HOME;

export function Wordmark() {
  const go = useApp((s) => s.go);
  if (SITE_HOME)
    return (
      <a className="wordmark pe" href={SITE_HOME} aria-label="Back to FAB / ONE" title="Back to FAB / ONE">
        <BackIcon />
        <span>
          FAB<span className="slash">/</span>ONE
        </span>
      </a>
    );
  return (
    <button className="wordmark pe" onClick={() => go({ mode: 'intro' })} aria-label="FAB / ONE: AUTOMOTIVE / ONE home">
      FAB<span className="slash">/</span>ONE
    </button>
  );
}

const MODES: { id: Mode; label: string }[] = [
  { id: 'watch', label: 'Watch' },
  { id: 'explore', label: 'Explore' },
  { id: 'engineer', label: 'Engineer' },
  { id: 'simulate', label: 'Simulate' },
];

export function Header() {
  const mode = useApp((s) => s.mode);
  const go = useApp((s) => s.go);
  const sound = useApp((s) => s.sound);
  const soundBlocked = useApp((s) => s.soundBlocked);
  const captions = useApp((s) => s.captions);
  const legend = useApp((s) => s.legend);
  const set = useApp((s) => s.set);
  return (
    <header className="top">
      {/* the page's heading stays outside the button, which a phone's header hides */}
      <h1 className="sr-only">AUTOMOTIVE / ONE</h1>
      <div className="top__left">
        <Wordmark />
        <button className="top__sim pe" onClick={() => go({ mode: 'intro' })} aria-label="AUTOMOTIVE / ONE: back to the start">
          <b aria-hidden>
            AUTOMOTIVE<span className="slash">/</span>ONE
          </b>
          <span className="top__model">S-1 sedan</span>
        </button>
      </div>
      <nav className="tabs pe" aria-label="Modes">
        {MODES.map((m) => (
          <button key={m.id} className="tab" aria-current={mode === m.id ? 'page' : undefined} onClick={() => go({ mode: m.id, ...(m.id === 'explore' ? { system: null, part: null } : {}) })}>
            {m.label}
          </button>
        ))}
      </nav>
      <div className="top__right">
        <button className="ibtn pe" aria-pressed={legend} onClick={() => set({ legend: !legend })} title="Visual key" aria-label={legend ? 'Hide the visual key' : 'Show the visual key: what each colour and shape means'}>
          <KeyIcon />
        </button>
        <button className="ibtn pe" aria-pressed={captions} onClick={() => set({ captions: !captions })} title={captions ? 'Captions on' : 'Captions off'} aria-label={captions ? 'Turn captions off' : 'Turn captions on'}>
          <CaptionIcon />
        </button>
        <button
          className={`ibtn pe ${sound && soundBlocked ? 'ibtn--alert' : ''}`}
          aria-pressed={sound}
          onClick={() => set({ sound: !sound || soundBlocked, soundBlocked: false })}
          title={sound && soundBlocked ? 'Tap to let the browser play the narration' : sound ? 'Sound on' : 'Sound off'}
          aria-label={sound && soundBlocked ? 'The browser blocked the narration: tap to play it' : sound ? 'Turn sound off' : 'Turn sound on'}
        >
          <SoundIcon off={!sound} />
        </button>
        <button className="ibtn pe" onClick={() => set({ info: true })} title="About this simulation" aria-label="About this simulation: what is modelled, simplified and approximated">
          <InfoIcon />
        </button>
      </div>
    </header>
  );
}
