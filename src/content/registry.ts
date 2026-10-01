/**
 * The component registry: everything the visitor can find, select and read about, organised as
 * vehicle → system → assembly → component. Ids are the scene's component names (the rig's
 * `component`), so an entry's drawn parts are found without a second list; `nodes` overrides
 * that where the scene groups things differently. Every text is short and plain; `depth` says who
 * it is for (1 every learner, 2 the interested, 3 the engineering student).
 *
 * Systems and assemblies are entries too (kind 'system' / 'assembly'), so the hierarchy, search
 * and Back all work the same way at every level.
 */
import { PARTS_A } from './registryParts';

export type SystemId = 'power' | 'air' | 'cooling' | 'driveline' | 'chassis' | 'brakes' | 'electrical' | 'body' | 'cabin' | 'safety';
export type Depth = 1 | 2 | 3;

export interface Component {
  id: string;
  kind: 'system' | 'assembly' | 'part';
  name: string;
  aliases: string[];
  system: SystemId;
  /** The assembly (or, for an assembly, the system) it belongs to. */
  parent?: string;
  /** Ids it connects to or touches. */
  neighbours: string[];
  function: string;
  location: string;
  inputs: string[];
  outputs: string[];
  /** What physically changes while it works. */
  changes: string;
  material: string;
  failures: string[];
  /** A view id to visit for it (default: its system's). */
  shot?: string;
  /** A lesson it takes part in. */
  animation?: string;
  /** Other layouts and how they differ. */
  compare?: string;
  depth: Depth;
  /** Scene part names that draw it (default: parts whose component is this id; for systems and
   * assemblies, their children's). */
  nodes?: string[];
}

/** Partial entries: the defaults fill in the rest. */
export type Entry = Omit<Component, 'kind' | 'system' | 'aliases' | 'neighbours' | 'inputs' | 'outputs' | 'failures' | 'changes' | 'material' | 'location'> & Partial<Pick<Component, 'aliases' | 'neighbours' | 'inputs' | 'outputs' | 'failures' | 'changes' | 'material' | 'location'>>;

interface SystemDef {
  id: SystemId;
  name: string;
  short: string;
  view: string;
  function: string;
  location: string;
  inputs: string[];
  outputs: string[];
  changes: string;
  compare?: string;
  assemblies: Entry[];
}

const SYSTEMS_DEF: SystemDef[] = [
  {
    id: 'power',
    name: 'Engine',
    short: 'Power',
    view: 'sys-power',
    function: 'Turns the chemical energy in petrol into a turning crankshaft. Air and fuel burn in four cylinders; the pressure pushes pistons down, and connecting rods turn their push into rotation.',
    location: 'Front of the car, under the hood, mounted lengthwise with the gearbox behind it.',
    inputs: ['Air', 'Fuel', 'Spark (electrical energy)', 'Driver demand (accelerator)'],
    outputs: ['Torque at the crankshaft', 'Heat (to coolant, oil and exhaust)', 'Exhaust gas'],
    changes: 'Pistons travel 100 mm up and down up to about 110 times a second at the limiter; valves open and close in time with them; gas temperature in a cylinder peaks above 2,000 °C during combustion.',
    compare: 'Many cars mount the engine across the car (transverse) and drive the front wheels. This one sits lengthwise and drives the rear wheels, which leaves room for a long gearbox and balances the weight front to rear.',
    assemblies: [
      { id: 'engine-structure', name: 'Engine structure', parent: 'power', depth: 1, function: 'The block and head form the cylinders and combustion chambers and hold every moving part in line.', animation: 'four-stroke' },
      { id: 'rotating-assembly', name: 'Rotating assembly', parent: 'power', depth: 1, function: 'Pistons, connecting rods and the crankshaft turn the push of combustion into rotation.', animation: 'four-stroke', shot: 'cylinder-cutaway' },
      { id: 'valvetrain', name: 'Valvetrain and timing', parent: 'power', depth: 2, function: 'The camshafts, driven by a chain at half crankshaft speed, open the intake and exhaust valves at the right moment in every cycle.', animation: 'four-stroke' },
      { id: 'ignition', name: 'Ignition', parent: 'power', depth: 1, function: 'One coil per cylinder makes the high voltage that jumps the spark plug gap to light the mixture.' },
      { id: 'injection', name: 'Direct injection', parent: 'power', depth: 2, function: 'A cam-driven pump raises fuel pressure to about 200 bar; injectors spray it straight into each cylinder.' },
    ],
  },
  {
    id: 'air',
    name: 'Air, fuel and exhaust',
    short: 'Air & fuel',
    view: 'sys-air',
    function: 'Brings clean, measured air and fuel to the engine and carries the burnt gas away, cleaned and quietened.',
    location: 'Air enters behind the front grille; fuel comes from the tank under the rear seat; the exhaust runs under the floor to the rear bumper.',
    inputs: ['Outside air', 'Fuel from the tank'],
    outputs: ['Metered air and fuel to the cylinders', 'Cleaned exhaust gas'],
    changes: 'At full power the engine breathes about 200 grams of air a second, roughly 15 times the mass of fuel it burns.',
    assemblies: [
      { id: 'intake', name: 'Air intake', parent: 'air', depth: 1, function: 'Filters and measures the air, and the throttle sets how much reaches the cylinders.' },
      { id: 'fuel', name: 'Fuel supply', parent: 'air', depth: 1, function: 'Stores fuel and pumps it forward to the engine’s high-pressure pump.' },
      { id: 'exhaust', name: 'Exhaust', parent: 'air', depth: 1, function: 'Collects the burnt gas, cleans it in the catalytic converter and quietens it before it leaves at the back.' },
    ],
  },
  {
    id: 'cooling',
    name: 'Cooling and lubrication',
    short: 'Cooling',
    view: 'sys-cooling',
    function: 'Keeps the engine at its working temperature and every bearing on a film of oil.',
    location: 'Radiator and fans at the front; coolant passages and the oil circuit inside the engine.',
    inputs: ['Engine heat', 'Air through the radiator', 'Oil from the sump'],
    outputs: ['Heat to the air (and to the cabin heater)', 'Oil pressure at every bearing'],
    changes: 'Coolant warms from outside temperature to about 90 °C, then the thermostat opens; oil pressure rises with engine speed.',
    assemblies: [
      { id: 'cooling-circuit', name: 'Cooling circuit', parent: 'cooling', depth: 1, function: 'A pump circulates coolant through the engine; a thermostat sends it through the radiator once the engine is warm.' },
      { id: 'lubrication', name: 'Lubrication', parent: 'cooling', depth: 1, function: 'A pump draws oil from the pan, filters it and feeds it under pressure to the bearings, the camshafts and the chain.' },
    ],
  },
  {
    id: 'driveline',
    name: 'Transmission and driveline',
    short: 'Driveline',
    view: 'sys-driveline',
    function: 'Takes the engine’s torque, multiplies it with the right gear, and carries it to the rear wheels while letting them turn at different speeds in corners.',
    location: 'From behind the engine, along the tunnel under the cabin, to the rear axle.',
    inputs: ['Engine torque at the flexplate', 'Gear choice (selector and control unit)'],
    outputs: ['Torque at each rear wheel'],
    changes: 'Eight forward ratios from 4.71:1 to 0.67:1, then a 3.15:1 final drive: in first gear the wheels get about fifteen times the engine’s torque at a fifteenth of its speed.',
    compare: 'Front-wheel-drive cars combine gearbox and differential in one transaxle; all-wheel drive adds a transfer case or coupling and a second differential.',
    assemblies: [
      { id: 'torque-converter', name: 'Torque converter', parent: 'driveline', depth: 1, function: 'A fluid coupling between engine and gearbox: it lets the engine idle with the car stopped and multiplies torque when pulling away.', shot: 'converter', animation: 'torque-path' },
      { id: 'gearbox', name: 'Automatic gearbox', parent: 'driveline', depth: 2, function: 'Four planetary gearsets and five clutches and brakes give eight forward gears and reverse; the control unit chooses and changes them.', shot: 'gearbox' },
      { id: 'shafts', name: 'Driveshaft and half shafts', parent: 'driveline', depth: 1, function: 'Carry the turning output from the gearbox to the differential, and from the differential to each rear wheel.' },
      { id: 'differential', name: 'Differential', parent: 'driveline', depth: 1, function: 'Turns the drive through a right angle, reduces its speed, and splits it between the rear wheels so they can turn at different speeds in a corner.', shot: 'differential', animation: 'torque-path' },
    ],
  },
  {
    id: 'chassis',
    name: 'Suspension, steering and wheels',
    short: 'Chassis',
    view: 'sys-chassis',
    function: 'Holds each wheel in its place, lets it move over bumps, steers the front wheels and keeps the tyres pressed onto the road.',
    location: 'At each corner, between the body and the wheels; the steering from the wheel in the cabin to the rack ahead of the front axle.',
    inputs: ['Road bumps and tyre forces', 'Steering wheel turns', 'Body weight'],
    outputs: ['Controlled wheel movement', 'Steered front wheels', 'Grip at four contact patches'],
    changes: 'Each wheel can rise and fall about 80 mm; springs store the energy of a bump, dampers turn it into heat.',
    assemblies: [
      { id: 'front-suspension', name: 'Front suspension', parent: 'chassis', depth: 2, function: 'Double wishbones locate each front wheel and let it steer and move up and down.' },
      { id: 'rear-suspension', name: 'Rear suspension', parent: 'chassis', depth: 2, function: 'A multilink layout locates each rear wheel with five links so it stays upright under drive and braking.' },
      { id: 'springs-dampers', name: 'Springs and dampers', parent: 'chassis', depth: 1, function: 'Springs carry the car’s weight and absorb bumps; dampers stop it bouncing; anti-roll bars limit lean in corners.' },
      { id: 'steering', name: 'Steering', parent: 'chassis', depth: 1, function: 'The steering wheel turns a pinion that moves a rack sideways; tie rods push the front wheels to steer. An electric motor adds assistance.' },
      { id: 'wheels-tyres', name: 'Wheels and tyres', parent: 'chassis', depth: 1, function: 'The only parts of the car that touch the road: four contact patches, each about the size of a hand, carry every force.', shot: 'rear-contact' },
    ],
  },
  {
    id: 'brakes',
    name: 'Brakes',
    short: 'Brakes',
    view: 'sys-brakes',
    function: 'Turns the car’s motion into heat. The pedal pushes fluid to each wheel, where pads squeeze a spinning disc; ABS stops a wheel locking.',
    location: 'Pedal and booster at the driver’s side of the bulkhead; a disc and caliper inside each wheel.',
    inputs: ['Pedal force', 'Engine vacuum or electric assistance', 'Wheel speed signals'],
    outputs: ['Braking torque at each wheel', 'Heat in the discs'],
    changes: 'Line pressure rises to over 100 bar in an emergency stop; discs can pass 400 °C after repeated hard stops.',
    assemblies: [
      { id: 'brake-hydraulics', name: 'Brake hydraulics and ABS', parent: 'brakes', depth: 1, function: 'The booster multiplies the driver’s push, the master cylinder turns it into pressure, and the ABS unit can hold or release each wheel’s pressure many times a second.' },
      { id: 'wheel-brakes', name: 'Wheel brakes', parent: 'brakes', depth: 1, function: 'At each wheel a caliper squeezes pads against a disc that turns with the wheel.' },
    ],
  },
  {
    id: 'electrical',
    name: 'Electrical and control',
    short: 'Electrical',
    view: 'sys-electrical',
    function: 'Stores and generates electrical energy, starts the engine, and connects the control units that run every system through sensors and a data network.',
    location: 'Battery in the engine bay; control units throughout the car; the harness everywhere.',
    inputs: ['Crankshaft rotation (alternator)', 'Sensor signals', 'Driver commands'],
    outputs: ['12 V power', 'Commands to injectors, coils, throttle, gearbox and brakes'],
    changes: 'System voltage sits near 12.6 V at rest, dips to about 10 V while cranking, and is held near 14.2 V once the alternator is charging.',
    assemblies: [
      { id: 'power-supply', name: 'Starting and charging', parent: 'electrical', depth: 1, function: 'The battery starts the engine; once it runs, the belt-driven alternator powers the car and recharges the battery.', animation: 'start' },
      { id: 'engine-management', name: 'Engine management', parent: 'electrical', depth: 2, function: 'The engine control unit reads the crankshaft, camshaft, knock and other sensors and times every injection and spark.' },
      { id: 'network', name: 'Control units and network', parent: 'electrical', depth: 2, function: 'The control units share information over a data bus (CAN), so for example the gearbox knows the engine’s torque and the brakes know each wheel’s speed.' },
      { id: 'body-electrics', name: 'Body electrics', parent: 'electrical', depth: 1, function: 'Fuses, relays and the accessories they power, such as the wipers.' },
    ],
  },
  {
    id: 'body',
    name: 'Body and structure',
    short: 'Body',
    view: 'sys-body',
    function: 'The steel unibody carries every load and protects the occupants; the outer panels shape the air and keep the weather out.',
    location: 'The whole car: rails, pillars, sills and floor underneath, panels outside.',
    inputs: ['Loads from the suspension and powertrain', 'Crash forces'],
    outputs: ['A stiff platform for the suspension', 'A protected cabin'],
    changes: 'In a frontal crash the crumple zones fold in a controlled way, absorbing energy so the cabin keeps its shape.',
    assemblies: [
      { id: 'body-panels', name: 'Body panels', parent: 'body', depth: 1, function: 'The hood, doors, fenders, bumpers and trunk lid: the skin, its openings and its paint.' },
      { id: 'structure', name: 'Unibody structure', parent: 'body', depth: 2, function: 'Welded steel rails, pillars, sills and cross members in several strengths: softer where it should crush, strongest around the cabin.', shot: 'sys-body' },
    ],
  },
  {
    id: 'cabin',
    name: 'Cabin and climate',
    short: 'Cabin',
    view: 'sys-cabin',
    function: 'Seats the occupants, gives the driver the controls and displays, and keeps the air clean and comfortable.',
    location: 'Between the bulkhead and the rear seat.',
    inputs: ['Driver commands', 'Outside air', 'Engine heat', 'Refrigerant from the compressor'],
    outputs: ['Commands to the car', 'Heated or cooled, filtered air'],
    changes: 'The blend door mixes heated and cooled air to hold the temperature the occupants choose.',
    assemblies: [
      { id: 'interior', name: 'Interior', parent: 'cabin', depth: 1, function: 'Seats, dashboard, console, floor and door trims.' },
      { id: 'driver-controls', name: 'Driver controls and displays', parent: 'cabin', depth: 1, function: 'The start button, steering wheel, pedals and selector the driver uses, and the screens that answer.', shot: 'start-button' },
      { id: 'climate', name: 'Climate control', parent: 'cabin', depth: 2, function: 'Air is filtered, cooled and dried by the evaporator, reheated by the heater core as needed, and blown to the vents.' },
    ],
  },
  {
    id: 'safety',
    name: 'Safety systems',
    short: 'Safety',
    view: 'sys-safety',
    function: 'In a crash, holds the occupants in place and cushions them while the structure absorbs the energy.',
    location: 'Belts at each seat, airbags in the wheel hub, dashboard, seats and roof rails, the control module under the console.',
    inputs: ['Crash sensor signals'],
    outputs: ['Belt tensioning', 'Airbag deployment'],
    changes: 'Within about 30 thousandths of a second of a severe impact the pretensioners pull the belts tight and the airbags inflate.',
    assemblies: [
      { id: 'restraints', name: 'Restraints', parent: 'safety', depth: 1, function: 'Seat belts with pretensioners, airbags and head restraints.' },
      { id: 'crash-sensing', name: 'Crash sensing', parent: 'safety', depth: 2, function: 'Acceleration sensors at the front and sides tell the airbag control module how hard and where the car is hit.' },
    ],
  },
];

const fill = (e: Entry, kind: Component['kind'], system: SystemId): Component => ({
  aliases: [],
  neighbours: [],
  inputs: [],
  outputs: [],
  failures: [],
  changes: '',
  material: '',
  location: '',
  ...e,
  kind,
  system,
});

function build(): Component[] {
  const out: Component[] = [];
  for (const s of SYSTEMS_DEF) {
    out.push(
      fill(
        { id: s.id, name: s.name, function: s.function, location: s.location, inputs: s.inputs, outputs: s.outputs, changes: s.changes, compare: s.compare, depth: 1, shot: s.view, parent: undefined },
        'system',
        s.id,
      ),
    );
    for (const a of s.assemblies) out.push(fill(a, 'assembly', s.id));
  }
  const sysOf = new Map(out.map((c) => [c.id, c.system]));
  for (const p of PARTS_A) {
    const sys = sysOf.get(p.parent ?? '');
    if (!sys) throw new Error(`registry: ${p.id} has an unknown parent ${p.parent}`);
    out.push(fill(p, 'part', sys));
  }
  return out;
}

export const COMPONENTS: Component[] = build();
export const BY_ID = new Map(COMPONENTS.map((c) => [c.id, c]));
export const SYSTEMS = COMPONENTS.filter((c) => c.kind === 'system');
export const SYSTEM_SHORT: Record<SystemId, string> = Object.fromEntries(SYSTEMS_DEF.map((s) => [s.id, s.short])) as Record<SystemId, string>;

export function childrenOf(id: string): Component[] {
  return COMPONENTS.filter((c) => c.parent === id);
}

/** The path from the system down to an entry (for Back and the breadcrumb). */
export function pathTo(id: string): Component[] {
  const out: Component[] = [];
  let c = BY_ID.get(id);
  while (c) {
    out.unshift(c);
    c = c.parent ? BY_ID.get(c.parent) : undefined;
  }
  return out;
}

/**
 * The scene part names that draw an entry: its own `nodes`, else the parts whose component is its
 * id, else (systems and assemblies) its children's.
 */
export function nodesOf(id: string, byComponent: (component: string) => string[]): string[] {
  const c = BY_ID.get(id);
  if (!c) return [];
  if (c.nodes) return c.nodes;
  const own = byComponent(c.id);
  if (own.length && c.kind === 'part') return own;
  return [...new Set(childrenOf(id).flatMap((k) => nodesOf(k.id, byComponent)))];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Search names and aliases (then functions): best matches first. */
export function search(query: string, limit = 12): Component[] {
  const q = norm(query);
  if (!q) return [];
  const words = q.split(' ');
  const scored: [number, Component][] = [];
  for (const c of COMPONENTS) {
    const names = [c.name, ...c.aliases].map(norm);
    let score = 0;
    for (const n of names) {
      if (n === q) score = Math.max(score, 100);
      else if (n.startsWith(q)) score = Math.max(score, 80);
      else if (n.split(' ').some((w) => w.startsWith(q))) score = Math.max(score, 60);
      else if (words.every((w) => n.includes(w))) score = Math.max(score, 45);
    }
    if (!score && words.every((w) => norm(c.function).includes(w))) score = 20;
    if (score) scored.push([score - c.depth - (c.kind === 'part' ? 0 : 1), c]);
  }
  return scored
    .sort((a, b) => b[0] - a[0])
    .slice(0, limit)
    .map(([, c]) => c);
}
