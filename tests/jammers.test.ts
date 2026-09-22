import { describe, expect, it } from 'vitest';
import {
  GHOST_PRESSURE_BASE,
  GHOST_PRESSURE_STEP,
  KILL_PRESSURE,
  SIM_CLEAR_RELIEF,
  SIM_PRESSURE,
} from '../src/config';
import { Game } from '../src/game';
import { jammersFromEvent, pickCpuTarget, pickSimIds } from '../src/systems/jammers';
import { mulberry32 } from '../src/shared/rng';

describe('jammers', () => {
  it('eliminates a sim when repeated ghost eats land on the same seat', () => {
    const game = new Game(() => 0);
    const eliminated: number[] = [];
    game.bus.on('simEliminated', (event) => eliminated.push(event.simId));

    game.bus.emit({ type: 'ghostEaten', ghostId: 'blinky', strength: 1, combo: 1 });
    const first = game.sims.sims[0];
    expect(first?.alive).toBe(true);
    expect(first?.pressure).toBe(GHOST_PRESSURE_BASE + GHOST_PRESSURE_STEP);

    game.bus.emit({ type: 'ghostEaten', ghostId: 'pinky', strength: 2, combo: 2 });
    expect(first?.alive).toBe(false);
    expect(first?.pressure).toBeGreaterThanOrEqual(KILL_PRESSURE);
    expect(eliminated).toEqual([1]);
    expect(game.match.remaining()).toBe(100);
    expect(game.hud().remaining).toBe(100);
  });

  it('does not target eliminated sims', () => {
    const sims = [
      { id: 1, alive: false, pressure: 100 },
      { id: 2, alive: true, pressure: 0 },
      { id: 3, alive: true, pressure: 100 },
    ];
    expect(pickSimIds(sims, 4, () => 0)).toEqual([2]);
    const actions = jammersFromEvent({ type: 'boardCleared' }, sims, () => 0);
    expect(actions.map((action) => action.targetId)).toEqual([2]);
    const ghost = jammersFromEvent({ type: 'ghostEaten', ghostId: 'blinky', strength: 4, combo: 4 }, sims, () => 0);
    expect(ghost.map((action) => action.targetId)).toEqual([2]);
  });

  it('does not send a later ghost or clear attack at a sim that is already out', () => {
    const game = new Game(() => 0);
    const sent: number[][] = [];
    game.bus.on('jammersSent', (event) => {
      if (event.reason === 'sim') return;
      sent.push([...event.targets]);
    });
    game.bus.emit({ type: 'ghostEaten', ghostId: 'blinky', strength: 1, combo: 1 });
    game.bus.emit({ type: 'ghostEaten', ghostId: 'pinky', strength: 2, combo: 2 });
    const fallen = game.sims.sims[0];
    if (!fallen) throw new Error('missing sim');
    expect(fallen.alive).toBe(false);
    const pressure = fallen.pressure;
    const before = sent.length;

    game.bus.emit({ type: 'ghostEaten', ghostId: 'inky', strength: 1, combo: 1 });
    game.bus.emit({ type: 'boardCleared' });
    expect(fallen.alive).toBe(false);
    expect(fallen.pressure).toBe(pressure);
    expect(sent.length).toBeGreaterThan(before);
    for (const targets of sent.slice(before)) expect(targets).not.toContain(fallen.id);
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
    expect(first.pressure).toBeLessThan(80 - SIM_CLEAR_RELIEF + SIM_PRESSURE);
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

  it('wins when the last sim is eliminated and loses when pac dies', () => {
    const game = new Game(() => 0);
    for (const sim of game.sims.sims) sim.alive = false;
    const last = game.sims.sims[9];
    if (!last) throw new Error('missing sim');
    last.alive = true;
    game.bus.emit({ type: 'ghostEaten', ghostId: 'clyde', strength: 4, combo: 4 });
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
