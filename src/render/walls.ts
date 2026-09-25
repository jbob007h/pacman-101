import { TILE } from '../config';
import type { Maze } from '../gameplay/maze';

export interface WallFill {
  /** Local offset inside the tile, in pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corridor-facing edges of the filled half (for the light rim). */
  edge: { left: boolean; right: boolean; top: boolean; bottom: boolean };
}

/**
 * Wall paint for one tile. Interior solid blocks stay full. A wall next to a
 * walkable corridor is inset toward the blocked side so only half the cell is
 * painted — corridors look wider, collision stays the same.
 */
export function wallFill(maze: Maze, x: number, y: number): WallFill {
  const openL = isWalkable(maze, x - 1, y);
  const openR = isWalkable(maze, x + 1, y);
  const openU = isWalkable(maze, x, y - 1);
  const openD = isWalkable(maze, x, y + 1);
  if (!openL && !openR && !openU && !openD) {
    return { x: 0, y: 0, w: TILE, h: TILE, edge: { left: false, right: false, top: false, bottom: false } };
  }
  let lx = 0;
  let ly = 0;
  let w = TILE;
  let h = TILE;
  if (openL) {
    lx += TILE / 2;
    w -= TILE / 2;
  }
  if (openR) w -= TILE / 2;
  if (openU) {
    ly += TILE / 2;
    h -= TILE / 2;
  }
  if (openD) h -= TILE / 2;
  if (w <= 0 || h <= 0) {
    return {
      x: TILE / 4,
      y: TILE / 4,
      w: TILE / 2,
      h: TILE / 2,
      edge: { left: openL, right: openR, top: openU, bottom: openD },
    };
  }
  return {
    x: lx,
    y: ly,
    w,
    h,
    edge: { left: openL, right: openR, top: openU, bottom: openD },
  };
}

function isWalkable(maze: Maze, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= maze.cols || y >= maze.rows) return false;
  return !maze.blocks(x, y, 'pac');
}
