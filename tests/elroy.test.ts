import { describe, expect, it } from 'vitest';
import { CLEAR_SPEED_BONUS, ELROY2_MULT, elroyLevel, elroyThresholds, FRUIT_TILE, speedsForBoard } from '../src/config';
import { Game } from '../src/game';
import { ghostMoveSpeed, updateGhost, type Ghost } from '../src/gameplay/ghosts';
import { Tile, type Maze } from '../src/gameplay/maze';
import { DIR_UP } from '../src/shared/types';

describe('Cruise Elroy', () => {
  it('raises the pellet thresholds on later boards and caps them', () => {
    expect(elroyThresholds(0)).toEqual({ elroy1: 20, elroy2: 10 });
    expect(elroyThresholds(1)).toEqual({ elroy1: 30, elroy2: 15 });
    expect(elroyThresholds(2)).toEqual({ elroy1: 40, elroy2: 20 });
    expect(elroyThresholds(3)).toEqual({ elroy1: 50, elroy2: 20 });
    expect(elroyThresholds(4)).toEqual({ elroy1: 60, elroy2: 20 });
    expect(elroyThresholds(12)).toEqual(elroyThresholds(4));

    expect(elroyLevel(0, 21)).toBe(0);
    expect(elroyLevel(0, 20)).toBe(1);
    expect(elroyLevel(0, 11)).toBe(1);
    expect(elroyLevel(0, 10)).toBe(2);
    expect(elroyLevel(1, 20)).toBe(1);
    expect(elroyLevel(1, 15)).toBe(2);
  });

  it('matches Pac at Elroy 1 and goes faster at Elroy 2, including through a tunnel', () => {
    const speeds = speedsForBoard(0);
    const pace = speeds.pac + 0.35;
    expect(ghostMoveSpeed('chase', false, speeds, false, 1, pace)).toBeCloseTo(pace);
    expect(ghostMoveSpeed('scatter', false, speeds, false, 2, pace)).toBeCloseTo(pace * ELROY2_MULT);
    expect(ghostMoveSpeed('scatter', false, speeds, false, 2, pace)).toBeGreaterThan(pace);
    expect(ghostMoveSpeed('frightened', false, speeds, false, 2, pace)).toBe(speeds.fright);
    expect(ghostMoveSpeed('chase', false, speeds, true, 1, pace)).toBeCloseTo(pace * 0.55);
    expect(ghostMoveSpeed('chase', false, speeds, false, 0, pace)).toBe(speeds.ghost);
  });

  it('keeps Blinky on Pac during scatter once Elroy is on, and drops Elroy when the fruit refills', () => {
    const game = new Game(() => 0);
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    aim(blinky, game.board.maze, 0);
    expect(blinky.dir.x).toBe(1);

    aim(blinky, game.board.maze, 1);
    expect(blinky.dir.x).toBe(-1);

    for (const ghost of game.board.ghosts) {
      ghost.mode = 'house';
      ghost.releaseAt = 1e9;
    }
    while (game.board.maze.remaining() > 10) {
      const spot = firstPellet(game.board.maze);
      if (!spot) break;
      game.board.maze.consume(spot.x, spot.y);
    }
    game.board.boardIndex = 2;
    expect(elroyLevel(game.board.boardIndex, game.board.maze.remaining())).toBe(2);
    game.board.fruit = { ...FRUIT_TILE };
    game.board.pac.dir = { x: -1, y: 0 };
    game.board.pac.x = FRUIT_TILE.x;
    game.board.pac.y = FRUIT_TILE.y;
    game.update(1 / 60);
    expect(game.board.boardIndex).toBe(3);
    expect(game.board.maze.remaining()).toBeGreaterThan(60);
    expect(elroyLevel(game.board.boardIndex, game.board.maze.remaining())).toBe(0);
  });

  it('keeps Elroy and the other ghosts on the board pace when Pac has a clear bonus', () => {
    const game = new Game(() => 0.5);
    const blinky = game.board.ghosts[0];
    const pinky = game.board.ghosts[1];
    if (!blinky || !pinky) throw new Error('missing ghosts');
    while (game.board.maze.remaining() > 20) {
      const spot = firstPellet(game.board.maze);
      if (!spot) break;
      game.board.maze.consume(spot.x, spot.y);
    }
    expect(elroyLevel(0, game.board.maze.remaining())).toBe(1);
    game.board.clearBoost = 4;
    for (const ghost of game.board.ghosts) {
      ghost.mode = 'chase';
      ghost.releaseAt = 1e9;
    }
    blinky.x = 8;
    blinky.y = 5;
    blinky.dir = { x: 1, y: 0 };
    blinky.centerKey = -1;
    pinky.x = 12;
    pinky.y = 5;
    pinky.dir = { x: 1, y: 0 };
    pinky.centerKey = -1;
    game.board.pac.x = 14;
    game.board.pac.y = 23;
    game.board.pac.dir = { x: -1, y: 0 };
    const blinkyX = blinky.x;
    const pinkyX = pinky.x;
    game.update(1 / 60);
    const base = speedsForBoard(0).pac;
    const boosted = base + 4 * CLEAR_SPEED_BONUS;
    expect(blinky.x - blinkyX).toBeCloseTo(base / 60);
    expect(Math.abs(blinky.x - blinkyX - boosted / 60)).toBeGreaterThan(0.05);
    expect(pinky.x - pinkyX).toBeCloseTo(speedsForBoard(0).ghost / 60);
    expect(game.board.pacSpeed()).toBeCloseTo(boosted);
  });
});

function aim(blinky: Ghost, maze: Maze, elroy: 0 | 1 | 2): void {
  blinky.x = 10;
  blinky.y = 5;
  blinky.mode = 'scatter';
  blinky.dir = { ...DIR_UP };
  blinky.centerKey = -1;
  blinky.reversePending = false;
  updateGhost(blinky, {
    dt: 1 / 60,
    time: 30,
    maze,
    wave: 'scatter',
    frightenedLeft: 0,
    incoming: false,
    speeds: speedsForBoard(0),
    pacX: 1,
    pacY: 5,
    pacDir: { x: -1, y: 0 },
    blinkyX: blinky.x,
    blinkyY: blinky.y,
    rng: () => 0,
    elroy,
    pacPace: speedsForBoard(0).pac,
  });
}

function firstPellet(maze: Maze): { x: number; y: number } | null {
  for (let y = 0; y < maze.rows; y++) {
    for (let x = 0; x < maze.cols; x++) {
      const tile = maze.tile(x, y);
      if (tile === Tile.Dot || tile === Tile.Pellet) return { x, y };
    }
  }
  return null;
}
