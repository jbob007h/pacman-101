import {
  CPU_CANCEL_DROP,
  CPU_CANCEL_START,
  CPU_CANCEL_STEP,
  KILL_PRESSURE,
  SIM_ATTACK_GRACE,
  SIM_ATTACK_MAX,
  SIM_ATTACK_MIN,
  SIM_JAMMER_MAX,
  SIM_JAMMER_MIN,
} from '../config';
import type { JamReason } from '../shared/events';
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

/**
 * One ghost attack after the eat window closes. One living target, strength
 * equal to the number of ghosts eaten. That strength is the jammer count.
 */
export function ghostVolley(count: number, sims: readonly JammerSim[], rng: Rng): JammerAction[] {
  if (count <= 0) return [];
  return mapTargets(pickSimIds(sims, 1, rng), count, 'ghost');
}

/** Seconds until this CPU shoots again. Uniform on [{@link SIM_ATTACK_MIN}, {@link SIM_ATTACK_MAX}]. */
export function rollAttackDelay(rng: Rng): number {
  return SIM_ATTACK_MIN + rng() * (SIM_ATTACK_MAX - SIM_ATTACK_MIN);
}

/**
 * First shot of the match. Same 5–15s roll as {@link rollAttackDelay}, shifted
 * so the earliest land is {@link SIM_ATTACK_GRACE}. Later shots are not shifted.
 */
export function rollOpeningAttackDelay(rng: Rng): number {
  const lift = Math.max(0, SIM_ATTACK_GRACE - SIM_ATTACK_MIN);
  return rollAttackDelay(rng) + lift;
}

/** Jammers in one CPU shot. Uniform integer on [{@link SIM_JAMMER_MIN}, {@link SIM_JAMMER_MAX}]. */
export function rollJammerCount(rng: Rng): number {
  const span = SIM_JAMMER_MAX - SIM_JAMMER_MIN + 1;
  const index = Math.min(span - 1, Math.floor(Math.max(0, rng()) * span));
  return SIM_JAMMER_MIN + index;
}

/**
 * Chance, in percent, that a CPU/bot attack is cancelled outright.
 * Starts at {@link CPU_CANCEL_START} and drops by {@link CPU_CANCEL_DROP}
 * every {@link CPU_CANCEL_STEP} seconds of match time, floored at 0.
 */
export function cpuCancelPercent(matchElapsedSeconds: number): number {
  const elapsed = Number.isFinite(matchElapsedSeconds) ? Math.max(0, matchElapsedSeconds) : 0;
  const steps = Math.floor(elapsed / CPU_CANCEL_STEP);
  return Math.max(0, CPU_CANCEL_START - steps * CPU_CANCEL_DROP);
}

/** True when this attack sends nothing. `roll` is a uniform unit interval. */
export function cpuAttackCancelled(cancelPercent: number, roll: number): boolean {
  if (cancelPercent <= 0) return false;
  return roll * 100 < cancelPercent;
}

/**
 * Scale a rolled jammer count by the same curve as {@link cpuCancelPercent}.
 * `base * (100 - cancelPercent) / 100`, rounded to the nearest integer.
 * A result below 1 is 0: the caller skips the shot instead of sending none.
 */
export function scaleCpuJammers(baseStrength: number, cancelPercent: number): number {
  const percent = Math.min(100, Math.max(0, cancelPercent));
  const scaled = (baseStrength * (100 - percent)) / 100;
  const jammers = Math.round(scaled);
  return jammers < 1 ? 0 : jammers;
}

export function simVsSimAction(targetId: number, jammers: number): JammerAction {
  return { targetId, strength: jammers, reason: 'sim' };
}

function mapTargets(ids: number[], strength: number, reason: JamReason): JammerAction[] {
  return ids.map((targetId) => ({ targetId, strength, reason }));
}
