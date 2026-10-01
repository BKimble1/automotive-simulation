/**
 * The driving workbench's driver: turns what the visitor does (keys, pedal and steering pads)
 * into the car's inputs, with the ramps and limits a real car's controls have. It writes only
 * the model's inputs, once per frame before the model steps, so the same shared model drives
 * the picture, the instruments and the mechanisms; a script never runs at the same time (the
 * workbench's run has no driver script).
 *
 *   keys            W / ↑ accelerate, S / ↓ brake, A D / ← → steer, Space brakes hard,
 *                   P R N D select, Enter starts or stops the engine
 *   pads            a pedal pad sets its pedal by where it is pressed (bottom 0, top full);
 *                   the steering pad by how far from its centre; each follows its own pointer,
 *                   so steering and a pedal can be held together on a touch screen
 *   ramps           the throttle and the brake rise and fall at a pedal's pace; the steering
 *                   wheel turns at a rate that falls with speed, within a lock that narrows with
 *                   speed, and returns to centre when let go
 *   start           Start asks for P or N; the ECU then cranks until the engine runs (at most
 *                   four seconds); Stop needs the car (nearly) stopped
 *   selector        leaving Park needs the brake; Park and the other direction are refused at
 *                   speed (the model says why: sim/car.ts selectorRefusal)
 *
 * Anything held is released when the window loses focus, the page is hidden or a pointer is
 * cancelled, so the car can never keep accelerating on a stuck key.
 */
import { selectorRefusal, type Car, type Selector } from '../sim/car';
import { STEERING, units } from '../spec/vehicle';

export interface DriverState {
  message: string;
  starting: boolean;
}

/** Full brake pedal force from the workbench, N (an emergency stop). */
const BRAKE_FULL = 520;

export class Driver {
  /** Held keys. */
  keys = { up: false, down: false, left: false, right: false, hard: false };
  /** Pointer-driven demands (null when not held): throttle and brake 0 … 1, steering −1 … 1 (left +). */
  pads: { throttle: number | null; brake: number | null; steer: number | null } = { throttle: null, brake: null, steer: null };
  /** What the controls apply now (after the ramps). */
  throttle = 0;
  brake = 0;
  /** Steering-wheel angle applied, rad (positive left). */
  steer = 0;
  private crankLeft = 0;
  message = '';
  private messageT = 0;
  onChange?: () => void;

  constructor(private car: Car) {}

  /** The steering wheel's limit at a speed: full lock when slow, narrowing to about a quarter turn at 130 km/h. */
  static steerLimit(kmh: number): number {
    const full = STEERING.maxWheelAngle * STEERING.ratio;
    const k = Math.min(1, Math.max(0, (Math.abs(kmh) - 20) / 110));
    return full + (1.6 - full) * k;
  }

  private say(m: string) {
    this.message = m;
    this.messageT = m ? 3.5 : 0;
    this.onChange?.();
  }

  /** Start or stop the engine (the button, or Enter). */
  pressStart() {
    const s = this.car.s;
    const inp = this.car.inputs;
    if (s.engine === 'running' || s.engine === 'cranking') {
      if (Math.abs(units.msToKmh(s.u)) > 5) return this.say('Stop the car before switching the engine off.');
      inp.ignition = false;
      inp.start = false;
      this.crankLeft = 0;
      return this.say('Engine off.');
    }
    if (s.selector !== 'P' && s.selector !== 'N') return this.say('Select P or N to start the engine.');
    inp.ignition = true;
    this.crankLeft = 4;
    this.say('Starting…');
  }

  /** Ask for a selector position; says why if the gearbox refuses it. */
  select(want: Selector) {
    const s = this.car.s;
    if (want === s.selector) return;
    if (s.selector === 'P' && want !== 'P' && this.brake < 0.15 && (this.pads.brake ?? 0) < 0.15 && !this.keys.down && !this.keys.hard) return this.say('Press the brake to shift out of Park.');
    const why = selectorRefusal(s, want);
    if (why) return this.say(why);
    this.car.inputs.selector = want;
    this.say('');
  }

  /** Let go of everything (focus lost, page hidden, a pointer cancelled): the pedals and the
   * wheel then return at their own pace. */
  releaseAll() {
    this.keys = { up: false, down: false, left: false, right: false, hard: false };
    this.pads = { throttle: null, brake: null, steer: null };
  }

  /** A new run: nothing held, pedals up, wheel straight, no start in progress. */
  reset() {
    this.releaseAll();
    this.throttle = 0;
    this.brake = 0;
    this.steer = 0;
    this.crankLeft = 0;
    this.say('');
  }

  /** Each frame before the model steps: ramps toward the demands, then the inputs. */
  update(dt: number) {
    if (dt <= 0) return;
    const s = this.car.s;
    const inp = this.car.inputs;
    const kmh = units.msToKmh(s.u);
    // pedals: a pad sets the target directly; keys ramp it up while held
    const tThrottle = this.pads.throttle ?? (this.keys.up ? 1 : 0);
    const tBrake = Math.max(this.pads.brake ?? 0, this.keys.hard ? 1 : this.keys.down ? 0.55 : 0);
    const ramp = (v: number, t: number, up: number, down: number) => (t > v ? Math.min(t, v + up * dt) : Math.max(t, v - down * dt));
    this.throttle = ramp(this.throttle, tThrottle, this.pads.throttle !== null ? 6 : 1.6, 4);
    this.brake = ramp(this.brake, tBrake, this.pads.brake !== null ? 8 : 3, 6);
    // steering: toward the demand at a speed-dependent rate, within the speed-dependent lock
    const lim = Driver.steerLimit(kmh);
    const demand = this.pads.steer !== null ? this.pads.steer : (this.keys.left ? 1 : 0) - (this.keys.right ? 1 : 0);
    const target = demand * lim;
    const rate = (this.pads.steer !== null || demand !== 0 ? 7 : 5) * (1 - 0.55 * Math.min(1, Math.abs(kmh) / 120));
    this.steer = ramp(this.steer, target, rate, rate);
    this.steer = Math.max(-lim, Math.min(lim, this.steer));
    inp.throttle = s.engine === 'running' ? this.throttle : 0;
    inp.brakeN = this.brake * BRAKE_FULL;
    inp.steer = this.steer;
    // the start: crank until the engine runs, at most a few seconds
    if (this.crankLeft > 0) {
      if (s.engine === 'running') {
        this.crankLeft = 0;
        inp.start = false;
        this.say('');
      } else if (inp.selector !== 'P' && inp.selector !== 'N') {
        this.crankLeft = 0;
        inp.start = false;
      } else {
        inp.start = true;
        this.crankLeft -= dt;
        if (this.crankLeft <= 0) {
          inp.start = false;
          this.say('The engine did not start. Try again.');
        }
      }
    } else inp.start = false;
    if (this.messageT > 0) {
      this.messageT -= dt;
      if (this.messageT <= 0) this.say('');
    }
  }

  get starting(): boolean {
    return this.crankLeft > 0;
  }
}
