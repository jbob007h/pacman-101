import {
  CLEAR_PRESSURE,
  CLEAR_TARGETS,
  DOT_MILESTONE,
  DOT_PRESSURE,
  FOCUS_BIAS,
  GHOST_PRESSURE_BASE,
  GHOST_PRESSURE_STEP,
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

/**
 * Pure targeting. Prefers sims that are already under pressure so repeated
 * ghost eats stack into an elimination instead of dissolving across 100 boards.
 */
export function pickSimIds(
  sims: readonly JammerSim[],
  count: number,
  rng: Rng,
  bias = FOCUS_BIAS,
): number[] {
  const available = new Set(sims.filter((sim) => sim.alive).map((sim) => sim.id));
  const pressureOf = new Map(sims.map((sim) => [sim.id, sim.pressure]));
  const picked: number[] = [];
  for (let i = 0; i < count && available.size > 0; i++) {
    const pressured = [...available].filter((id) => (pressureOf.get(id) ?? 0) > 8);
    const source = pressured.length > 0 && rng() < bias ? pressured : [...available];
    const target = source[Math.floor(rng() * source.length)];
    if (target === undefined) break;
    available.delete(target);
    picked.push(target);
  }
  return picked;
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
    return mapTargets(pickSimIds(sims, CLEAR_TARGETS, rng, 0.35), CLEAR_PRESSURE, 'clear');
  }
  return [];
}

export function simVsSimAction(sims: readonly JammerSim[], rng: Rng): JammerAction | null {
  const targets = pickSimIds(sims, 1, rng);
  const targetId = targets[0];
  if (targetId === undefined) return null;
  return { targetId, strength: SIM_PRESSURE, reason: 'sim' };
}

function mapTargets(ids: number[], strength: number, reason: JamReason): JammerAction[] {
  return ids.map((targetId) => ({ targetId, strength, reason }));
}
