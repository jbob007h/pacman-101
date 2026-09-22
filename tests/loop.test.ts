import { describe, expect, it } from 'vitest';
import { MAX_SIM_STEPS, SIM_FRAME_SEC } from '../src/config';
import { planSimSteps } from '../src/loop';

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

  it('caps a stalled tab at five frames and drops the rest', () => {
    const stalled = planSimSteps(0, 1);
    expect(stalled.frames).toBe(MAX_SIM_STEPS);
    expect(stalled.lag).toBe(0);

    const hidden = planSimSteps(SIM_FRAME_SEC / 4, 0);
    expect(hidden.frames).toBe(0);
    expect(hidden.lag).toBeCloseTo(SIM_FRAME_SEC / 4, 8);
  });
});
