import { describe, expect, it } from 'vitest';
import { CLEAR_SPEED_BONUS, FRUIT_TILE, SPEED_POPUP_SECONDS, speedsForBoard } from '../src/config';
import { Game } from '../src/game';
import { SPEED_POPUP_TEXT, speedPopupPose } from '../src/render/draw';

const LAST = { x: 5, y: 5 };

describe('full clear Speed', () => {
  it('bounces the Speed Up callout and then fades it', () => {
    expect(SPEED_POPUP_TEXT).toBe('Speed Up!');
    const born = speedPopupPose(SPEED_POPUP_SECONDS);
    const hop = speedPopupPose(SPEED_POPUP_SECONDS * (5 / 6));
    expect(born.alpha).toBe(1);
    expect(hop.alpha).toBe(1);
    expect(hop.dy).toBeLessThan(born.dy);
    expect(hop.scaleY).toBeGreaterThan(born.scaleY);
    expect(speedPopupPose(0.02).alpha).toBeLessThan(0.2);
    expect(speedPopupPose(0).alpha).toBe(0);
  });

  it('goes 0→1→2 across two clears, and the fruit between them does not add a point', () => {
    const game = new Game(() => 0.99);
    park(game);
    expect(game.hud().speed).toBe(0);
    expect(game.board.speedPopup).toBe(0);

    eatAllBut(game, LAST);
    approach(game, LAST);
    expect(game.board.maze.remaining()).toBe(0);
    expect(game.hud().speed).toBe(1);
    expect(game.board.displayedSpeed).toBe(1);
    expect(game.board.clearBoost).toBe(1);
    expect(game.board.pacSpeed()).toBeCloseTo(speedsForBoard(0).pac + CLEAR_SPEED_BONUS);
    expect(game.board.speedPopup).toBe(SPEED_POPUP_SECONDS);
    expect(game.board.fruit).toEqual(FRUIT_TILE);
    expect(game.board.boardIndex).toBe(0);

    const popping = game.board.speedPopup;
    game.update(1 / 60);
    expect(game.board.clearPause).toBe(0);
    expect(game.board.speedPopup).toBeLessThan(popping);
    const x0 = game.board.pac.x;
    game.update(1 / 60);
    expect(game.board.pac.x).not.toBe(x0);
    expect(game.board.maze.remaining()).toBe(0);

    drain(game);
    game.board.pac.x = FRUIT_TILE.x;
    game.board.pac.y = FRUIT_TILE.y;
    game.board.pac.dir = { x: 1, y: 0 };
    const popupBeforeFruit = game.board.speedPopup;
    game.update(1 / 60);
    expect(game.board.boardIndex).toBe(1);
    expect(game.board.clearPause).toBe(0);
    expect(game.hud().speed).toBe(1);
    expect(game.board.clearBoost).toBe(1);
    expect(game.board.maze.remaining()).toBeGreaterThan(1);
    expect(game.board.speedPopup).toBeLessThan(popupBeforeFruit);

    drain(game);
    eatAllBut(game, LAST);
    approach(game, LAST);
    expect(game.board.maze.remaining()).toBe(0);
    expect(game.hud().speed).toBe(2);
    expect(game.board.displayedSpeed).toBe(2);
    expect(game.board.clearBoost).toBe(2);
    expect(game.board.boardIndex).toBe(1);
    expect(game.board.pacSpeed()).toBeCloseTo(speedsForBoard(1).pac + 2 * CLEAR_SPEED_BONUS);
    expect(game.board.speedPopup).toBe(SPEED_POPUP_SECONDS);
  });

  it('still grants Speed when the fruit was eaten before the board was cleared', () => {
    const game = new Game(() => 0.99);
    park(game);
    const budget = game.board.maze.remaining();
    const half = Math.ceil(budget / 2);
    eatAllBut(game, LAST, budget - half + 1);
    game.board.pac.x = LAST.x;
    game.board.pac.y = LAST.y;
    game.board.pac.dir = { x: 1, y: 0 };
    game.update(1 / 60);
    expect(game.board.fruit).toEqual(FRUIT_TILE);
    expect(game.hud().speed).toBe(0);
    expect(game.board.speedPopup).toBe(0);
    expect(game.board.maze.remaining()).toBeGreaterThan(0);

    game.board.pac.x = FRUIT_TILE.x;
    game.board.pac.y = FRUIT_TILE.y;
    game.update(1 / 60);
    expect(game.board.boardIndex).toBe(1);
    expect(game.hud().speed).toBe(0);
    expect(game.board.maze.remaining()).toBeGreaterThan(half);

    drain(game);
    eatAllBut(game, LAST);
    approach(game, LAST);
    expect(game.board.maze.remaining()).toBe(0);
    expect(game.hud().speed).toBe(1);
    expect(game.board.clearBoost).toBe(1);
    expect(game.board.speedPopup).toBe(SPEED_POPUP_SECONDS);
    expect(game.board.pacSpeed()).toBeCloseTo(speedsForBoard(1).pac + CLEAR_SPEED_BONUS);
  });
});

function park(game: Game): void {
  for (const ghost of game.board.ghosts) {
    ghost.mode = 'house';
    ghost.releaseAt = 1e9;
  }
}

function drain(game: Game): void {
  let guard = 0;
  while ((game.board.clearPause > 0 || game.board.eatPause > 0) && guard++ < 40) game.update(0.05);
}

/** Walk onto `tile` from the left so the pellet is eaten by movement. */
function approach(game: Game, tile: { x: number; y: number }): void {
  game.board.pac.x = tile.x - 1;
  game.board.pac.y = tile.y;
  game.board.pac.dir = { x: 1, y: 0 };
  game.board.pac.queued = null;
  for (let i = 0; i < 90 && game.board.maze.remaining() > 0; i++) game.update(1 / 60);
}

function eatAllBut(game: Game, anchor: { x: number; y: number }, keep = 1): void {
  const maze = game.board.maze;
  let left = maze.remaining();
  for (let y = 0; y < maze.rows && left > keep; y++) {
    for (let x = 0; x < maze.cols && left > keep; x++) {
      if (x === anchor.x && y === anchor.y) continue;
      if (maze.consume(x, y)) left -= 1;
    }
  }
}
