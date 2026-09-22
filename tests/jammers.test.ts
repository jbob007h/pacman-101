import { describe, expect, it } from 'vitest';
import { GHOST_PRESSURE_BASE, GHOST_PRESSURE_STEP, KILL_PRESSURE } from '../src/config';
import { Game } from '../src/game';
import { jammersFromEvent, pickSimIds } from '../src/systems/jammers';
import { mulberry32 } from '../src/shared/rng';

describe('jammers', () => {
  it('stacks ghost eats onto a pressured sim until it is eliminated', () => {
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
    ];
    expect(pickSimIds(sims, 1, () => 0)).toEqual([2]);
    const actions = jammersFromEvent({ type: 'boardCleared' }, sims, () => 0);
    expect(actions.map((action) => action.targetId)).toEqual([2]);
  });

  it('drops the alive count as simulated opponents knock each other out', () => {
    const game = new Game(mulberry32(1));
    game.board.pac.dir = { x: -1, y: 0 };
    for (const ghost of game.board.ghosts) {
      ghost.mode = 'house';
      ghost.x = 13;
      ghost.y = 14;
      ghost.releaseAt = 1e9;
    }
    for (let i = 0; i < 600; i++) game.update(0.05);
    expect(game.sims.aliveCount()).toBeLessThan(100);
    expect(game.match.remaining()).toBe(1 + game.sims.aliveCount());
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
