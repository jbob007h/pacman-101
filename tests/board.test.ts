import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import type { Dir } from '../src/shared/types';
import { DIR_DOWN, DIR_LEFT, DIR_UP } from '../src/shared/types';

describe('main board', () => {
  it('can reach a power pellet, frighten ghosts, and emit ghostEaten', () => {
    const game = new Game(() => 0);
    const seen: string[] = [];
    game.bus.on('powerPelletEaten', () => seen.push('pellet'));
    game.bus.on('ghostEaten', (event) => seen.push(`ghost:${event.strength}`));

    for (const ghost of game.board.ghosts) {
      ghost.mode = 'house';
      ghost.x = 13;
      ghost.y = 14;
      ghost.releaseAt = 1e9;
    }

    let atePellet = false;
    for (let i = 0; i < 60 * 8 && !atePellet; i++) {
      game.board.pac.queued = steer(game.board.pac.x, game.board.pac.y);
      game.update(1 / 60);
      atePellet = seen.includes('pellet');
    }
    expect(atePellet).toBe(true);
    expect(game.board.pac.alive).toBe(true);
    expect(game.board.frightened).toBeGreaterThan(0);

    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    blinky.mode = 'frightened';
    blinky.x = game.board.pac.x;
    blinky.y = game.board.pac.y;
    game.update(1 / 60);
    expect(seen.some((event) => event.startsWith('ghost:'))).toBe(true);
    expect(game.sims.sims.some((sim) => sim.pressure > 0 || !sim.alive)).toBe(true);
  });

  it('lets an eaten ghost leave the house deadly while the same pellet is still running', () => {
    const game = new Game(() => 0.5);
    for (const ghost of game.board.ghosts) {
      ghost.mode = 'house';
      ghost.releaseAt = 1e9;
    }
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    blinky.mode = 'frightened';
    blinky.x = 5;
    blinky.y = 5;
    game.board.pac.x = 5;
    game.board.pac.y = 5;
    game.board.pac.dir = { x: 0, y: 0 };
    game.board.frightened = 9;
    game.update(0);
    expect(blinky.mode).toBe('eaten');
    expect(blinky.skipFright).toBe(true);

    blinky.mode = 'house';
    blinky.x = 14;
    blinky.y = 14;
    blinky.releaseAt = 0;
    blinky.dir = { x: 0, y: -1 };
    game.board.pac.x = 20;
    game.board.pac.y = 23;
    game.board.pac.dir = { x: -1, y: 0 };
    let mode: string = blinky.mode;
    for (let i = 0; i < 80 && mode !== 'chase'; i++) {
      game.update(1 / 60);
      mode = blinky.mode;
    }
    expect(blinky.mode).toBe('chase');
    expect(blinky.skipFright).toBe(true);
    expect(game.board.frightened).toBeGreaterThan(1);
    expect(game.board.pac.alive).toBe(true);

    game.board.pac.x = blinky.x;
    game.board.pac.y = blinky.y;
    game.board.pac.dir = { x: 0, y: 0 };
    game.update(0);
    expect(game.board.pac.alive).toBe(false);
    expect(game.board.frightened).toBeGreaterThan(1);
  });

  it('frightens a returned ghost only after another power pellet', () => {
    const game = new Game(() => 0.5);
    for (const ghost of game.board.ghosts) {
      ghost.mode = 'house';
      ghost.releaseAt = 1e9;
    }
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    blinky.mode = 'chase';
    blinky.skipFright = true;
    blinky.x = 14;
    blinky.y = 11;
    game.board.frightened = 9;
    game.board.pac.x = 1;
    game.board.pac.y = 23;
    game.board.pac.dir = { x: 1, y: 0 };
    game.update(1 / 60);
    expect(game.board.frightened).toBeGreaterThan(8);
    expect(blinky.skipFright).toBe(false);
    expect(blinky.mode).toBe('frightened');
  });
});

function steer(x: number, y: number): Dir {
  if (y > 20.2 && x > 6.1) return { ...DIR_LEFT };
  if (x > 5.8 && y > 20.1) return { ...DIR_UP };
  if (y < 20.4 && x > 1.1) return { ...DIR_LEFT };
  return { ...DIR_DOWN };
}
