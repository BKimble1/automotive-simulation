/**
 * The supporting systems: hydraulic brakes and ABS, cooling, lubrication and the 12 V
 * electrical system. Each is a small state machine or lumped model stepped in fixed time
 * steps by the car (car.ts); all constants come from spec/vehicle.ts.
 */
import { ABS, BRAKES, COOLING, ELECTRICAL, OIL } from '../spec/vehicle';

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ─────────────────────────── brakes ───────────────────────────

/** Master cylinder pressure, Pa, from pedal force, N (pedal lever × booster ÷ piston area). */
export function masterPressure(pedalN: number): number {
  const area = (Math.PI / 4) * BRAKES.masterBore * BRAKES.masterBore;
  const input = Math.max(0, pedalN) * BRAKES.pedalRatio;
  // the booster multiplies the driver's push until it runs out of assist; beyond that only the
  // driver's own extra force adds
  const assisted = input * BRAKES.boost;
  const out = assisted <= BRAKES.boostRunout ? assisted : BRAKES.boostRunout + (input - BRAKES.boostRunout / BRAKES.boost);
  return out / area;
}

/** Pad friction coefficient at a rotor temperature, °C (fades when hot). */
export function padMu(rotorC: number, fadeScale = 1): number {
  return BRAKES.padMu * (1 - 0.5 * fadeScale * sstep(BRAKES.fadeStartC, BRAKES.fadeFullC, rotorC));
}

/** Brake torque at one wheel, N·m, for a caliper pressure, Pa (two pads clamp the rotor). */
export function brakeTorque(front: boolean, pressurePa: number, mu: number): number {
  const area = front ? BRAKES.caliperAreaFront : BRAKES.caliperAreaRear;
  const r = front ? BRAKES.radiusFront : BRAKES.radiusRear;
  return 2 * mu * Math.max(0, pressurePa) * area * r;
}

/** Proportioning: the rear circuit gets less pressure so the front/rear torque share is BRAKES.biasFront. */
export function rearPressureFactor(biasFront: number = BRAKES.biasFront): number {
  // torque per unit pressure at each axle (two wheels)
  const tf = 2 * BRAKES.caliperAreaFront * BRAKES.radiusFront;
  const tr = 2 * BRAKES.caliperAreaRear * BRAKES.radiusRear;
  // biasFront = tf / (tf + tr·k)  →  k
  return Math.max(0, Math.min(1.5, (tf * (1 - biasFront)) / (biasFront * tr)));
}

export type AbsPhase = 'off' | 'apply' | 'hold' | 'release';

/**
 * One wheel's ABS channel: the modulator's inlet and outlet valves. While the wheel's slip is
 * small the line pressure passes through (apply); when it exceeds the release threshold and
 * the wheel is decelerating, the outlet valve dumps pressure (release); once the wheel speeds
 * up again the pressure is held, then re-applied in steps. The cycle repeats several times a
 * second until the car stops or the driver releases the pedal.
 */
export class AbsChannel {
  phase: AbsPhase = 'off';
  pressure = 0;
  /** Count of release events (cycles) since the stop began. */
  cycles = 0;
  private holdT = 0;
  step(dt: number, linePa: number, slip: number, wheelDecel: number, speedKmh: number, enabled: boolean) {
    const bar = 1e5;
    if (!enabled || speedKmh < ABS.minKmh || linePa <= 0.5 * bar) {
      // no ABS: the caliper follows the line pressure (with the fluid's small lag)
      this.phase = linePa > 0.5 * bar && enabled && speedKmh >= ABS.minKmh ? 'apply' : 'off';
      this.pressure += (linePa - this.pressure) * Math.min(1, dt * 60);
      if (linePa <= 0.5 * bar) this.cycles = 0;
      return;
    }
    switch (this.phase) {
      case 'off':
      case 'apply': {
        this.phase = 'apply';
        // before the first cycle the pressure follows the pedal; after it, the modulator
        // re-applies in a slower ramp, so the wheel hovers near its peak grip
        const rise = ABS.applyRate * bar * dt;
        this.pressure = Math.min(linePa, this.pressure + (this.cycles ? rise : Math.max(rise, (linePa - this.pressure) * Math.min(1, dt * 60))));
        if (-slip > ABS.releaseSlip && wheelDecel > 0) {
          this.phase = 'release';
          this.cycles++;
        }
        break;
      }
      case 'release':
        // dump only until the wheel stops losing speed, then hold while it spins back up
        this.pressure = Math.max(0, this.pressure - ABS.releaseRate * bar * dt);
        if (wheelDecel <= 0 || -slip < ABS.applySlip) {
          this.phase = 'hold';
          this.holdT = 0.025;
        }
        break;
      case 'hold':
        this.holdT -= dt;
        if (this.holdT <= 0 && -slip < ABS.releaseSlip * 0.75) this.phase = 'apply';
        if (-slip > ABS.releaseSlip && wheelDecel > 0) {
          this.phase = 'release';
          this.cycles++;
        }
        break;
    }
    this.pressure = Math.min(this.pressure, linePa);
  }
  reset() {
    this.phase = 'off';
    this.pressure = 0;
    this.cycles = 0;
  }
}

// ─────────────────────────── cooling ───────────────────────────

export interface CoolingFaults {
  thermostatStuckClosed: boolean;
  fanFailed: boolean;
  lowCoolant: boolean;
}

export class Cooling {
  coolantC: number = COOLING.ambientC;
  /** Thermostat opening, 0 … 1 (follows the wax element with a lag). */
  thermostat = 0;
  fanOn = false;
  /** Coolant flow through the radiator and through the bypass, as fractions of pump flow. */
  radiatorFlow = 0;
  bypassFlow = 0;
  /** Water pump flow, L/min. */
  pumpFlow = 0;
  /** Heat rejected by the radiator, W, and heat into the coolant, W. */
  rejected = 0;
  heatIn = 0;
  step(dt: number, engineRpm: number, fuelPowerW: number, speedMs: number, faults: CoolingFaults, heaterOn = false) {
    // pump flow follows engine speed (belt driven)
    this.pumpFlow = (engineRpm / 6000) * 160 * (faults.lowCoolant ? 0.45 : 1);
    const pumpShare = Math.min(1, engineRpm / 2500);
    // wax element: target opening from temperature, followed with a time constant of ~6 s
    const target = faults.thermostatStuckClosed ? 0 : sstep(COOLING.thermostatOpenC, COOLING.thermostatFullC, this.coolantC);
    this.thermostat += (target - this.thermostat) * Math.min(1, dt / 6);
    // fan: on and off with hysteresis
    if (!faults.fanFailed && this.coolantC >= COOLING.fanOnC) this.fanOn = true;
    if (this.coolantC <= COOLING.fanOffC || faults.fanFailed) this.fanOn = false;
    const ram = Math.min(1, speedMs / 27.8);
    const air = COOLING.radiatorUA + COOLING.radiatorUARam * ram + (this.fanOn ? COOLING.radiatorUAFan * (1 - 0.6 * ram) : 0);
    this.radiatorFlow = engineRpm > 50 ? this.thermostat * pumpShare : 0;
    this.bypassFlow = engineRpm > 50 ? (1 - this.thermostat) * pumpShare : 0;
    const dT = this.coolantC - COOLING.ambientC;
    // with little coolant, the radiator cannot carry its full load (air pockets)
    const coolantFactor = faults.lowCoolant ? 0.5 : 1;
    this.rejected = air * dT * this.radiatorFlow * coolantFactor + COOLING.blockLossUA * dT + (heaterOn ? 250 * dT * pumpShare : 0);
    this.heatIn = COOLING.heatToCoolant * fuelPowerW;
    const cap = COOLING.heatCapacity * (faults.lowCoolant ? 0.55 : 1);
    this.coolantC += ((this.heatIn - this.rejected) / cap) * dt;
    this.coolantC = Math.min(135, this.coolantC);
  }
}

// ─────────────────────────── lubrication ───────────────────────────

export interface OilFaults {
  lowLevel: boolean;
  wornBearings: boolean;
}

export class Lubrication {
  oilC: number = COOLING.ambientC;
  pressureBar = 0;
  /** Pump flow, L/min, and the share returned through the relief valve. */
  flow = 0;
  relief = 0;
  /** The pickup is drawing air (oil starvation). */
  starving = false;
  private wobble = 0;
  step(dt: number, rpm: number, coolantC: number, accelG: number, faults: OilFaults, t: number) {
    // oil follows the coolant, lagging behind it
    this.oilC += (coolantC + 4 * Math.min(1, rpm / 5000) - this.oilC) * Math.min(1, dt / 40);
    if (rpm < 30) {
      this.pressureBar += (0 - this.pressureBar) * Math.min(1, dt * 8);
      this.flow = 0;
      this.relief = 0;
      this.starving = false;
      return;
    }
    // positive-displacement pump: pressure rises with speed; cold oil is thicker
    const visc = 1 + 1.4 * sstep(90, 20, this.oilC);
    let p = OIL.pressureIdleBar * Math.sqrt(Math.max(0, rpm) / 750) * visc;
    p = Math.min(p, OIL.pressureIdleBar + (OIL.pressureHighBar - OIL.pressureIdleBar) * Math.min(1.2, (rpm - 750) / 3250) * visc + 0.4);
    if (faults.wornBearings) p *= 0.42;
    // a low oil level uncovers the pickup when the oil sloshes (acceleration, braking, corners)
    this.starving = false;
    if (faults.lowLevel) {
      this.wobble = 0.5 + 0.5 * Math.sin(t * 7.3) * Math.sin(t * 2.1);
      const slosh = Math.min(1, Math.abs(accelG) * 3 + 0.35 * this.wobble);
      if (slosh > 0.45) {
        this.starving = true;
        p *= 0.15 + 0.4 * (1 - slosh);
      } else p *= 0.75;
    }
    this.relief = p > OIL.reliefBar ? Math.min(1, (p - OIL.reliefBar) / 2) : 0;
    p = Math.min(p, OIL.reliefBar);
    this.pressureBar += (p - this.pressureBar) * Math.min(1, dt * 10);
    this.flow = (rpm / 6000) * 60 * (1 - 0.6 * this.relief);
  }
  get warning(): boolean {
    return this.pressureBar < OIL.warnBar && this.flow > 0;
  }
}

// ─────────────────────────── 12 V electrical ───────────────────────────

export interface ElectricalFaults {
  weakBattery: boolean;
  alternatorFailed: boolean;
}

export class Electrical {
  /** State of charge, 0 … 1. */
  soc = 0.9;
  volts: number = ELECTRICAL.ocvFull;
  /** Battery current (+ discharging), alternator output and the starter's draw, A. */
  batteryAmps = 0;
  alternatorAmps = 0;
  starterAmps = 0;
  loadAmps = 0;
  /** The ECU has enough voltage to run. */
  ecuPowered = true;
  setWeak(weak: boolean) {
    if (weak) this.soc = Math.min(this.soc, 0.32);
  }
  internal(faults: ElectricalFaults): number {
    return ELECTRICAL.internalOhm * (faults.weakBattery ? 2.3 : 1);
  }
  ocv(): number {
    return ELECTRICAL.ocvEmpty + (ELECTRICAL.ocvFull - ELECTRICAL.ocvEmpty) * Math.max(0, Math.min(1, this.soc));
  }
  /**
   * One step: `cranking` draws the starter's current (it falls as the engine turns faster);
   * the alternator (belt-driven at engine speed × pulley ratio) holds the system at its
   * regulated voltage once the engine runs, if it can supply the load.
   */
  step(dt: number, ignitionOn: boolean, cranking: boolean, engineRpm: number, accessoriesAmps: number, faults: ElectricalFaults) {
    const rInt = this.internal(faults);
    const ocv = this.ocv();
    this.loadAmps = (ignitionOn ? (engineRpm > 300 ? ELECTRICAL.baseLoadAmps : 9) : 0.03) + (ignitionOn ? accessoriesAmps : 0);
    this.starterAmps = cranking ? ELECTRICAL.starterAmps * (1.1 - 0.35 * Math.min(1, engineRpm / ELECTRICAL.crankRpm)) : 0;
    // alternator capacity rises with its own speed: cut-in near 1000 alternator rpm, about half
    // its rating at engine idle, the full rating above about 4500 alternator rpm
    const altRpm = engineRpm * ELECTRICAL.alternatorPulley;
    const cap = faults.alternatorFailed ? 0 : ELECTRICAL.alternatorMaxAmps * Math.pow(Math.min(1, Math.max(0, (altRpm - 1000) / 3500)), 0.6);
    // the battery accepts a charging current that falls as it fills
    const accept = Math.max(0, Math.min(60, (ELECTRICAL.regulatedVolts - ocv) / (rInt * 6)));
    const demand = this.loadAmps + this.starterAmps;
    if (cap > 0 && engineRpm > 400) {
      if (cap >= demand + accept) {
        // the regulator holds the system voltage; the battery charges
        this.alternatorAmps = demand + accept;
        this.batteryAmps = -accept;
        this.volts = ELECTRICAL.regulatedVolts;
      } else {
        // the alternator is at its limit: the battery makes up the rest
        this.alternatorAmps = cap;
        this.batteryAmps = demand - cap;
        this.volts = this.batteryAmps >= 0 ? ocv - this.batteryAmps * rInt : ocv - this.batteryAmps * rInt * 6;
      }
    } else {
      this.alternatorAmps = 0;
      this.batteryAmps = demand;
      this.volts = ocv - this.batteryAmps * rInt;
    }
    this.soc -= (this.batteryAmps * dt) / (ELECTRICAL.capacityAh * 3600);
    this.soc = Math.max(0, Math.min(1, this.soc));
    this.ecuPowered = ignitionOn && this.volts > ELECTRICAL.ecuMinVolts;
  }
  /** Cranking speed the starter can reach at the present voltage, rpm. */
  crankingRpm(): number {
    return ELECTRICAL.crankRpm * sstep(6.5, 10.6, this.volts);
  }
}
