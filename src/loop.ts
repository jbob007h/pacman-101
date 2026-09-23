import { MAX_SIM_STEPS, SIM_FRAME_SEC } from './config';

export interface SimStepPlan {
  frames: number;
  lag: number;
}

/**
 * How many fixed 60Hz steps to run for one display frame.
 * Leftover lag is carried so a 144Hz display still simulates at 60.
 * Hitting the catch-up cap drops the remainder so a backgrounded tab cannot spiral.
 */
export function planSimSteps(lag: number, dt: number): SimStepPlan {
  const slice = Math.min(0.25, Math.max(0, dt));
  let next = Math.max(0, lag) + slice;
  let frames = 0;
  while (next >= SIM_FRAME_SEC && frames < MAX_SIM_STEPS) {
    next -= SIM_FRAME_SEC;
    frames += 1;
  }
  if (frames === MAX_SIM_STEPS) next = 0;
  else if (next < 1e-8) next = 0;
  return { frames, lag: next };
}
