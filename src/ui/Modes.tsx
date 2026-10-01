/** The interface of each mode. */
import { useApp } from '../state/store';
import type { World } from '../world/world';
import { LessonPlayer } from './LessonPlayer';
import { ExplorePanel } from './explore/ExplorePanel';

export function Modes({ world }: { world: World }) {
  const mode = useApp((s) => s.mode);
  const lesson = useApp((s) => s.lesson);
  const go = useApp((s) => s.go);
  const set = useApp((s) => s.set);
  if (mode === 'watch') return <LessonPlayer world={world} onExit={() => go({ mode: 'intro' })} exitLabel="Leave the film" />;
  if (mode === 'explore') {
    if (lesson) return <LessonPlayer world={world} onExit={() => set({ lesson: null })} exitLabel="Back to the system" />;
    return <ExplorePanel world={world} />;
  }
  return null;
}
