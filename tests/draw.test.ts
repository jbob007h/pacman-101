import { describe, expect, it } from 'vitest';
import { TILE } from '../src/config';
import { Maze, Tile } from '../src/gameplay/maze';
import { SPRITE_SCALE, wallFill } from '../src/render/draw';

describe('maze wall paint', () => {
  const maze = new Maze();

  it('keeps interior solid blocks full and insets corridor walls by half a tile', () => {
    expect(SPRITE_SCALE).toBe(2);

    // Outer rim above a corridor: paint only the top half, away from the lane.
    const openBelow = wallFill(maze, 1, 0);
    expect(openBelow).toMatchObject({ x: 0, y: 0, w: TILE, h: TILE / 2 });
    expect(openBelow.edge.bottom).toBe(true);

    // Left border next to the playable lane: paint only the left half.
    const openRight = wallFill(maze, 0, 1);
    expect(openRight).toMatchObject({ x: 0, y: 0, w: TILE / 2, h: TILE });
    expect(openRight.edge.right).toBe(true);

    let half = 0;
    let full = 0;
    for (let y = 0; y < maze.rows; y++) {
      for (let x = 0; x < maze.cols; x++) {
        if (maze.tile(x, y) !== Tile.Wall) continue;
        const fill = wallFill(maze, x, y);
        if (fill.w === TILE && fill.h === TILE) full += 1;
        else {
          half += 1;
          expect(fill.w).toBeLessThanOrEqual(TILE);
          expect(fill.h).toBeLessThanOrEqual(TILE);
          expect(fill.w === TILE && fill.h === TILE).toBe(false);
        }
      }
    }
    expect(half).toBeGreaterThan(40);
    expect(full).toBeGreaterThan(10);
  });
});
