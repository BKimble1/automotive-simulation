# AUTOMOTIVE / ONE

*A FAB / ONE simulation by Kimble.* One coherent, generic modern petrol car — the **S-1**: a
four-door sedan with a longitudinal 2.5 L direct-injection inline-four at the front, an
eight-speed planetary automatic, a rear open differential, double-wishbone front and multilink
rear suspension, four-wheel discs with ABS — that the visitor can **watch**, **explore**,
**engineer** and **diagnose**. It is an original design: no maker's logos, body shapes or
dashboard graphics.

## Run it

```sh
npm ci
npm run dev          # http://127.0.0.1:5176
npm run build        # tsc -b && vite build → dist/
npm test             # 65 unit tests (vitest)
npm run e2e          # 44 browser tests: 11 tests × desktop, laptop, tablet, phone (Playwright, on the build)
```

Deep links: `?mode=watch[&t=seconds]`, `?mode=explore[&system=brakes][&part=brake-caliper][&lesson=braking]`,
`?mode=engineer[&lab=gearing]`, `?mode=simulate[&scenario=overheat]`. Test hooks: `?virt=1`
(a frame-stepped clock: every frame is exactly 1/30 s, advanced with `window.__fabAdvance(n,
render)`), `?quality=low|medium|high`, `?nowebgl=1`.

## What is in it

* **Watch** — *How a car becomes motion*, a 6.5-minute narrated film in eleven chapters
  (34 steps), with captions timed to the speech, chapters, and links into any moment.
  Narration is bundled audio (Kokoro-82M v1.0, voice bm_george, generated offline by
  `tools/narration`); the app never calls a voice service.
* **Explore** — the car as a hierarchy: 10 systems → 30 assemblies → about 150 components
  (`src/content/registry.ts`), each with what it does, where it is, inputs and outputs, what
  changes while it works, material, failure symptoms and other designs; search by any name;
  Back up the hierarchy; ten hero lessons ("Show how it works").
* **Engineer** — eight labs (gearing, torque and power, stopping distance, springs and
  dampers, weight transfer, cornering grip, torque converter, electrical balance): change a
  parameter, run the car's model, compare runs on a chart.
* **Simulate** — six everyday scenarios with live instruments, and six faults to diagnose
  (complaint, inspect, measure, conclude, reveal, repair): a misfire, a stuck thermostat, a
  failed alternator, low oil, a worn damper, a weak battery.

### The ten hero lessons

start → idle · the four-stroke cycle in cutaway · firing order · the torque path and a gear
change · the differential through a corner · suspension over a bump · braking with and
without ABS · cooling and lubrication under load · charging and the CAN network · taken apart
and put back together.

## How it works

* **One model drives everything.** `src/sim/car.ts` steps the whole car every millisecond of
  simulated time: engine cycle (valve events, cylinder pressure, combustion per cylinder),
  starter, converter, planetary gearbox and its five shift elements, differential, tyres,
  ride, brakes and ABS, cooling, lubrication, electrical system and faults. The mechanism
  (`src/world/mechanism.ts`) poses every moving part from that state, interpolated between
  steps; flows and readouts read the same state, so the picture, the gauges and the captions
  agree.
* **Immutable baselines.** Every part has a frozen local baseline; motion is applied as
  offsets (mechanism) and explode channels on top, reset every frame — nothing accumulates
  (tested: no drift after any sequence of poses and explodes).
* **One director.** `src/world/director.ts` is the only thing that starts a transition
  (states idle, preparing, transitioning, demonstrating, paused, returning, free-explore). A
  view is data: a camera shot plus channel targets (bodywork to glass, parts ghosted or
  faded, assemblies taken apart, section planes, flows, labels). The camera
  (`src/scene/camera/director.ts`) moves on velocity-continuous quintics from what is on
  screen, plans its path clear of the body's collision capsules and the floor, and frames the
  subject in the part of the screen the interface leaves free. Channels
  (`src/scene/channels.ts`) move in phases — overlays out, reveals, covers, overlays in — so
  solid bodywork never fills the picture halfway between two x-ray views, and any request can
  interrupt any move from its current value and speed.
* **Four clocks**: presentation (stops when paused), mechanical (the model; slow motion and
  fast-forward per step), camera, input. Sequences integrate each step's time scale in closed
  form, so seeking anywhere reproduces the car's state exactly (tested bit for bit).
* **Cutaways** clip the housings (block, head, cases, carrier) and draw their back faces as
  hatched section faces; the moving parts inside stay whole.
* **Visual language** (`src/scene/viz/language.ts`): colour from a colour-vision-safe palette
  *and* a distinct shape per kind (torque chevrons, air streaks, fuel droplets, exhaust puffs,
  oil and coolant dashes, hydraulic bands, power packets, signal pulses, heat as a tint).
* **Resilience**: progressive loading (a light body first, every material variant compiled
  before the director may go there, the detailed body after), quality tiers with hysteresis,
  reduced motion, WebGL context loss and restore, a plain message without WebGL 2.

## Layout

```
src/spec/      every dimension and constant of the S-1
src/sim/       the deterministic car model (unit-tested)
src/content/   registry, lessons, film, labs, scenarios, narration script and manifest
src/scene/     renderer, studio, materials, camera director, channels, labels, car geometry, flows
src/world/     the runtime: world, director, views, sequences, mechanism, looks, controller
src/ui/        React interface (reads the world through stores)
scripts/       bake-body.mjs (the body's surface), narration.sh
tools/         the offline narration pipeline (Kokoro)
e2e/           Playwright tests
docs/PLAN.md   design notes and the lessons taken from earlier FAB / ONE simulations
```

## Regenerating

* Body surface: `npm run bake` (writes `src/scene/car/baked/body-{hi,lo}.bin`).
* Narration: bump the version in `src/content/narration-manifest.json`, then
  `npm run narration` (needs `tools/narration/setup.sh` once).
