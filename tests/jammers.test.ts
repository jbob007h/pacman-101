import { describe, expect, it } from 'vitest';
import {
  GHOST_ATTACK_WINDOW,
  KILL_PRESSURE,
  SIM_ATTACK_MAX,
  SIM_ATTACK_MIN,
  SIM_CLEAR_RELIEF,
  SIM_COUNT,
  SIM_JAMMER_MAX,
  SIM_JAMMER_MIN,
} from '../src/config';
import { Game } from '../src/game';
import { GhostAttackWindow } from '../src/systems/ghostWindow';
import { ghostVolley, pickCpuTarget, pickSimIds, rollAttackDelay, rollJammerCount } from '../src/systems/jammers';
import { mulberry32 } from '../src/shared/rng';

describe('jammers', () => {
  it('sends one ghost attack per window, with one jammer of pressure per ghost', () => {
    const game = new Game(() => 0);
    const sent: { targets: number[]; strength: number }[] = [];
    game.bus.on('jammersSent', (event) => {
      if (event.reason !== 'ghost') return;
      sent.push({ targets: [...event.targets], strength: event.strength });
    });

    game.bus.emit({ type: 'ghostEaten', ghostId: 'blinky', strength: 1, combo: 1 });
    game.bus.emit({ type: 'trainGhostEaten', combo: 2 });
    game.bus.emit({ type: 'ghostEaten', ghostId: 'pinky', strength: 2, combo: 3 });
    expect(game.sims.sims.every((sim) => sim.pressure === 0)).toBe(true);
    game.sims.advanceGhostWindow(GHOST_ATTACK_WINDOW - 0.05);
    expect(sent).toEqual([]);

    game.sims.advanceGhostWindow(0.05);
    expect(sent).toEqual([{ targets: [1], strength: 3 }]);
    expect(game.sims.sims[0]?.pressure).toBe(3);
    expect(game.match.remaining()).toBe(101);

    game.bus.emit({ type: 'ghostEaten', ghostId: 'inky', strength: 1, combo: 1 });
    game.sims.advanceGhostWindow(GHOST_ATTACK_WINDOW);
    expect(sent).toEqual([
      { targets: [1], strength: 3 },
      { targets: [1], strength: 1 },
    ]);
    expect(game.sims.sims[0]?.pressure).toBe(4);
  });

  it('does not fire a ghost attack when no ghost was eaten', () => {
    const window = new GhostAttackWindow();
    expect(window.tick(10)).toBeNull();
    expect(window.tick(0)).toBeNull();
    window.eat();
    expect(window.tick(GHOST_ATTACK_WINDOW - 0.05)).toBeNull();
    expect(window.tick(GHOST_ATTACK_WINDOW)).toBe(1);
    expect(window.tick(GHOST_ATTACK_WINDOW)).toBeNull();

    const game = new Game(() => 0);
    const volleys: number[] = [];
    const reasons: string[] = [];
    game.bus.on('ghostVolley', (event) => volleys.push(event.count));
    game.bus.on('jammersSent', (event) => {
      if (event.reason !== 'sim') reasons.push(event.reason);
    });

    game.sims.advanceGhostWindow(10);
    game.bus.emit({ type: 'powerPelletEaten' });
    game.sims.advanceGhostWindow(GHOST_ATTACK_WINDOW);
    for (let eaten = 1; eaten <= 50; eaten++) {
      game.bus.emit({ type: 'dotEaten', totalEaten: eaten, remaining: 80 });
    }
    game.bus.emit({ type: 'boardCleared' });
    game.sims.advanceGhostWindow(GHOST_ATTACK_WINDOW);
    expect(volleys).toEqual([]);
    expect(reasons).toEqual([]);

    game.bus.emit({ type: 'ghostEaten', ghostId: 'blinky', strength: 1, combo: 1 });
    game.sims.advanceGhostWindow(GHOST_ATTACK_WINDOW - 0.05);
    expect(volleys).toEqual([]);
    game.sims.advanceGhostWindow(0.05);
    expect(volleys).toEqual([1]);
    expect(reasons).toEqual(['ghost']);
  });

  it('does not target eliminated sims', () => {
    const sims = [
      { id: 1, alive: false, pressure: 100 },
      { id: 2, alive: true, pressure: 0 },
      { id: 3, alive: true, pressure: 100 },
    ];
    expect(pickSimIds(sims, 4, () => 0)).toEqual([2]);
    const ghost = ghostVolley(4, sims, () => 0);
    expect(ghost).toEqual([{ targetId: 2, strength: 4, reason: 'ghost' }]);
  });

  it('does not send a later ghost or clear attack at a sim that is already out', () => {
    const game = new Game(() => 0);
    const sent: number[][] = [];
    game.bus.on('jammersSent', (event) => {
      if (event.reason === 'sim') return;
      sent.push([...event.targets]);
    });
    const fallen = game.sims.sims[0];
    if (!fallen) throw new Error('missing sim');
    fallen.alive = false;
    fallen.pressure = KILL_PRESSURE;

    game.bus.emit({ type: 'dotEaten', totalEaten: 50, remaining: 1 });
    game.bus.emit({ type: 'boardCleared' });
    expect(sent).toEqual([]);
    game.bus.emit({ type: 'ghostEaten', ghostId: 'inky', strength: 1, combo: 1 });
    game.sims.advanceGhostWindow(GHOST_ATTACK_WINDOW);
    expect(fallen.alive).toBe(false);
    expect(fallen.pressure).toBe(KILL_PRESSURE);
    expect(sent.length).toBeGreaterThan(0);
    for (const targets of sent) expect(targets).not.toContain(fallen.id);
  });

  it('picks living targets uniformly and gives the player one seat in a cpu attack', () => {
    const sims = [
      { id: 1, alive: true, pressure: 90 },
      { id: 2, alive: true, pressure: 0 },
      { id: 3, alive: true, pressure: 12 },
      { id: 4, alive: true, pressure: 40 },
    ];
    const counts = [0, 0, 0, 0];
    const rng = mulberry32(3);
    for (let i = 0; i < 4000; i++) {
      const id = pickSimIds(sims, 1, rng)[0];
      if (id === undefined) throw new Error('missing target');
      const bin = counts[id - 1];
      if (bin === undefined) throw new Error('missing bin');
      counts[id - 1] = bin + 1;
    }
    for (const count of counts) {
      expect(count).toBeGreaterThan(800);
      expect(count).toBeLessThan(1200);
    }

    const others = Array.from({ length: 99 }, (_, index) => index + 1);
    let human = 0;
    const rolls = 20000;
    const seatRng = mulberry32(4);
    for (let i = 0; i < rolls; i++) if (pickCpuTarget(others, seatRng) === null) human += 1;
    expect(human / rolls).toBeGreaterThan(0.007);
    expect(human / rolls).toBeLessThan(0.014);
    expect(pickCpuTarget([], () => 0.2)).toBeNull();
  });

  it('sheds pressure when a cpu simulates a clear and keeps most of the field at four minutes', () => {
    const game = new Game(() => 0);
    const first = game.sims.sims[0];
    if (!first) throw new Error('missing sim');
    first.pressure = 80;
    for (let i = 0; i < 60; i++) game.sims.update(0.05);
    expect(first.pressure).toBeLessThan(80 - SIM_CLEAR_RELIEF);
    expect(first.relief).toBeGreaterThan(0);
    expect(first.alive).toBe(true);

    for (const seed of [1, 2, 3]) {
      const idle = new Game(mulberry32(seed));
      for (let i = 0; i < 4800; i++) idle.sims.update(0.05);
      const alive = idle.sims.aliveCount();
      expect(alive).toBeGreaterThanOrEqual(60);
      expect(alive).toBeLessThan(98);
      expect(idle.match.remaining()).toBe(1 + alive);
    }

    const playing = new Game(mulberry32(1));
    for (let i = 1; i <= 4800; i++) {
      playing.sims.update(0.05);
      if (i % 240 === 0) {
        playing.bus.emit({ type: 'ghostEaten', ghostId: 'blinky', strength: 1, combo: 1 });
      }
    }
    expect(playing.sims.aliveCount()).toBeGreaterThanOrEqual(40);
    expect(playing.match.phase).toBe('playing');
  });

  it('rolls each CPU an 8–12s gap and a jammer count from 1 to 16', () => {
    expect(rollAttackDelay(() => 0)).toBe(SIM_ATTACK_MIN);
    expect(rollAttackDelay(() => 1)).toBe(SIM_ATTACK_MAX);
    expect(rollJammerCount(() => 0)).toBe(SIM_JAMMER_MIN);
    expect(rollJammerCount(() => 0.999)).toBe(SIM_JAMMER_MAX);
    const rng = mulberry32(9);
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const delay = rollAttackDelay(rng);
      const jammers = rollJammerCount(rng);
      expect(delay).toBeGreaterThanOrEqual(SIM_ATTACK_MIN);
      expect(delay).toBeLessThanOrEqual(SIM_ATTACK_MAX);
      expect(jammers).toBeGreaterThanOrEqual(SIM_JAMMER_MIN);
      expect(jammers).toBeLessThanOrEqual(SIM_JAMMER_MAX);
      seen.add(jammers);
    }
    expect(seen.size).toBe(SIM_JAMMER_MAX - SIM_JAMMER_MIN + 1);

    const early = new Game(() => 0);
    const strengths: number[] = [];
    let shots = 0;
    early.bus.on('jammersSent', (event) => {
      if (event.reason !== 'sim') return;
      shots += 1;
      strengths.push(event.strength);
    });
    for (const sim of early.sims.sims) {
      expect(sim.attackIn).toBe(SIM_ATTACK_MIN);
    }
    early.sims.update(SIM_ATTACK_MIN - 0.05);
    expect(shots).toBe(0);
    early.sims.update(0.05);
    expect(shots).toBe(SIM_COUNT);
    expect(strengths.every((strength) => strength === 1)).toBe(true);
    for (const sim of early.sims.sims) expect(sim.attackIn).toBe(SIM_ATTACK_MIN);
    early.sims.update(SIM_ATTACK_MIN - 0.05);
    expect(shots).toBe(SIM_COUNT);
    early.sims.update(0.05);
    expect(shots).toBe(SIM_COUNT * 2);

    const late = new Game(() => 0.999);
    const inbound: { strength: number; exact?: boolean }[] = [];
    late.bus.on('incomingJammer', (event) => inbound.push({ strength: event.strength, exact: event.exact }));
    late.sims.update(SIM_ATTACK_MAX - 0.05);
    expect(inbound).toEqual([]);
    late.sims.update(0.05);
    expect(inbound).toHaveLength(SIM_COUNT);
    expect(inbound.every((shot) => shot.strength === SIM_JAMMER_MAX && shot.exact === true)).toBe(true);

    const spread = new Game(mulberry32(7));
    let spreadShots = 0;
    const spreadStrengths: number[] = [];
    spread.bus.on('jammersSent', (event) => {
      if (event.reason !== 'sim') return;
      spreadShots += 1;
      spreadStrengths.push(event.strength);
    });
    spread.bus.on('incomingJammer', (event) => {
      spreadShots += 1;
      spreadStrengths.push(event.strength);
    });
    for (const sim of spread.sims.sims) {
      expect(sim.attackIn).toBeGreaterThanOrEqual(SIM_ATTACK_MIN);
      expect(sim.attackIn).toBeLessThanOrEqual(SIM_ATTACK_MAX);
    }
    spread.sims.update(SIM_ATTACK_MIN - 0.05);
    expect(spreadShots).toBe(0);
    spread.sims.update(6);
    expect(spreadShots).toBe(SIM_COUNT);
    expect(spreadStrengths.every((strength) => strength >= SIM_JAMMER_MIN && strength <= SIM_JAMMER_MAX)).toBe(true);
    for (const sim of spread.sims.sims) {
      expect(sim.attackIn).toBeGreaterThan(0);
      expect(sim.attackIn).toBeLessThanOrEqual(SIM_ATTACK_MAX);
    }
  });

  it('hits the player with an exact jammer count when a cpu shot picks them', () => {
    const game = new Game(() => 0.999);
    const inbound: { strength: number; exact?: boolean }[] = [];
    game.bus.on('incomingJammer', (event) => inbound.push({ strength: event.strength, exact: event.exact }));
    game.sims.update(SIM_ATTACK_MAX);
    expect(inbound.length).toBe(SIM_COUNT);
    expect(inbound.every((shot) => shot.strength === SIM_JAMMER_MAX && shot.exact === true)).toBe(true);
  });

  it('fires no CPU attacks before the 8 second minimum of match time', () => {
    const game = new Game(() => 0);
    let cpuShots = 0;
    game.bus.on('jammersSent', (event) => {
      if (event.reason === 'sim') cpuShots += 1;
    });
    game.bus.on('incomingJammer', () => {
      cpuShots += 1;
    });
    const pinGhosts = (): void => {
      for (const ghost of game.board.ghosts) {
        ghost.mode = 'house';
        ghost.releaseAt = 1e9;
        ghost.x = 13;
        ghost.y = 14;
      }
    };

    game.startMatch();
    let guard = 0;
    while (game.matchTime === 0 && guard++ < 400) {
      pinGhosts();
      game.update(1 / 60);
    }
    expect(game.matchTime).toBeGreaterThan(0);
    expect(game.matchTime).toBeLessThan(SIM_ATTACK_MIN);
    expect(game.match.phase).toBe('playing');
    expect(cpuShots).toBe(0);

    game.bus.emit({ type: 'ghostEaten', ghostId: 'blinky', strength: 1, combo: 1 });
    expect(game.sims.sims.every((sim) => sim.pressure === 0)).toBe(true);
    expect(cpuShots).toBe(0);
    const openedAt = game.matchTime;
    while (game.matchTime < openedAt + GHOST_ATTACK_WINDOW) {
      pinGhosts();
      game.update(1 / 60);
      expect(cpuShots).toBe(0);
    }
    expect(game.sims.sims.some((sim) => sim.pressure > 0)).toBe(true);
    expect(game.matchTime).toBeLessThan(SIM_ATTACK_MIN);

    while (game.matchTime < SIM_ATTACK_MIN) {
      pinGhosts();
      game.update(1 / 60);
      if (game.matchTime < SIM_ATTACK_MIN) expect(cpuShots).toBe(0);
    }
    expect(cpuShots).toBeGreaterThan(0);
    expect(game.match.phase).toBe('playing');
    expect(game.matchTime).toBeGreaterThanOrEqual(SIM_ATTACK_MIN);
    expect(game.matchTime).toBeLessThan(SIM_ATTACK_MIN + 0.05);

    game.startMatch();
    const marked = cpuShots;
    guard = 0;
    while (game.matchTime === 0 && guard++ < 400) {
      pinGhosts();
      game.update(1 / 60);
    }
    while (game.matchTime < SIM_ATTACK_MIN) {
      pinGhosts();
      game.update(1 / 60);
      if (game.matchTime < SIM_ATTACK_MIN) expect(cpuShots).toBe(marked);
    }
    expect(cpuShots).toBeGreaterThan(marked);
    expect(game.match.phase).toBe('playing');
  });

  it('wins when the last sim is eliminated and loses when pac dies', () => {
    const game = new Game(() => 0);
    for (const sim of game.sims.sims) sim.alive = false;
    const last = game.sims.sims[9];
    if (!last) throw new Error('missing sim');
    last.alive = true;
    last.pressure = KILL_PRESSURE - 1;
    game.bus.emit({ type: 'ghostEaten', ghostId: 'clyde', strength: 4, combo: 4 });
    game.sims.advanceGhostWindow(GHOST_ATTACK_WINDOW);
    expect(last.alive).toBe(false);
    expect(game.match.phase).toBe('won');
    expect(game.match.remaining()).toBe(1);

    game.restart();
    expect(game.match.phase).toBe('playing');
    expect(game.match.remaining()).toBe(101);

    const events: string[] = [];
    game.bus.on('playerEliminated', () => events.push('playerEliminated'));
    game.bus.on('playerDied', () => events.push('playerDied'));
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    game.board.pac.x = blinky.x;
    game.board.pac.y = blinky.y;
    blinky.mode = 'chase';
    game.update(1 / 60);
    expect(game.match.phase).toBe('lost');
    expect(events).toContain('playerDied');
    expect(events).toContain('playerEliminated');
    expect(game.match.remaining()).toBe(100);
  });
});
