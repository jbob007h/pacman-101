import {
  CLEAR_PRESSURE,
  CLEAR_TARGETS,
  DOT_MILESTONE,
  DOT_PRESSURE,
  GHOST_PRESSURE_BASE,
  GHOST_PRESSURE_STEP,
  KILL_PRESSURE,
  SIM_PRESSURE,
} from '../config';
import type { GameplayEvent, JamReason } from '../shared/events';
import type { Rng } from '../shared/rng';

export interface JammerSim {
  id: number;
  alive: boolean;
  pressure: number;
}

export interface JammerAction {
  targetId: number;
  strength: number;
  reason: JamReason;
}

/** Still in the match. Eliminated sims, and anyone already at kill pressure, are not targets. */
export function livingSims(sims: readonly JammerSim[]): JammerSim[] {
  return sims.filter((sim) => sim.alive && sim.pressure < KILL_PRESSURE);
}

/** Uniform sample of living sims. Pressure does not change the odds. */
export function pickSimIds(sims: readonly JammerSim[], count: number, rng: Rng): number[] {
  const available = livingSims(sims).map((sim) => sim.id);
  const picked: number[] = [];
  for (let i = 0; i < count && available.length > 0; i++) {
    const index = Math.floor(rng() * available.length);
    const target = available[index];
    if (target === undefined) break;
    available.splice(index, 1);
    picked.push(target);
  }
  return picked;
}

/**
 * One CPU attack. `otherIds` are the living sims except the attacker.
 * The human is the extra seat, so a null result hits the player with
 * probability 1 / (otherIds.length + 1).
 */
export function pickCpuTarget(otherIds: readonly number[], rng: Rng): number | null {
  const seats = otherIds.length + 1;
  const roll = Math.floor(rng() * seats);
  if (roll >= otherIds.length) return null;
  return otherIds[roll] ?? null;
}

export function jammersFromEvent(event: GameplayEvent, sims: readonly JammerSim[], rng: Rng): JammerAction[] {
  if (event.type === 'ghostEaten') {
    const strength = GHOST_PRESSURE_BASE + event.strength * GHOST_PRESSURE_STEP;
    const count = event.strength >= 3 ? Math.min(3, event.strength - 1) : 1;
    return mapTargets(pickSimIds(sims, count, rng), strength, 'ghost');
  }
  if (event.type === 'dotEaten' && event.remaining > 0 && event.totalEaten > 0 && event.totalEaten % DOT_MILESTONE === 0) {
    return mapTargets(pickSimIds(sims, 1, rng), DOT_PRESSURE, 'dots');
  }
  if (event.type === 'boardCleared') {
    return mapTargets(pickSimIds(sims, CLEAR_TARGETS, rng), CLEAR_PRESSURE, 'clear');
  }
  return [];
}

export function simVsSimAction(targetId: number): JammerAction {
  return { targetId, strength: SIM_PRESSURE, reason: 'sim' };
}

function mapTargets(ids: number[], strength: number, reason: JamReason): JammerAction[] {
  return ids.map((targetId) => ({ targetId, strength, reason }));
}
