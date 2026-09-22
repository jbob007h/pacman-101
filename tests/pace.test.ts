import { describe, expect, it } from 'vitest';
import { CLEAR_SPEED_BONUS, DOT_SCORE, EAT_GHOST_PAUSE, FRUIT_TILE, speedsForBoard, TUNNEL_GHOST_MULT } from '../src/config';
import { Game } from '../src/game';
import { ghostMoveSpeed, ghostSpeed } from '../src/gameplay/ghosts';
import { Tile } from '../src/gameplay/maze';

describe('board pace', () => {
  it('starts slower than later boards, with ghosts behind Pac and a deep frightened crawl', () => {
    const first = speedsForBoard(0);
    const second = speedsForBoard(1);
    const capped = speedsForBoard(20);

    expect(first.board).toBe(1);
    expect(first.pac).toBeCloseTo(9.6);
    expect(first.ghost).toBeCloseTo(6.75);
    expect(first.fright).toBeCloseTo(3.075);
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

  it('leaves the maze empty on a full clear and reloads dots only when the fruit is eaten', () => {
    const game = new Game(() => 0);
    for (const ghost of game.board.ghosts) {
      ghost.mode = 'house';
      ghost.releaseAt = 1e9;
    }
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
    const before = speedsForBoard(0).pac;
    game.update(1 / 60);
    expect(game.board.boardIndex).toBe(0);
    expect(game.board.clearBoost).toBe(1);
    expect(game.board.pacSpeed()).toBeCloseTo(before + CLEAR_SPEED_BONUS);
    expect(game.board.displayedSpeed).toBe(1);
    expect(game.hud().board).toBe(1);
    expect(game.hud().speed).toBe(1);
    expect(maze.remaining()).toBe(0);
    expect(game.board.fruit).toEqual(FRUIT_TILE);

    while (game.board.clearPause > 0) game.update(0.05);
    expect(maze.remaining()).toBe(0);
    expect(game.board.fruit).toEqual(FRUIT_TILE);

    game.board.pac.x = FRUIT_TILE.x;
    game.board.pac.y = FRUIT_TILE.y;
    game.update(1 / 60);
    expect(game.board.boardIndex).toBe(1);
    expect(maze.remaining()).toBeGreaterThan(1);
    expect(game.board.clearBoost).toBe(1);
    expect(game.board.displayedSpeed).toBe(1);
    expect(game.board.fruit).toBeNull();
  });

  it('spawns one fruit under the ghost house at half the pellets, and fruit advances the board', () => {
    const game = new Game(() => 0);
    const board = game.board;
    const budget = board.maze.remaining();
    const half = Math.ceil(budget / 2);
    const trigger = findPellet(board.maze, (x, y) => !(x === FRUIT_TILE.x && y === FRUIT_TILE.y));
    if (!trigger) throw new Error('missing pellet');
    leavePellets(board.maze, half, trigger);
    expect(board.fruit).toBeNull();

    board.pac.dir = { x: -1, y: 0 };
    board.pac.x = trigger.x;
    board.pac.y = trigger.y;
    game.update(1 / 60);
    expect(board.fruit).toEqual(FRUIT_TILE);
    expect(board.maze.tile(FRUIT_TILE.x, FRUIT_TILE.y)).not.toBe(Tile.Wall);

    board.pac.x = FRUIT_TILE.x;
    board.pac.y = FRUIT_TILE.y;
    game.update(1 / 60);
    expect(board.boardIndex).toBe(1);
    expect(board.displayedSpeed).toBe(0);
    expect(board.fruit).toBeNull();
    expect(game.hud().speed).toBe(0);
    expect(game.hud().board).toBe(2);

    const second = new Game(() => 0);
    second.board.boardIndex = 1;
    const pellet = findPellet(second.board.maze, () => true);
    if (!pellet) throw new Error('missing pellet');
    second.board.fruit = { ...FRUIT_TILE };
    second.board.pac.dir = { x: -1, y: 0 };
    second.board.pac.x = FRUIT_TILE.x;
    second.board.pac.y = FRUIT_TILE.y;
    second.update(1 / 60);
    expect(second.board.boardIndex).toBe(2);
    expect(second.board.displayedSpeed).toBe(1);
    expect(second.hud().speed).toBe(1);
    expect(second.board.clearBoost).toBe(0);
  });

  it('slows chase and frightened ghosts in the side tunnel and leaves eyes alone', () => {
    const speeds = speedsForBoard(0);
    expect(ghostMoveSpeed('chase', false, speeds, true)).toBeCloseTo(speeds.ghost * TUNNEL_GHOST_MULT);
    expect(ghostMoveSpeed('frightened', true, speeds, true)).toBeCloseTo(speeds.fright * TUNNEL_GHOST_MULT);
    expect(ghostMoveSpeed('eaten', false, speeds, true)).toBe(ghostSpeed('eaten', false, speeds));
    expect(ghostMoveSpeed('chase', false, speeds, false)).toBe(speeds.ghost);

    const game = new Game(() => 0);
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    blinky.mode = 'chase';
    blinky.x = 2;
    blinky.y = game.board.maze.tunnelRow;
    blinky.dir = { x: -1, y: 0 };
    const outside = game.board.ghosts[1];
    if (!outside) throw new Error('missing pinky');
    outside.mode = 'chase';
    outside.x = 14;
    outside.y = 23;
    outside.dir = { x: -1, y: 0 };
    game.board.pac.dir = { x: -1, y: 0 };
    game.update(1 / 60);
    const tunnelTravel = Math.abs(blinky.x - 2);
    const openTravel = Math.abs(outside.x - 14);
    expect(tunnelTravel).toBeGreaterThan(0);
    expect(tunnelTravel).toBeLessThan(openTravel * 0.75);
  });

  it('stops Pac for one frame after a dot and three frames after a power pellet', () => {
    const dot = new Game(() => 0);
    parkGhosts(dot);
    dot.board.pac.x = 5;
    dot.board.pac.y = 5;
    dot.board.pac.dir = { x: 1, y: 0 };
    const blinky = dot.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    blinky.mode = 'chase';
    blinky.x = 10;
    blinky.y = 8;
    blinky.dir = { x: 1, y: 0 };

    dot.update(1 / 60);
    const eatenX = dot.board.pac.x;
    expect(eatenX).toBeGreaterThan(5);
    expect(dot.board.score).toBe(DOT_SCORE);
    const ghostX = blinky.x;

    dot.update(1 / 60);
    expect(dot.board.pac.x).toBe(eatenX);
    expect(dot.board.score).toBe(DOT_SCORE);
    expect(blinky.x).not.toBe(ghostX);

    dot.update(1 / 60);
    expect(dot.board.pac.x).toBeGreaterThan(eatenX);

    const power = new Game(() => 0);
    parkGhosts(power);
    power.board.pac.x = 1;
    power.board.pac.y = 23;
    power.board.pac.dir = { x: 1, y: 0 };
    power.update(1 / 60);
    const held = power.board.pac.x;
    expect(held).toBeGreaterThan(1);
    expect(power.board.frightened).toBeGreaterThan(0);
    for (let frame = 0; frame < 3; frame++) {
      power.update(1 / 60);
      expect(power.board.pac.x).toBe(held);
    }
    power.update(1 / 60);
    expect(power.board.pac.x).toBeGreaterThan(held);
  });
});

function parkGhosts(game: Game): void {
  for (const ghost of game.board.ghosts) {
    ghost.mode = 'house';
    ghost.releaseAt = 1e9;
  }
}

function findPellet(
  maze: Game['board']['maze'],
  accept: (x: number, y: number) => boolean,
): { x: number; y: number } | null {
  for (let y = 0; y < maze.rows; y++) {
    for (let x = 0; x < maze.cols; x++) {
      const tile = maze.tile(x, y);
      if ((tile === Tile.Dot || tile === Tile.Pellet) && accept(x, y)) return { x, y };
    }
  }
  return null;
}

function leavePellets(maze: Game['board']['maze'], keep: number, anchor: { x: number; y: number }): void {
  let left = maze.remaining();
  for (let y = 0; y < maze.rows && left > keep; y++) {
    for (let x = 0; x < maze.cols && left > keep; x++) {
      if (x === anchor.x && y === anchor.y) continue;
      if (maze.consume(x, y)) left -= 1;
    }
  }
}
