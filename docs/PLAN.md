# AUTOMOTIVE / ONE — implementation plan

*A FAB / ONE simulation.* One coherent car (the **S-1**: front engine, rear-wheel drive,
longitudinal 2.5 L inline-four with direct injection, 8-speed planetary automatic, open
differential, double-wishbone front and multi-link rear suspension, four-wheel discs with ABS)
that the visitor watches, explores, engineers and diagnoses. The vehicle is the interface.

## What the audit of the other FAB / ONE simulations taught

| failure seen before | where | how this project prevents it |
|---|---|---|
| camera interpolation restarted every frame (time in the blend key) | Rocket V1 R1 | shots have stable ids; `go()` with the shot being approached is a no-op; the render loop only *samples* the director |
| camera snaps / turns in one frame on interruption | Rocket R2, R8; Humanoid F | every move is a quintic from the *displayed* state and velocity (velocity carried, bounded) |
| stale target (orbiting the previous subject) | Rocket R3 | a shot's target is resolved through the registry each frame; a subject that is not ready blocks the move (state `preparing`), never aims at nothing |
| blank frames on scene hand-off | Rocket R9; Photolithography ROUND3/4 | one scene graph for the whole visit: no scene swaps, no remounts; assets are built and shaders compiled before the director may move to them |
| mechanical poses snapping (new pose from a baseline) | Humanoid A–C, Photolithography A | every animated part has an immutable local baseline; all motion is derived from shared mechanical state; staged channels move from their current value |
| pause stopping the clock but not the scene | Humanoid D | four clocks (below); pause stops presentation, mechanical and camera-move time together |
| behaviour depending on frame rate; clamped deltas racing | Rocket S2; Photolithography G | mechanical models run in fixed steps of simulated time; all damping uses elapsed time; virtual clock in seconds |
| shader compiles mid-move | Photolithography ROUND3 | `compileAsync` of every material (hidden objects forced visible) before `ready`; constant light count |
| no WebGL context-loss handling | Photolithography | `webglcontextlost` handled: clocks hold, notice shown, restored state rebuilt |

## Architecture

```
src/spec/        vehicle.ts — every dimension and constant, SI units, provenance tags
src/sim/         deterministic models (no rendering), unit-tested
                 engine (slider-crank, valve events, combustion, torque), converter, gearbox,
                 planetary, driveline + differential, tyre, longitudinal + lateral vehicle,
                 suspension (4 corners), brakes + ABS, cooling, lubrication, electrical, faults
                 car.ts composes them in fixed 1 ms steps of simulated time
src/content/     registry.ts (systems → assemblies → parts, schema below), film script,
                 labs, scenarios, narration.json
src/scene/       three.js: stage, studio, materials, time, camera director, channels,
                 car/ (procedural geometry: body bake + panels, engine, drivetrain, chassis,
                 wheels, brakes, cooling, electrical, cabin, safety), viz/ (flows, arrows, heat)
src/world/       the runtime: clocks, the animation director (state machine), views (shots
                 and channel targets), sequences (hero sequences, the film), rig (baselines)
src/ui/          React panels; they read the world only through stores (10 Hz readouts)
```

### Four clocks (src/world/clocks.ts)
- **presentation** — lesson and narration time; paused by the visitor; seekable.
- **mechanical** — simulated time of the car's models; advanced by presentation time × a
  time scale (slow motion for the four-stroke cycle) during guided sequences, by real time in
  free modes; fixed 1 ms steps, rendered with interpolation.
- **camera** — authored moves run on presentation time (they stop when paused); the visitor's
  own orbit and its inertia run on real time.
- **ambient** — the studio (light breathing, turntable): real time, never paused.

### The animation director (src/world/director.ts)
States: `idle`, `preparing`, `transitioning`, `demonstrating`, `paused`, `returning`,
`free-explore`. A request names a **view** (a shot id + channel targets + a demonstration);
- *entry*: the view's subject assemblies must be built and compiled (`preparing` until they
  are; the picture holds, the camera does not move);
- *transition*: camera move and staged channel moves start from what is displayed;
- *interruption*: a new request at any moment re-plans from the displayed camera, channel
  values and their velocities; asking for the view already being approached does nothing;
- *final state*: deterministic — the view's channel targets exactly, the shot's framing.

The render loop calls `world.frame(dt)`, which samples; it never starts a transition.

### Baselines
Every animated part registers once with its immutable local transform. Each frame its
transform is recomputed as baseline ∘ mechanism pose ∘ explode offset(channel). Nothing is
accumulated, so explode → reassemble any number of times returns exactly to the baseline
(tested).

### Sequences and seeking
A sequence is a list of beats: view, mechanical program (driver inputs as functions of beat
time, initial state), caption cues. Seeking re-simulates the beat from its declared initial
state in fixed steps, so the mechanical state at time *t* is identical however it was
reached (tested). The view moves there from what is displayed.

## Component registry schema (src/content/registry.ts)

```ts
interface Component {
  id: string;               // stable, kebab-case, unique (tested)
  name: string;             // display name
  aliases: string[];        // common and technical names (search)
  system: SystemId;         // one of the ten top-level systems
  parent?: string;          // assembly it belongs to
  neighbours: string[];     // ids it connects to or touches
  function: string;         // what it does (one or two sentences)
  location: string;         // where it is in the car
  inputs: string[];         // what goes in (energy, fluid, signal)
  outputs: string[];
  changes: string;          // what physically changes while it works
  material: string;         // common material or construction
  failures: string[];       // typical failure symptoms
  shot?: string;            // camera shot id; defaults to its assembly's
  animation?: string;       // demonstration id it takes part in
  compare?: string;         // optional note on other layouts
  depth: 1 | 2 | 3;         // 1 every learner, 2 interested, 3 engineering student
  nodes: string[];          // scene-graph part names that draw it (highlight, bounds)
}
```

## Visual language (src/scene/viz/language.ts)

| meaning | colour (CVD-checked) | form |
|---|---|---|
| torque and force | orange `#E69F00` | solid arrows, rotating chevrons on shafts |
| airflow | sky blue `#56B4E9` | fine fast streaks |
| fuel | yellow `#F0E442` | small droplets |
| exhaust | warm grey `#A7A39C` | soft, larger puffs |
| oil | amber-brown `#C9853A` | slow, thick, rounded dashes |
| coolant | bluish green `#2BB592` | medium dashes |
| hydraulic pressure | reddish purple `#CC79A7` | pressure fronts (bands travelling along the line) |
| electrical power | near-white `#EAF1FF` | square packets along the wires |
| control signals | violet `#8B7DFF` (brand accent) | thin dotted pulses with packet heads |
| heat | surface tint black-body ramp | slow shimmer on hot surfaces only |

## Order of work
1. vehicle, part hierarchy, clocks, director, camera director  
2. vertical slice: start button → crank → combustion → torque path → tyres moving the car  
3. inspect slice footage (desktop, phone); fix pacing, framing, continuity  
4. ten hero sequences  
5. Explore hierarchy and depth content  
6. Engineer labs, Simulate/Diagnose  
7. hub integration, previews, tests, package

## V2: what changed in the architecture

* **Runs are data.** A `RunSpec` (`src/sim/run.ts`) describes a run completely: start state,
  driver, road (`RoadSpec`), faults, parameters, length or end condition, time scale.
  `initRun` is the only way a run starts, so a lab, a scenario, a lesson chain and the workbench
  inherit nothing from what ran before. Snapshots hold every bit of state, including controller
  memory, and read-only sampling (`simulate`, `SequencePlayer.sample`) runs on its own `Car`.
* **Work off the page.** Lab charts and long seeks are computed in a module worker
  (`src/world/simWorker.ts`, through `jobs.ts`), in short slices. A newer request supersedes an
  older one, and the page computes in its place if the worker fails. Seeks start from
  checkpoints, one per simulated second of each chain (`seekCache.ts`). A step waits (held, its
  last picture kept) while its state is computed.
* **One pause owner.** The world owns the pause. The director, the sequence player, the
  narration and the model all read it, so a true pause freezes everything, including authored
  camera motion, and resumes from the same state. Context loss suspends the presentation, and
  nothing catches up afterwards.
* **Readiness.** A step whose subject is not yet built or compiled waits in `preparing`. Its
  clock holds and nothing of the destination happens early.
  * **Where programs are compiled.** Programs are compiled for the composer's linear target,
    which is where they are drawn.
  * **Hidden materials** (ghost and section variants, the wheels' spin blur) are compiled on
    stand-ins. A stand-in is instanced where the mesh is, as the timing chain and the flow
    particles are.
  * **First use.** Each program's first use, when three.js reads its link result and its
    uniforms, is taken during preparation. Where the browser links in parallel this costs
    nothing. Where it does not (Firefox, software rendering, some phones), that read waits for
    the driver, so it is taken at a still moment, one program at a time.
  * **Tested.** No program is compiled or first used during any move, at medium quality,
    across every system, view and several parts. Taking a program's first use at its first draw
    used to stall the opening frame of a move by 3–8 s on SwiftShader.
* **The geartrain** (`src/sim/geartrain.ts`) solves every shaft and planet from the gearsets'
  tooth counts and the applied elements, during shifts too. The cutaway turns its members at
  exactly those speeds.
* **The workbench** (`src/world/driver.ts`, `src/ui/simulate/Workbench.tsx`) writes only the
  model's inputs, once per frame, with pedal and steering ramps and speed-dependent limits. A
  manual run has no driver script.
* **Rigid linkages.** Front knuckles steer about their ball-joint axis, the rack is drawn where
  both rigid tie rods need it, and rear knuckles follow the arcs their links allow
  (`src/world/mechanism.ts`; see docs/ENGINEERING.md).
* **The interface.**
  * A phone sheet that collapses and resizes (`src/ui/Sheet.tsx`).
  * Progressive disclosure and tap-to-select in Explore, plus view choices (explained,
    exterior, opened, cutaway, exploded).
  * A Recentre button whenever the visitor has moved the camera.
  * 44 px targets.
  * Reduced motion across camera, reveals and interface.
  * A boundary that contains a failing panel.
