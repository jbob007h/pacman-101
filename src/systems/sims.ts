import {
  KILL_PRESSURE,
  PRESSURE_LOCK,
  PRESSURE_RECOVERY,
  SIM_CLEAR_RELIEF,
  SIM_CLEAR_RELIEF_CHANCE,
  SIM_COUNT,
  SIM_PELLET_RELIEF,
  SIM_RELIEF_INTERVAL,
  SIM_RELIEFS_PER_TICK,
} from '../config';
import type { EventBus } from '../shared/events';
import type { Rng } from '../shared/rng';
import { GhostAttackWindow } from './ghostWindow';
import {
  cpuAttackCancelled,
  cpuCancelPercent,
  ghostVolley,
  pickCpuTarget,
  rollAttackDelay,
  rollJammerCount,
  scaleCpuJammers,
  simVsSimAction,
  type JammerAction,
  type JammerSim,
} from './jammers';
import { cpuMistakeChance } from './mistakes';
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
  /** Seconds until this CPU's next attack. Each sim rolls its own. */
  attackIn: number;
  /**
   * Online matches hide the offline field so the alive count is the server room
   * (8 in N2a), not 101. Parked panels are not drawn and are not alive.
   */
  parked: boolean;
  /** Draw the roster name on this panel. Offline panels keep the numeric id. */
  showName: boolean;
}

/**
 * One hundred lightweight opponents. No maze AI — just pressure, a mood, and
 * a private attack timer so the field thins out during a match.
 */
export class SimWorld {
  readonly sims: Sim[];
  private reliefAcc = 0;
  /** Match seconds while local CPU attacks are running. Same clock as the match. */
  private elapsed = 0;
  /**
   * Offline battle. Online matches turn this off so the server picks targets
   * and the CPU ticker does not also hit the player. {@link reset} turns it back on.
   */
  private localBattle = true;
  private readonly ghostWindow = new GhostAttackWindow();
  /** Maps a closed ghost window's eat count to attack strength. Identity unless a power mode scales it. */
  private attackScale: (count: number) => number = (count) => count;
  /** Match time already rolled for a mistake, so a frozen clock cannot repeat. */
  private mistakeMark = Number.NaN;

  constructor(
    private readonly bus: EventBus,
    private readonly rng: Rng,
  ) {
    this.sims = createSims(rng);
    bus.on('ghostEaten', () => this.ghostWindow.eat());
    bus.on('trainGhostEaten', () => this.ghostWindow.eat());
  }

  snapshot(): JammerSim[] {
    return this.sims.map((sim) => ({ id: sim.id, alive: sim.alive, pressure: sim.pressure }));
  }

  aliveCount(): number {
    let n = 0;
    for (const sim of this.sims) if (sim.alive) n += 1;
    return n;
  }

  /**
   * `matchElapsed` is the match clock (from match start). When omitted, this
   * world advances its own copy by `dt` so direct sim steps still ramp.
   */
  update(dt: number, matchElapsed?: number): void {
    const followClock = matchElapsed != null && Number.isFinite(matchElapsed);
    if (followClock) this.elapsed = Math.max(0, matchElapsed);
    let left = Math.max(0, dt);
    while (left > 0) {
      const step = Math.min(0.05, left);
      this.step(step, !followClock);
      left -= step;
    }
  }

  /**
   * When false, local ghost eats do not pick targets, and CPU timers and
   * relief stay frozen. Panel flashes still decay. Dots and clears never attack.
   */
  setLocalBattle(enabled: boolean): void {
    this.localBattle = enabled;
    if (!enabled) this.reliefAcc = 0;
  }

  reset(): void {
    const fresh = createSims(this.rng);
    this.sims.splice(0, this.sims.length, ...fresh);
    this.reliefAcc = 0;
    this.elapsed = 0;
    this.localBattle = true;
    this.mistakeMark = Number.NaN;
    this.ghostWindow.reset();
  }

  /**
   * Strength reported when a ghost window closes.
   * The active Pac mode is applied here, at earn time, not when each ghost is eaten.
   */
  setAttackScale(scale: (count: number) => number): void {
    this.attackScale = scale;
  }

  /** Advance only the ghost-eat window. Does not run CPU attacks or relief. */
  advanceGhostWindow(dt: number): void {
    let left = Math.max(0, dt);
    while (left > 0) {
      const stepDt = Math.min(0.05, left);
      this.releaseGhostWindow(stepDt);
      left -= stepDt;
    }
  }

  private step(dt: number, accumulate: boolean): void {
    this.releaseGhostWindow(dt);
    for (const sim of this.sims) {
      if (sim.heat > 0) sim.heat = Math.max(0, sim.heat - dt / 0.45);
      if (sim.busy > 0) sim.busy = Math.max(0, sim.busy - dt / 0.7);
      if (sim.relief > 0) sim.relief = Math.max(0, sim.relief - dt / 0.55);
      if (!this.localBattle || !sim.alive) continue;
      if (sim.lock > 0) sim.lock -= dt;
      else if (sim.pressure > 0) sim.pressure = Math.max(0, sim.pressure - PRESSURE_RECOVERY * dt);
    }

    if (!this.localBattle) {
      this.reliefAcc = 0;
      return;
    }

    if (accumulate) this.elapsed += dt;

    for (const sim of this.sims) {
      if (!sim.alive) continue;
      sim.attackIn -= dt;
      if (sim.attackIn > 0) continue;
      this.fire(sim);
      sim.attackIn = rollAttackDelay(this.rng);
    }

    this.rollMistakes(dt, accumulate);

    this.reliefAcc += dt;
    let reliefGuard = 0;
    while (this.reliefAcc >= SIM_RELIEF_INTERVAL && reliefGuard++ < 4) {
      this.reliefAcc -= SIM_RELIEF_INTERVAL;
      this.relieve();
    }
  }

  private releaseGhostWindow(dt: number): void {
    const eaten = this.ghostWindow.tick(dt);
    if (eaten == null || eaten <= 0) return;
    const count = this.attackScale(eaten);
    if (count <= 0) return;
    if (this.localBattle) this.apply(ghostVolley(count, this.snapshot(), this.rng));
    this.bus.emit({ type: 'ghostVolley', count });
  }

  private fire(attacker: Sim): void {
    if (!attacker.alive || attacker.pressure >= KILL_PRESSURE) return;
    const base = rollJammerCount(this.rng);
    const cancelPercent = cpuCancelPercent(this.elapsed);
    if (cpuAttackCancelled(cancelPercent, this.rng())) return;
    const jammers = scaleCpuJammers(base, cancelPercent);
    if (jammers < 1) return;
    attacker.busy = 1;
    const others = this.sims
      .filter((sim) => sim.alive && sim.pressure < KILL_PRESSURE && sim.id !== attacker.id)
      .map((sim) => sim.id);
    const targetId = pickCpuTarget(others, this.rng);
    if (targetId === null) {
      this.bus.emit({ type: 'incomingJammer', fromSimId: attacker.id, strength: jammers, exact: true });
      return;
    }
    this.apply([simVsSimAction(targetId, jammers)], attacker.id);
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

  private apply(actions: JammerAction[], fromSimId?: number): void {
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
        this.markDead(sim);
        eliminated.push(sim.id);
      }
    }
    if (targets.length > 0) {
      this.bus.emit({ type: 'jammersSent', targets, strength, reason, fromSimId });
    }
    for (const simId of eliminated) {
      this.bus.emit({
        type: 'simEliminated',
        simId,
        remainingPlayers: 1 + this.aliveCount(),
      });
    }
  }

  /**
   * Independent per-CPU roll. Same elimination as a pressure kill
   * ({@link markDead} plus `simEliminated`), so placement and the panel X match.
   * A follow-the-clock step that repeats the same timestamp does not roll again.
   */
  private rollMistakes(dt: number, accumulate: boolean): void {
    const start = accumulate ? this.elapsed - dt : this.elapsed;
    if (!accumulate) {
      if (this.mistakeMark === start) return;
      this.mistakeMark = start;
    }
    const chance = cpuMistakeChance(start, dt);
    if (chance <= 0) return;
    for (const sim of this.sims) {
      if (!sim.alive || sim.parked) continue;
      // Upper tail so a constant 0 roll (used by attack tests) never mistake-kills.
      if (this.rng() < 1 - chance) continue;
      this.markDead(sim);
      this.bus.emit({
        type: 'simEliminated',
        simId: sim.id,
        remainingPlayers: 1 + this.aliveCount(),
      });
    }
  }

  private markDead(sim: Sim): void {
    sim.alive = false;
    sim.pressure = KILL_PRESSURE;
    sim.busy = 0;
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
    attackIn: rollAttackDelay(rng),
    parked: false,
    showName: false,
  }));
}
