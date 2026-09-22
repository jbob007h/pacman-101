import { describe, expect, it } from 'vitest';
import { TILE } from '../src/config';
import { Maze, Tile } from '../src/gameplay/maze';
import { TRAIN_CALM_SCALE } from '../src/gameplay/train';
import { ghostDrawMode, jammerSpawnScale, SPRITE_SCALE, trainFollowerLook, wallFill } from '../src/render/draw';

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

  it('starts a jammer spawn large and pulses before settling at normal size', () => {
    expect(jammerSpawnScale(0)).toBeGreaterThan(1.4);
    expect(jammerSpawnScale(1)).toBeCloseTo(1, 5);
    const high = jammerSpawnScale(1 / 24);
    const low = jammerSpawnScale(3 / 24);
    expect(high).toBeGreaterThan(1.2);
    expect(low).toBeGreaterThan(1);
    expect(high - low).toBeGreaterThan(0.3);
  });

  it('paints house ghosts blue only for a pellet they are not skipping', () => {
    expect(ghostDrawMode('house', false, 9)).toBe('frightened');
    expect(ghostDrawMode('entering', false, 9)).toBe('frightened');
    expect(ghostDrawMode('leaving', false, 9)).toBe('frightened');
    expect(ghostDrawMode('house', true, 9)).toBe('house');
    expect(ghostDrawMode('entering', true, 9)).toBe('entering');
    expect(ghostDrawMode('leaving', true, 9)).toBe('leaving');
    expect(ghostDrawMode('house', false, 0)).toBe('house');
    expect(ghostDrawMode('eaten', false, 9)).toBe('eaten');
    expect(ghostDrawMode('chase', false, 9)).toBe('chase');
    expect(ghostDrawMode('frightened', true, 9)).toBe('frightened');
  });

  it('draws calm train followers at half size and frightened ones full blue', () => {
    expect(TRAIN_CALM_SCALE).toBe(0.5);
    expect(trainFollowerLook(false)).toEqual({ mode: 'chase', scale: 0.5 });
    expect(trainFollowerLook(true)).toEqual({ mode: 'frightened', scale: 1 });
  });
});
