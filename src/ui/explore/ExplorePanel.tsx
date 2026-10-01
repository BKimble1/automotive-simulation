/** Explore (first version): the ten systems and a way into each one's lesson. */
import { useApp } from '../../state/store';
import type { World } from '../../world/world';

const SYSTEMS: { id: string; label: string; lesson?: string }[] = [
  { id: 'power', label: 'Power generation', lesson: 'four-stroke' },
  { id: 'air', label: 'Air, fuel, ignition and emissions' },
  { id: 'cooling', label: 'Cooling and lubrication' },
  { id: 'driveline', label: 'Transmission and driveline', lesson: 'torque-path' },
  { id: 'chassis', label: 'Steering and suspension' },
  { id: 'brakes', label: 'Brakes, wheels and tyres' },
  { id: 'electrical', label: 'Electrical power, sensors and control', lesson: 'start' },
  { id: 'body', label: 'Body, aerodynamics and structure' },
  { id: 'cabin', label: 'Cabin, HVAC and controls' },
  { id: 'safety', label: 'Occupant safety' },
];

export function ExplorePanel(_: { world: World }) {
  const system = useApp((s) => s.system);
  const go = useApp((s) => s.go);
  const set = useApp((s) => s.set);
  const cur = SYSTEMS.find((s) => s.id === system);
  return (
    <nav className="panel panel--left pe" data-occludes="left" aria-label="Systems">
      <h3>Systems</h3>
      {SYSTEMS.map((s) => (
        <button key={s.id} className="navitem" aria-current={s.id === system ? 'true' : undefined} onClick={() => go({ system: s.id, part: null })}>
          {s.label}
        </button>
      ))}
      {cur?.lesson && (
        <button className="pbtn pbtn--accent" style={{ marginTop: 12 }} onClick={() => set({ lesson: cur.lesson! })}>
          Show how it works
        </button>
      )}
    </nav>
  );
}
