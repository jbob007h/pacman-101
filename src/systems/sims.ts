import {
  KILL_PRESSURE,
  PRESSURE_LOCK,
  PRESSURE_RECOVERY,
  SIM_ATTACK_INTERVAL,
  SIM_ATTACKS_PER_TICK,
  SIM_COUNT,
  SIM_INCOMING_CHANCE,
} from '../config';
import type { EventBus } from '../shared/events';
import type { Rng } from '../shared/rng';
import { jammersFromEvent, simVsSimAction, type JammerAction, type JammerSim } from './jammers';
import { cpuName } from './names';

export interface Sim {
  id: number;
  name: string;
  alive: boolean;
  /** 0–100. At {@link KILL_PRESSURE} the sim is eliminated. */
  pressure: number;
  /** 0–1 hit flash, decays quickly. */
  heat: number;
  /** 0–1 while this sim is firing a jammer. */
  busy: number;
  /** Seconds before pressure starts recovering. */
  lock: number;
  phase: number;
}

/**
 * One hundred lightweight opponents. No maze AI — just pressure, a mood, and
 * a slow sim-vs-sim attack so the field thins out during a match.
 */
export class SimWorld {
  readonly sims: Sim[];
  private attackAcc = 0;

  constructor(
    private readonly bus: EventBus,
    private readonly rng: Rng,
  ) {
    this.sims = createSims(rng);
    bus.on('ghostEaten', (event) => this.apply(jammersFromEvent(event, this.snapshot(), rng)));
    bus.on('dotEaten', (event) => this.apply(jammersFromEvent(event, this.snapshot(), rng)));
    bus.on('boardCleared', (event) => this.apply(jammersFromEvent(event, this.snapshot(), rng)));
  }

  snapshot(): JammerSim[] {
    return this.sims.map((sim) => ({ id: sim.id, alive: sim.alive, pressure: sim.pressure }));
  }

  aliveCount(): number {
    let n = 0;
    for (const sim of this.sims) if (sim.alive) n += 1;
    return n;
  }

  update(dt: number): void {
    let left = Math.max(0, dt);
    while (left > 0) {
      const step = Math.min(0.05, left);
      this.step(step);
      left -= step;
    }
  }

  reset(): void {
    const fresh = createSims(this.rng);
    this.sims.splice(0, this.sims.length, ...fresh);
    this.attackAcc = 0;
  }

  private step(dt: number): void {
    for (const sim of this.sims) {
      if (sim.heat > 0) sim.heat = Math.max(0, sim.heat - dt / 0.45);
      if (sim.busy > 0) sim.busy = Math.max(0, sim.busy - dt / 0.7);
      if (!sim.alive) continue;
      if (sim.lock > 0) sim.lock -= dt;
      else if (sim.pressure > 0) sim.pressure = Math.max(0, sim.pressure - PRESSURE_RECOVERY * dt);
    }

    this.attackAcc += dt;
    let guard = 0;
    while (this.attackAcc >= SIM_ATTACK_INTERVAL && guard++ < 6) {
      this.attackAcc -= SIM_ATTACK_INTERVAL;
      for (let i = 0; i < SIM_ATTACKS_PER_TICK; i++) this.simAttack();
    }
  }

  private simAttack(): void {
    const alive = this.sims.filter((sim) => sim.alive && sim.pressure < KILL_PRESSURE);
    if (alive.length === 0) return;
    const attacker = alive[Math.floor(this.rng() * alive.length)];
    if (!attacker) return;
    attacker.busy = 1;
    if (this.rng() < SIM_INCOMING_CHANCE) {
      const strength = 8 + Math.round(attacker.pressure / 4);
      this.bus.emit({ type: 'incomingJammer', fromSimId: attacker.id, strength });
      return;
    }
    const action = simVsSimAction(this.snapshot(), this.rng);
    if (action) this.apply([action]);
  }

  private apply(actions: JammerAction[]): void {
    if (actions.length === 0) return;
    const targets: number[] = [];
    const eliminated: number[] = [];
    let strength = 0;
    let reason: JammerAction['reason'] = 'sim';
    for (const action of actions) {
      const sim = this.sims[action.targetId - 1];
      if (!sim?.alive || sim.pressure >= KILL_PRESSURE) continue;
      sim.pressure += action.strength;
      sim.heat = 1;
      sim.lock = PRESSURE_LOCK;
      strength = action.strength;
      reason = action.reason;
      targets.push(sim.id);
      if (sim.pressure >= KILL_PRESSURE) {
        sim.alive = false;
        sim.pressure = KILL_PRESSURE;
        sim.busy = 0;
        eliminated.push(sim.id);
      }
    }
    if (targets.length > 0) {
      this.bus.emit({ type: 'jammersSent', targets, strength, reason });
    }
    for (const simId of eliminated) {
      this.bus.emit({
        type: 'simEliminated',
        simId,
        remainingPlayers: 1 + this.aliveCount(),
      });
    }
  }
}

function createSims(rng: Rng): Sim[] {
  return Array.from({ length: SIM_COUNT }, (_, index) => ({
    id: index + 1,
    name: cpuName(index + 1),
    alive: true,
    pressure: 0,
    heat: 0,
    busy: 0,
    lock: 0,
    phase: rng() * Math.PI * 2,
  }));
}
