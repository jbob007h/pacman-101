import { CPU_MISTAKE_END, CPU_MISTAKE_EXPECTED, CPU_MISTAKE_START, SIM_COUNT } from '../config';

/** Seconds in which mistake deaths are allowed. */
export const CPU_MISTAKE_WINDOW = CPU_MISTAKE_END - CPU_MISTAKE_START;

/**
 * Per-CPU chance per second inside the window.
 * `EXPECTED / (SIM_COUNT * WINDOW)` so a full 100-CPU field lands near
 * {@link CPU_MISTAKE_EXPECTED} deaths. Each CPU that lives the whole window
 * survives with about `e^(-EXPECTED / SIM_COUNT)`, so the field mean is a
 * little under the raw total (~9.5 when the total is 10).
 */
export function cpuMistakeRatePerSecond(): number {
  return CPU_MISTAKE_EXPECTED / (SIM_COUNT * CPU_MISTAKE_WINDOW);
}

/**
 * Chance one living CPU dies during this step.
 * `elapsedSeconds` is the match clock at the start of the step.
 * Time outside [START, END) contributes nothing, including a step that only
 * touches the boundary. Humans are not rolled; callers skip them.
 */
export function cpuMistakeChance(elapsedSeconds: number, dt: number): number {
  if (!(dt > 0) || !Number.isFinite(dt)) return 0;
  const start = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
  const from = Math.max(start, CPU_MISTAKE_START);
  const to = Math.min(start + dt, CPU_MISTAKE_END);
  const span = to - from;
  if (span <= 0) return 0;
  return cpuMistakeRatePerSecond() * span;
}
