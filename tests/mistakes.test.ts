import { describe, expect, it } from 'vitest';
import { CPU_MISTAKE_END, CPU_MISTAKE_EXPECTED, CPU_MISTAKE_START, KILL_PRESSURE, SIM_COUNT } from '../src/config';
import { EventBus } from '../src/shared/events';
import { cpuMistakeChance, cpuMistakeRatePerSecond, CPU_MISTAKE_WINDOW } from '../src/systems/mistakes';
import { Ranking } from '../src/systems/ranking';
import { SimWorld } from '../src/systems/sims';

describe('cpu mistake deaths', () => {
  it('matches the 8–12 field target and stays inside 15s–150s', () => {
    const rate = CPU_MISTAKE_EXPECTED / (SIM_COUNT * CPU_MISTAKE_WINDOW);
    expect(CPU_MISTAKE_START).toBe(15);
    expect(CPU_MISTAKE_END).toBe(150);
    expect(CPU_MISTAKE_WINDOW).toBe(135);
    expect(cpuMistakeRatePerSecond()).toBeCloseTo(rate, 12);
    expect(cpuMistakeChance(0, 1)).toBe(0);
    expect(cpuMistakeChance(14, 1)).toBe(0);
    expect(cpuMistakeChance(150, 1)).toBe(0);
    expect(cpuMistakeChance(160, 0.5)).toBe(0);
    expect(cpuMistakeChance(15, 1)).toBeCloseTo(rate, 12);
    expect(cpuMistakeChance(20, 1 / 60)).toBeCloseTo(rate / 60, 12);
    expect(cpuMistakeChance(149.5, 1)).toBeCloseTo(rate * 0.5, 12);
    expect(cpuMistakeChance(14.5, 1)).toBeCloseTo(rate * 0.5, 12);

    const trials = 40;
    let total = 0;
    for (let seed = 1; seed <= trials; seed++) total += simulateField(lcg(seed));
    const mean = total / trials;
    expect(mean).toBeGreaterThanOrEqual(8);
    expect(mean).toBeLessThanOrEqual(12);
  });

  it('kills a local CPU through the real elimination path and not before the grace', () => {
    const always = () => 0.999999;
    const early = new SimWorld(new EventBus(), always);
    for (const sim of early.sims) sim.attackIn = 1e9;
    early.update(10);
    expect(early.aliveCount()).toBe(SIM_COUNT);

    const bus = new EventBus();
    const ranking = new Ranking(bus, 'Pac');
    const world = new SimWorld(bus, always);
    for (const sim of world.sims) sim.attackIn = 1e9;
    world.update(20);
    expect(world.aliveCount()).toBe(0);
    expect(world.sims.every((sim) => sim.pressure === KILL_PRESSURE && !sim.alive)).toBe(true);
    const snapshot = ranking.snapshot();
    expect(snapshot.rows.some((row) => row.place === SIM_COUNT + 1 && !row.you)).toBe(true);
    expect(snapshot.yourPlace).toBe(1);
    expect(snapshot.stillIn).toBe(0);
  });
});

function simulateField(rng: () => number): number {
  const alive = Array.from({ length: SIM_COUNT }, () => true);
  let dead = 0;
  for (let t = 0; t < CPU_MISTAKE_END + 5; t += 0.25) {
    const chance = cpuMistakeChance(t, 0.25);
    if (chance <= 0) continue;
    for (let i = 0; i < alive.length; i++) {
      if (!alive[i]) continue;
      if (rng() >= chance) continue;
      alive[i] = false;
      dead += 1;
    }
  }
  return dead;
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
