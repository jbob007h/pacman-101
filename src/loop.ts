import { MAX_SIM_STEPS, SIM_FRAME_SEC } from './config';

export interface SimStepPlan {
  frames: number;
  lag: number;
}

export interface SimDrain extends SimStepPlan {
  chunks: number;
}

/**
 * How many fixed 60Hz steps to run right now.
 * Leftover lag is kept so the next slice can finish a long gap.
 * A backgrounded tab must not lose time here: the cap only bounds one slice.
 */
export function planSimSteps(lag: number, dt: number, maxSteps = MAX_SIM_STEPS): SimStepPlan {
  const cap = Number.isFinite(maxSteps) ? Math.max(0, Math.floor(maxSteps)) : MAX_SIM_STEPS;
  const total = nonNegative(lag) + nonNegative(dt);
  const available = Math.floor(total / SIM_FRAME_SEC + 1e-9);
  const frames = Math.min(cap, available);
  const leftover = total - frames * SIM_FRAME_SEC;
  return { frames, lag: leftover < 1e-8 ? 0 : leftover };
}

/**
 * Run every fixed step contained in `lag + dt`, slice by slice.
 * The slice cap never throws time away: the last leftover is only a partial frame.
 */
export function drainSimLag(lag: number, dt: number, maxSteps = MAX_SIM_STEPS): SimDrain {
  let pending = nonNegative(dt);
  let next = nonNegative(lag);
  let frames = 0;
  let chunks = 0;
  while (next + pending >= SIM_FRAME_SEC) {
    const plan = planSimSteps(next, pending, maxSteps);
    pending = 0;
    if (plan.frames === 0) break;
    frames += plan.frames;
    next = plan.lag;
    chunks += 1;
  }
  return { frames, lag: next, chunks };
}

/**
 * Wall-clock accumulator for the display loop.
 * Call {@link mark} whenever a heartbeat arrives. Call {@link take} to run a bounded slice.
 * Time between marks stays in {@link lag} until later takes consume it.
 */
export class WallSimClock {
  lag = 0;
  private lastMs: number | null = null;

  mark(nowMs: number): void {
    if (!Number.isFinite(nowMs)) return;
    if (this.lastMs == null) {
      this.lastMs = nowMs;
      return;
    }
    const dt = (nowMs - this.lastMs) / 1000;
    if (dt < 0) return;
    this.lastMs = nowMs;
    if (dt > 0) this.lag += dt;
  }

  take(maxSteps = MAX_SIM_STEPS): number {
    const plan = planSimSteps(this.lag, 0, maxSteps);
    this.lag = plan.lag;
    return plan.frames;
  }
}

function nonNegative(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}
