import {
  KILL_PRESSURE,
  PRESSURE_LOCK,
  PRESSURE_RECOVERY,
  SIM_ATTACK_GRACE,
  SIM_ATTACK_INTERVAL,
  SIM_ATTACKS_PER_TICK,
  SIM_CLEAR_RELIEF,
  SIM_CLEAR_RELIEF_CHANCE,
  SIM_COUNT,
  SIM_PELLET_RELIEF,
  SIM_RELIEF_INTERVAL,
  SIM_RELIEFS_PER_TICK,
} from '../config';
import type { EventBus } from '../shared/events';
import type { Rng } from '../shared/rng';
import { jammersFromEvent, pickCpuTarget, simVsSimAction, type JammerAction, type JammerSim } from './jammers';
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
  /** 0–1 teal flash after a simulated pellet or board clear. */
  relief: number;
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
  private reliefAcc = 0;
  /**
   * Offline battle. Online matches turn this off so the server picks targets
   * and the CPU ticker does not also hit the player. {@link reset} turns it back on.
   */
  private localBattle = true;
  /**
   * Match seconds the CPU ticker follows. A fresh world is already past the
   * grace so a direct {@link update} models a battle in progress. {@link reset}
   * puts a new match back at 0, and {@link syncMatchClock} feeds the live clock.
   */
  private attackClock = SIM_ATTACK_GRACE;

  constructor(
    private readonly bus: EventBus,
    private readonly rng: Rng,
  ) {
    this.sims = createSims(rng);
    bus.on('ghostEaten', (event) => {
      if (!this.localBattle) return;
      this.apply(jammersFromEvent(event, this.snapshot(), rng));
    });
    bus.on('dotEaten', (event) => {
      if (!this.localBattle) return;
      this.apply(jammersFromEvent(event, this.snapshot(), rng));
    });
    bus.on('boardCleared', (event) => {
      if (!this.localBattle) return;
      this.apply(jammersFromEvent(event, this.snapshot(), rng));
    });
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

  /** Live match clock. CPU shots stay off until it reaches {@link SIM_ATTACK_GRACE}. */
  syncMatchClock(matchTime: number): void {
    this.attackClock = matchTime;
  }

  /**
   * When false, local ghost / dot / clear events do not pick targets, and the
   * CPU attack and relief clocks stay frozen. Panel flashes still decay.
   */
  setLocalBattle(enabled: boolean): void {
    this.localBattle = enabled;
    if (!enabled) {
      this.attackAcc = 0;
      this.reliefAcc = 0;
    }
  }

  reset(): void {
    const fresh = createSims(this.rng);
    this.sims.splice(0, this.sims.length, ...fresh);
    this.attackAcc = 0;
    this.reliefAcc = 0;
    this.attackClock = 0;
    this.localBattle = true;
  }

  private step(dt: number): void {
    for (const sim of this.sims) {
      if (sim.heat > 0) sim.heat = Math.max(0, sim.heat - dt / 0.45);
      if (sim.busy > 0) sim.busy = Math.max(0, sim.busy - dt / 0.7);
      if (sim.relief > 0) sim.relief = Math.max(0, sim.relief - dt / 0.55);
      if (!this.localBattle || !sim.alive) continue;
      if (sim.lock > 0) sim.lock -= dt;
      else if (sim.pressure > 0) sim.pressure = Math.max(0, sim.pressure - PRESSURE_RECOVERY * dt);
    }

    if (!this.localBattle) {
      this.attackAcc = 0;
      this.reliefAcc = 0;
      return;
    }

    if (this.attackClock < SIM_ATTACK_GRACE) {
      this.attackAcc = 0;
    } else {
      this.attackAcc += dt;
      let guard = 0;
      while (this.attackAcc >= SIM_ATTACK_INTERVAL && guard++ < 6) {
        this.attackAcc -= SIM_ATTACK_INTERVAL;
        for (let i = 0; i < SIM_ATTACKS_PER_TICK; i++) this.simAttack();
      }
    }

    this.reliefAcc += dt;
    let reliefGuard = 0;
    while (this.reliefAcc >= SIM_RELIEF_INTERVAL && reliefGuard++ < 4) {
      this.reliefAcc -= SIM_RELIEF_INTERVAL;
      this.relieve();
    }
  }

  private simAttack(): void {
    const alive = this.sims.filter((sim) => sim.alive && sim.pressure < KILL_PRESSURE);
    if (alive.length === 0) return;
    const attacker = alive[Math.floor(this.rng() * alive.length)];
    if (!attacker) return;
    attacker.busy = 1;
    const others = alive.filter((sim) => sim.id !== attacker.id).map((sim) => sim.id);
    const targetId = pickCpuTarget(others, this.rng);
    if (targetId === null) {
      const strength = 8 + Math.round(attacker.pressure / 4);
      this.bus.emit({ type: 'incomingJammer', fromSimId: attacker.id, strength });
      return;
    }
    this.apply([simVsSimAction(targetId)]);
  }

  /** A few living sims eat a pellet or clear a board and lose pressure. */
  private relieve(): void {
    const candidates = this.sims.filter((sim) => sim.alive && sim.pressure > 0);
    for (let i = 0; i < SIM_RELIEFS_PER_TICK && candidates.length > 0; i++) {
      const index = Math.floor(this.rng() * candidates.length);
      const sim = candidates.splice(index, 1)[0];
      if (!sim) break;
      const drop = this.rng() < SIM_CLEAR_RELIEF_CHANCE ? SIM_CLEAR_RELIEF : SIM_PELLET_RELIEF;
      sim.pressure = Math.max(0, sim.pressure - drop);
      sim.relief = 1;
    }
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
    relief: 0,
    lock: 0,
    phase: rng() * Math.PI * 2,
  }));
}
