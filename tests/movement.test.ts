import { describe, expect, it } from 'vitest';
import { Maze } from '../src/gameplay/maze';
import { advanceMover, applyQueuedTurn, type Mover } from '../src/gameplay/movement';
import { DIR_LEFT, DIR_UP } from '../src/shared/types';

describe('movement', () => {
  const maze = new Maze();
  const blocked = (x: number, y: number) => maze.blocks(x, y, 'pac');

  it('stops pac against a wall', () => {
    const mover: Mover = { x: 14, y: 23, dir: { ...DIR_UP }, queued: null };
    advanceMover(mover, 1, 8, blocked, maze.tunnelRow, maze.cols, () => applyQueuedTurn(mover, blocked));
    expect(mover.x).toBe(14);
    expect(mover.y).toBe(23);
  });

  it('walks down an open corridor', () => {
    const mover: Mover = { x: 14, y: 23, dir: { ...DIR_LEFT }, queued: null };
    advanceMover(mover, 0.5, 8, blocked, maze.tunnelRow, maze.cols, () => applyQueuedTurn(mover, blocked));
    expect(mover.x).toBeLessThan(14);
    expect(mover.y).toBe(23);
  });

  it('reverses immediately and turns at a corner', () => {
    const mover: Mover = { x: 10, y: 23, dir: { ...DIR_LEFT }, queued: { ...DIR_LEFT } };
    mover.queued = { x: 1, y: 0 };
    advanceMover(mover, 0.05, 8, blocked, maze.tunnelRow, maze.cols, () => applyQueuedTurn(mover, blocked));
    expect(mover.dir.x).toBe(1);
    expect(mover.x).toBeGreaterThan(10);

    mover.x = 6;
    mover.y = 23;
    mover.dir = { ...DIR_LEFT };
    mover.queued = { ...DIR_UP };
    advanceMover(mover, 0.2, 8, blocked, maze.tunnelRow, maze.cols, () => applyQueuedTurn(mover, blocked));
    expect(mover.dir.y).toBe(-1);
    expect(mover.y).toBeLessThan(23);
  });
});
