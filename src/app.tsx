/**
 * The application shell: the canvas (the world draws into it), the loading veil, and the
 * interface for the current mode. The world is created once and lives as long as the page;
 * the interface talks to it only through the stores and the controller (src/world/controller.ts).
 */
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { syncAddress, useApp } from './state/store';
import './styles/app.css';
import { Header } from './ui/Header';
import { Intro } from './ui/Intro';
import { Modes } from './ui/Modes';
import { PanelBoundary } from './ui/PanelBoundary';
import { Notices } from './ui/Notices';
import { Legend } from './ui/Legend';
import { Info } from './ui/Info';
import type { World } from './world/world';
import { attachController } from './world/controller';
import { useFreeArea } from './ui/useFreeArea';
import { useNarration } from './ui/useNarration';

function webglAvailable(): boolean {
  if (new URLSearchParams(location.search).get('nowebgl') === '1') return false;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    // a probe only: give its context back at once (browsers cap how many may live)
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

function Stage({ onWorld }: { onWorld: (w: World) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const set = useApp((s) => s.set);
  useEffect(() => {
    const canvas = ref.current!;
    let world: World | null = null;
    let disposed = false;
    let ro: ResizeObserver | null = null;
    let detach: (() => void) | null = null;
    (async () => {
      await document.fonts?.ready;
      const { World } = await import('./world/world');
      if (disposed) return;
      world = new World(canvas);
      const resize = () => world!.resize(canvas.clientWidth, canvas.clientHeight);
      resize();
      ro = new ResizeObserver(resize);
      ro.observe(canvas);
      const ok = await world.init((p) => set({ progress: p }));
      if (!ok || disposed) {
        if (!ok) set({ progress: -1 });
        return;
      }
      world.exposeHooks();
      detach = attachController(world);
      world.start();
      onWorld(world);
      set({ ready: true });
    })().catch((e) => {
      console.error(e);
      set({ progress: -1 });
    });
    return () => {
      disposed = true;
      ro?.disconnect();
      detach?.();
      world?.dispose();
    };
  }, [set, onWorld]);
  return <canvas ref={ref} className="stage stage--grab" aria-label="The S-1 sedan. Drag, or use the arrow keys, to look around; + and − zoom; Home recentres" tabIndex={0} />;
}

function Veil() {
  const progress = useApp((s) => s.progress);
  const ready = useApp((s) => s.ready);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setGone(true), 1000);
    return () => clearTimeout(t);
  }, [ready]);
  if (gone) return null;
  return (
    <div className={`veil ${ready ? 'veil--done' : ''}`} role="status" aria-live="polite">
      <div className="veil__box">
        <span className="wordmark" style={{ cursor: 'default' }}>
          AUTOMOTIVE<span className="slash">/</span>ONE
        </span>
        <div className="veil__bar">
          <div className="veil__fill" style={{ width: `${Math.max(4, progress * 100)}%` }} />
        </div>
        <span className="veil__text">{progress < 0 ? 'This device could not start the 3D view.' : progress < 0.5 ? 'Building the car…' : 'Lighting the studio…'}</span>
      </div>
    </div>
  );
}

function NoWebGL() {
  const home = import.meta.env.VITE_FABONE_HOME;
  return (
    <div className="nowebgl">
      <span className="wordmark">
        AUTOMOTIVE<span className="slash">/</span>ONE
      </span>
      <h1>This simulation needs 3D graphics (WebGL 2).</h1>
      <p>Your browser or device could not start it. Try a recent version of Chrome, Edge, Firefox or Safari, or turn on hardware acceleration in the browser’s settings.</p>
      {home && <a href={home}>Back to FAB / ONE</a>}
    </div>
  );
}

function App() {
  const mode = useApp((s) => s.mode);
  const ready = useApp((s) => s.ready);
  const progress = useApp((s) => s.progress);
  const [world, setWorld] = useState<World | null>(null);
  const [gl] = useState(webglAvailable);
  const reduced = useApp((s) => s.reducedMotion);
  // reduced motion (the system setting or the switch in Info) also quiets the interface
  useEffect(() => {
    document.documentElement.classList.toggle('reduced', reduced);
  }, [reduced]);
  useFreeArea(world);
  useNarration(world);
  if (!gl) return <NoWebGL />;
  return (
    <div className="app">
      <Stage onWorld={setWorld} />
      <div className="ui">
        {ready && <Header />}
        {ready && mode === 'intro' && <Intro />}
        {ready && world && (
          <PanelBoundary resetKey={`${mode}`}>
            <Modes world={world} />
          </PanelBoundary>
        )}
        <Notices />
        {ready && <Legend />}
        {ready && <Info />}
      </div>
      <Veil />
      {progress < 0 && <NoWebGL />}
    </div>
  );
}

export function mount(el: HTMLElement) {
  syncAddress();
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
