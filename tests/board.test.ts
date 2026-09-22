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
});

function steer(x: number, y: number): Dir {
  if (y > 20.2 && x > 6.1) return { ...DIR_LEFT };
  if (x > 5.8 && y > 20.1) return { ...DIR_UP };
  if (y < 20.4 && x > 1.1) return { ...DIR_LEFT };
  return { ...DIR_DOWN };
}
