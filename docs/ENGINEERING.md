# S-1: engineering assumptions and checks

The S-1 is an **original, generic petrol sedan designed for this simulation**. It is not a
real manufacturer's vehicle, and the model is **not a validated, full-fidelity digital twin**.
It is a teaching model. It is deterministic and internally consistent, and the picture,
instruments, labs and captions all come from the same numbers. Its main quantities are checked
against simple independent calculations, listed below.

Every constant in `src/spec/vehicle.ts` is marked as one of four kinds:

| kind | meaning | example |
|---|---|---|
| **design** | a value chosen for the S-1 | 2.85 m wheelbase, 3.15 final drive, 1-3-4-2 firing order |
| **typical** | a common value for this class of car, from general engineering practice | tyre μ 1.05 dry, 0.55 wet; pad μ 0.42; rolling resistance 0.011 |
| **derived** | calculated from other values in the model | gear ratios from tooth counts, static axle loads, displacement 2.488 L |
| **visual** | an approximation made for the picture only | gearset spacing in the cutaway, a link's drawn cross-section |

## How the model runs

* One `Car` (`src/sim/car.ts`) steps the whole vehicle in fixed **1 ms** steps of simulated
  time. Rendering interpolates between steps, so frame rate never changes a result.
* A run is described completely by a `RunSpec` (`src/sim/run.ts`): start state, driver, road,
  faults, parameters, length or end condition and time scale. Nothing is inherited from an
  earlier run. A snapshot (`save`/`load`) holds the whole state, including controller memory
  (ABS phase, shift progress, ripple shape, thermostat), so a restored run continues
  identically (tested).
* Time scales are shown honestly. The pace chip shows the **actual** rate of model time to
  film time, including the film's narration stretch. Thermal cases that run faster than real
  time say so ("Sped up ×3").

## Engine

* **Kinematics.** Bore 89 mm and stroke 100 mm, giving 2.488 L (derived). The connecting rod is
  155 mm, a typical 1.55 rod ratio. Exact slider-crank kinematics.
* **720° cycle, firing order 1-3-4-2** (design). Pistons 1 and 4 and pistons 2 and 3 move in
  pairs, on crank throws at 0° and 180°. The camshafts turn at half crank speed.
* **Valve and combustion events.** Intake and exhaust valve timing are typical DOHC values in
  `VALVES`. Injection happens during the intake stroke. Spark advance depends on load and
  speed. Burn is a Wiebe function (55° duration).
* **Torque.**
  * The full-load brake torque curve is a design curve: 255 N·m at 4,400 rpm and 152 kW at
    6,400 rpm.
  * Indicated torque is that curve plus friction (warm or cold oil), scaled by manifold
    pressure.
  * Wide open, the manifold reaches its full-load pressure at every speed, because the curve
    already contains the engine's breathing. Part throttle draws the manifold down with a
    throttle-area model.
* **Instantaneous and mean torque.**
  * Below 2,500 rpm the crank feels each firing pulse, shaped from cylinder pressure × piston
    area × the crank's lever arm. That pulse drives crank speed ripple and the visible motion.
  * The instruments and the torque lab read the **cycle-mean (brake) torque**, as a dynamometer
    does.
* **Start and idle.** The starter torque falls toward the battery's cranking speed. The ECU
  fuels only after the crank and cam sensors are synchronised. An idle controller holds about
  750 rpm.

**Checks.**

| quantity | model | independent calculation |
|---|---|---|
| Torque lab, wide open | 255.0 N·m at 4,400 rpm; 152.2 kW at 6,405 rpm | design curve 255 N·m / 152 kW; P = T·ω holds to 0.1 % at every sample (tested) |
| Power strokes per second | 25 at 750 rpm; 200 at 6,000 rpm | 4 cylinders × rpm / 120 |
| Displacement | 2.488 L | π/4 · 0.089² · 0.100 · 4 |
| Starter current while cranking (film) | 162–174 A (198 A at engagement) | caption says "about 170 amps"; typical 2.5 L starters draw 150–250 A |

## Torque converter

* Impeller torque comes from a capacity factor: K = 145 rpm/√(N·m), which puts the stall speed
  near 2,300 rpm at full torque.
* Torque ratio is 1.9 at stall, falling to 1.0 at the 0.86 coupling point. Below that point the
  stator is held by its one-way clutch; above it, it freewheels.
* The lock-up clutch engages above 38 km/h in 3rd gear and up. Its capacity limits how fast it
  can close the slip.

## Eight-speed planetary gearbox

* **Topology** (design, of the 8HP type):
  * four simple planetary gearsets and five shift elements;
  * brakes A and B, clutches C, D and E;
  * each gear applies three elements.
* **Shift table.**

  | gear | applied elements |
  |---|---|
  | 1 | A B C |
  | 2 | A B E |
  | 3 | B C E |
  | 4 | B D E |
  | 5 | B C D |
  | 6 | C D E |
  | 7 | A C D |
  | 8 | A D E |
  | R | A B D |

  Each upshift releases one element and applies another.
* **Ratios are derived, not typed in.** They come from the tooth counts:
  * set 1: 40/80/20, 4 planets;
  * set 2: 40/80/20, 4 planets;
  * set 3: 62/100/19, 3 planets;
  * set 4: 24/88/32, 4 planets.

  The Willis equation for each set, plus the element constraints, gives:
  * forward: 4.667, 3.111, 2.100, 1.667, 1.284, 1.000, 0.839, 0.667;
  * reverse: −3.276.

  The geartrain solver (`src/sim/geartrain.ts`) gives every shaft's and planet's speed in every
  gear.
* **Shifts.** During a shift the two shared elements hold. The applying element's slip falls to
  zero over the shift time (0.35 s), and the solver uses that slip. The drawn gears turn at
  exactly the solved speeds, so no member turns against its constraint (tested).
* **Visual approximation.** In the cutaway, the gearsets' axial positions and diameters are
  arranged for legibility. The tooth counts drawn are the model's, with mesh phases that keep
  the teeth from passing through each other.

**Checks.** At 6,800 rpm, the speed in each gear is v = ω·r / (i·i<sub>fd</sub>), using the
0.318 m rolling radius:

| gear | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| km/h | 55 | 83 | 123 | 155 | 202 | 259 | 308 | 388 |

Above about 4th gear, aerodynamic drag limits the top speed, not the gearing. The gearing lab's
default run reaches 100 km/h in 7.55 s.

## Driveline and differential

* The driveshaft and pinion turn at gearbox output speed. The ring gear and the carrier turn at
  output speed ÷ 3.15.
* The differential is open:
  * the carrier speed is the mean of the two rear wheel speeds;
  * the side gears get equal torque;
  * the spider gears turn on their pin only when the wheel speeds differ.
* **Check.** On the 12 m corner, (R + t/2)/(R − t/2) = (12 + 0.8)/(12 − 0.8) = 1.143. The model's
  rear wheel speeds in the film's corner step differ by the same 14 %.

## Tyres and road

* **Slip model.** Longitudinal and lateral force come from a simplified "magic formula". Force
  peaks near 12 % slip and falls toward sliding. A friction ellipse shares the grip between
  braking or driving and cornering.
* **One grip value per surface everywhere.** Labs, lessons, scenarios and the workbench all use
  the same values: dry 1.05, wet 0.55, packed snow 0.25 (typical).
* **Near standstill.** A slip model has no meaning at walking pace, so it blends into a no-slip
  rolling constraint below about 1.5 m/s. The wheel step there is semi-implicit, using the
  tyre's stiffness, so the car creeps and stops without limit cycles.

## Brakes and ABS

* **The chain from pedal to stop.** The model follows each stage in turn:
  1. pedal force;
  2. the booster's ×3.2 assist, up to its 7.2 kN run-out;
  3. master cylinder pressure;
  4. caliper clamp force;
  5. brake torque at the effective radius, with pad μ falling as the rotor heats;
  6. wheel slip;
  7. tyre force;
  8. deceleration;
  9. rotor heat (rotor heat capacity × temperature rise).
* **ABS** runs per wheel. Pressure is released above 18 % slip and re-applied below 8 %, at the
  modulator's dump and apply rates. ABS works above 6 km/h.
* **Its purpose** is to keep the tyre near its peak and still able to steer. The captions make
  no claim that ABS always shortens a stop on every surface. On loose snow or gravel a locked
  wheel can stop shorter in reality. This model's surfaces are firm, and on them ABS shortens
  the stop.

**Checks.**
* The braking lab, from the moment braking starts, against the ideal v²/(2μg).
* The lab's distance includes the pedal's and the booster's rise time.
* Mean deceleration can slightly exceed μg (snow, 100 km/h, 0.27 g at μ = 0.25), because
  aerodynamic drag and rolling resistance also slow the car.

| speed, surface | ABS on | ABS off | ideal v²/(2μg) |
|---|---|---|---|
| 50 km/h dry | 10.6 m | 14.1 m | 9.4 m |
| 100 km/h dry | 39.1 m | 53.9 m | 37.5 m |
| 50 km/h wet | 18.7 m | 25.9 m | 17.9 m |
| 100 km/h wet | 70.9 m | 99.5 m | 71.5 m |
| 100 km/h snow | 147.7 m | 203.8 m | 157.3 m |

Film claim: from 80 km/h wet, "about 65 m" locked and "about 46 m" with ABS. The model gives
64.6 m and 46.2 m.

## Mass, centre of gravity and load transfer

* Mass is 1,560 kg (curb plus a 75 kg driver). The front share is 52 % and the centre of gravity
  is 0.52 m high (design).
* **Static loads are derived from the configured mass.** The four tyre loads always sum to m·g:
  15,303.6 N for the default car. The yaw, pitch and roll inertias scale with mass at fixed
  radii of gyration, so the weight lab's extremes remain physical. Every setting gives finite,
  bounded results (tested over a grid).
* **Check.** Braking at about 1 g, the steady front-axle load gain should be
  m·a·h/L = 1,560 · 9.81 · 0.52 / 2.85 ≈ 2.8 kN. The weight lab's steady value rises from
  7.96 kN to about 10.9 kN, a gain of 2.9 kN. The brief peak as the body pitches onto its front
  springs reaches 12.0 kN. The lab reports this peak separately.

## Suspension and steering (simplified kinematics)

* **The model.** Each corner's travel is a spring–damper on the sprung mass, with anti-roll bars,
  using the wheel rates and damping in `SUSPENSION`. Pitch and roll come from load transfer.
  The wheel centre moves **straight up and down** in the model.
* **The drawing.** It keeps every link at its built length.
  * **Front double wishbones.** Each arm turns about the axis through its two inner pivots.
  * **Front steering axis.** Each front knuckle, with its disc, caliper and wheel, turns about
    the line through its lower and upper ball joints. That axis is inclined inward and back, as
    on the car, so the ball joints stay where the arms hold them.
  * **The rack.** The drawn rack sits where the two rigid tie rods need it.
  * **Front Ackermann.** The steering arms point ahead and outboard of the steering axis, so the
    linkage turns the inner wheel more. The model's inner and outer angles follow ideal
    Ackermann geometry, and the wheels are drawn at those angles.
  * **Rear multilink.** The upper arm, toe link and trailing link are rigid. Each rear knuckle
    moves a few millimetres fore-and-aft and sideways as it travels: the arcs its links allow,
    found by a small least-squares fit each frame.
  * **What remains**, tested in `rig.test.ts`:
    * About 1 cm at full lock with the wheel in bump. This is the difference between ideal
      Ackermann and a real four-bar linkage. It is taken up along the tie rod, inside the rack's
      rubber boot.
    * About 3 mm at the rear joints at full travel.
  * **Exceptions.** Springs compress and half shafts lengthen in their plunging joints. No rigid
    link is ever drawn stretched.
* **Steering ratio.** 14.5:1 overall, 2.6 turns lock to lock. On the workbench, the steering
  wheel's lock narrows with speed.

## Cooling, lubrication and electrics

* **Cooling.**
  * The thermostat opens from 88 °C and is fully open at 100 °C.
  * The fans switch on at 102 °C and off at 97 °C (hysteresis).
  * Radiator conductance rises with ram air and with the fans.
  * The heater core is a bypass path.
  * The thermal cases run sped up (×3 or ×10) and are labelled so.
  * After the overheat repair, the temperature falls over the following minute. The fault is
    cleared at once, but the coolant has to reach the radiator first.
* **Oil pressure** rises with engine speed (1.6 bar hot idle, 4.6 bar at 4,000 rpm) and falls
  as the oil thins with temperature. The relief valve opens at 5 bar.
* **Electrics.**
  * Battery: 70 A·h, open-circuit voltage from state of charge, internal resistance.
  * Starter: draws current against the battery's resistance; the voltage dips.
  * Alternator: its capacity rises with its own speed, giving about 75 A at idle and 150 A at
    full speed.
  * Regulation: the alternator holds 14.2 V only while it can supply the load **and** the
    battery's charging current. Beyond that, the battery makes up the difference and the
    voltage falls. This is why the charging lesson's extra load is the headlights and blower
    (20 A), which the alternator can carry at idle (tested).
  * The weak-battery repair recharges the battery to 95 %. The fault is not simply cleared.

## Illustrative only

* **Flows.** The refrigerant and cabin-air flows show where the air and refrigerant go. The
  climate system is not simulated, and the visual key and the cabin panel say so. All other
  flows move with the model: air, fuel, exhaust, oil, coolant, hydraulic pressure, electric
  power, signals and torque.
* **CAN messages.** The CAN network's message pulses are schematic.
* **Explode distances** are chosen for legibility. The order is meaningful: covers and bolted
  parts come off before what they retain.

## Where these numbers are tested

* `src/sim/sim.test.ts` and `src/sim/v2.test.ts`: model behaviour, snapshots, isolation, loads,
  the geartrain, the selector, and the engine lab against the stated curve.
* `src/content/labs.test.ts`: lab trends and finite results.
* `src/content/film.test.ts`:
  * the narration script matches the captions;
  * the upshift happens during its step, in the lesson and the film;
  * the charging steps hold the voltage.
* `src/scene/car/rig.test.ts`: immutable baselines, no drift, rigid links.
