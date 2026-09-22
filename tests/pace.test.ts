import { describe, expect, it } from 'vitest';
import { EAT_GHOST_PAUSE, speedsForBoard } from '../src/config';
import { Game } from '../src/game';
import { ghostSpeed } from '../src/gameplay/ghosts';

describe('board pace', () => {
  it('starts slower than later boards, with ghosts behind Pac and a deep frightened crawl', () => {
    const first = speedsForBoard(0);
    const second = speedsForBoard(1);
    const capped = speedsForBoard(20);

    expect(first.board).toBe(1);
    expect(first.ghost).toBeLessThan(first.pac * 0.8);
    expect(first.fright).toBeLessThan(first.ghost * 0.5);
    expect(second.pac).toBeGreaterThan(first.pac);
    expect(second.ghost).toBeGreaterThan(first.ghost);
    expect(second.fright).toBeLessThan(second.ghost * 0.5);
    expect(capped).toEqual(speedsForBoard(5));
    expect(ghostSpeed('frightened', true, first)).toBe(first.fright);
    expect(ghostSpeed('chase', false, first)).toBe(first.ghost);
    expect(ghostSpeed('chase', false, first)).toBeLessThan(first.pac);
  });

  it('freezes the maze briefly after a ghost is eaten, then lets an eaten ghost move', () => {
    const game = new Game(() => 0);
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    game.board.pac.dir = { x: -1, y: 0 };
    game.board.pac.x = 14;
    game.board.pac.y = 23;
    blinky.mode = 'frightened';
    blinky.x = game.board.pac.x;
    blinky.y = game.board.pac.y;
    game.board.frightened = 5;

    game.update(1 / 60);
    expect(game.board.eatPause).toBe(EAT_GHOST_PAUSE);
    expect(blinky.mode).toBe('eaten');
    const pacX = game.board.pac.x;
    const ghostX = blinky.x;
    const fright = game.board.frightened;

    game.update(0.05);
    expect(game.board.pac.x).toBe(pacX);
    expect(blinky.x).toBe(ghostX);
    expect(game.board.frightened).toBe(fright);
    expect(game.board.eatPause).toBeGreaterThan(0);

    while (game.board.eatPause > 0) game.update(0.05);
    const beforeX = blinky.x;
    const beforeY = blinky.y;
    game.update(1 / 60);
    expect(Math.hypot(blinky.x - beforeX, blinky.y - beforeY)).toBeGreaterThan(0.01);
  });

  it('advances the board and raises the pace when the maze is cleared', () => {
    const game = new Game(() => 0);
    const maze = game.board.maze;
    const target = { x: 13, y: 23 };
    for (let y = 0; y < maze.rows; y++) {
      for (let x = 0; x < maze.cols; x++) {
        if (x === target.x && y === target.y) continue;
        maze.consume(x, y);
      }
    }
    expect(maze.remaining()).toBe(1);
    game.board.pac.dir = { x: 0, y: -1 };
    game.board.pac.x = target.x;
    game.board.pac.y = target.y;
    const before = game.board.speeds().pac;
    game.update(1 / 60);
    expect(game.board.boardIndex).toBe(1);
    expect(game.board.speeds().board).toBe(2);
    expect(game.board.speeds().pac).toBeGreaterThan(before);
    expect(game.hud().board).toBe(2);
  });
});
