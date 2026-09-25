import { describe, expect, it } from 'vitest';
import { MAX_SIM_STEPS, SIM_FPS, SIM_FRAME_SEC } from '../src/config';
import { drainSimLag, planSimSteps, WallSimClock } from '../src/loop';

describe('60Hz simulation clock', () => {
  it('turns 50ms into three frames and keeps a 120Hz slice until it fills one', () => {
    const fifty = planSimSteps(0, 0.05);
    expect(fifty.frames).toBe(3);
    expect(fifty.lag).toBeCloseTo(0, 8);

    const half = planSimSteps(0, SIM_FRAME_SEC / 2);
    expect(half.frames).toBe(0);
    expect(half.lag).toBeCloseTo(SIM_FRAME_SEC / 2, 8);

    const filled = planSimSteps(half.lag, SIM_FRAME_SEC / 2);
    expect(filled.frames).toBe(1);
    expect(filled.lag).toBeCloseTo(0, 8);
  });

  it('bounds one slice and keeps the rest of a stalled second', () => {
    const stalled = planSimSteps(0, 1);
    expect(stalled.frames).toBe(MAX_SIM_STEPS);
    expect(stalled.lag).toBeCloseTo(1 - MAX_SIM_STEPS * SIM_FRAME_SEC, 8);

    const hidden = planSimSteps(SIM_FRAME_SEC / 4, 0);
    expect(hidden.frames).toBe(0);
    expect(hidden.lag).toBeCloseTo(SIM_FRAME_SEC / 4, 8);
  });

  it('simulates the full elapsed time and does not discard a long gap', () => {
    const second = drainSimLag(0, 1);
    expect(second.frames).toBe(SIM_FPS);
    expect(second.lag).toBeCloseTo(0, 8);
    expect(second.chunks).toBe(Math.ceil(SIM_FPS / MAX_SIM_STEPS));

    const halfMinute = drainSimLag(0, 30);
    expect(halfMinute.frames).toBe(30 * SIM_FPS);
    expect(halfMinute.lag).toBeCloseTo(0, 6);

    const partial = drainSimLag(SIM_FRAME_SEC / 4, 1);
    expect(partial.frames).toBe(SIM_FPS);
    expect(partial.lag).toBeCloseTo(SIM_FRAME_SEC / 4, 8);
  });

  it('catches a hidden tab up to the wall clock across later slices', () => {
    const clock = new WallSimClock();
    clock.mark(0);
    clock.mark(2500);
    let frames = 0;
    let guard = 0;
    while (clock.lag >= SIM_FRAME_SEC && guard++ < 10000) frames += clock.take();
    expect(frames).toBe(2.5 * SIM_FPS);
    expect(clock.lag).toBeCloseTo(0, 8);

    const resumed = clock.take();
    expect(resumed).toBe(0);
    clock.mark(2500);
    clock.mark(2500 + (1000 * SIM_FRAME_SEC) / 2);
    expect(clock.take()).toBe(0);
    expect(clock.lag).toBeCloseTo(SIM_FRAME_SEC / 2, 8);
  });
});
