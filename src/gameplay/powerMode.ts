import { FRIGHT_SECONDS } from '../config';

/**
 * Pac power modes. The player queues the next mode with keys 1–4.
 * The queue becomes active only when Pac eats a power pellet, and that
 * pellet uses the newly active mode.
 *
 * Fright time today is {@link FRIGHT_SECONDS} (9s) on every board. The pace
 * table's `fright` column is how fast a frightened ghost walks, not how long
 * the pellet lasts. Stronger replaces that timer with a flat 4 seconds.
 * Eating a ghost near the end of the timer can still add the usual extension.
 *
 * The Train wake counter counts sleeping ghosts woken while Train is active.
 * It resets when a different mode becomes active and when the match resets.
 * Re-eating a pellet while Train is already active does not clear it.
 */
export type PacMode = 'standard' | 'stronger' | 'speed' | 'train';

export const PAC_MODES: readonly { key: string; id: PacMode; label: string }[] = [
  { key: '1', id: 'standard', label: 'Standard' },
  { key: '2', id: 'stronger', label: 'Stronger' },
  { key: '3', id: 'speed', label: 'Speed' },
  { key: '4', id: 'train', label: 'Train' },
];

/** Stronger power-pellet timer. Normal pellets stay at {@link FRIGHT_SECONDS}. */
export const STRONGER_FRIGHT_SECONDS = 4;
/** Temporary Speed-mode levels. One level is one clear-bonus step. */
export const SPEED_MODE_LEVELS = 3;
/** Followers added to the train for each sleeper woken while Train is active. */
export const TRAIN_WAKE_GHOSTS = 2;
/** Sleeping ghosts woken under Train before one white jammer is spawned. */
export const TRAIN_WHITE_EVERY = 4;

export function modeFromKey(key: string): PacMode | null {
  const found = PAC_MODES.find((mode) => mode.key === key);
  return found?.id ?? null;
}

/** Duration assigned when this mode's pellet is eaten. */
export function frightSecondsFor(mode: PacMode): number {
  return mode === 'stronger' ? STRONGER_FRIGHT_SECONDS : FRIGHT_SECONDS;
}

/**
 * Ghost-window strength for the mode that is active when the window closes.
 * Standard keeps the eat count. Stronger doubles it. Speed halves it, rounding up.
 */
export function scaleGhostAttack(mode: PacMode, eaten: number): number {
  if (eaten <= 0) return 0;
  if (mode === 'stronger') return eaten * 2;
  if (mode === 'speed') return Math.ceil(eaten / 2);
  return eaten;
}

/** Speed levels added to Pac while this mode is active. */
export function speedLevelsFor(mode: PacMode): number {
  return mode === 'speed' ? SPEED_MODE_LEVELS : 0;
}

/** Train members created when one sleeping ghost wakes. */
export function ghostsPerWake(mode: PacMode): number {
  return mode === 'train' ? TRAIN_WAKE_GHOSTS : 1;
}
