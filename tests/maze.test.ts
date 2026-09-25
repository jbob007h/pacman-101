import { describe, expect, it } from 'vitest';
import { BOARD_W, BOARD_X, PAC_START, VIEW_H, VIEW_W } from '../src/config';
import { Maze, Tile } from '../src/gameplay/maze';
import { sleeperTiles } from '../src/gameplay/train';
import { panelRect } from '../src/render/layout';

describe('maze', () => {
  const maze = new Maze();

  it('is a connected 28×31 board with four power pellets', () => {
    expect(maze.cols).toBe(28);
    expect(maze.rows).toBe(31);
    expect(maze.pelletCount()).toBe(4);
    expect(maze.dotCount()).toBeGreaterThan(200);
    expect(maze.remaining()).toBe(maze.dotCount() + maze.pelletCount());
  });

  it('wraps only on the tunnel row and keeps the ghost door closed to pac', () => {
    expect(maze.blocks(-1, maze.tunnelRow, 'pac')).toBe(false);
    expect(maze.blocks(maze.cols, maze.tunnelRow, 'pac')).toBe(false);
    expect(maze.blocks(-1, maze.tunnelRow - 1, 'pac')).toBe(true);
    expect(maze.blocks(13, 12, 'pac')).toBe(true);
    expect(maze.blocks(14, 12, 'eyes')).toBe(false);
    expect(maze.blocks(14, 23, 'pac')).toBe(false);
    for (let x = 0; x < maze.cols; x++) {
      const tile = maze.tile(x, maze.tunnelRow);
      expect(tile === Tile.Dot || tile === Tile.Pellet).toBe(false);
    }
    expect(maze.inSideTunnel(1, maze.tunnelRow)).toBe(true);
    expect(maze.inSideTunnel(14, maze.tunnelRow)).toBe(false);
    expect(maze.blocks(14, 17, 'pac')).toBe(false);
    const counted = new Maze();
    expect(counted.dotCount()).toBe(216);
    expect(counted.pelletCount()).toBe(4);
    const opened = [
      [6, 9],
      [21, 9],
      [13, 5],
      [14, 5],
      [12, 9],
      [12, 10],
      [15, 9],
      [15, 10],
      [6, 19],
      [21, 19],
      [12, 18],
      [12, 19],
      [15, 18],
      [15, 19],
      [13, 29],
      [14, 29],
    ] as const;
    for (const [x, y] of opened) {
      expect(counted.tile(x, y)).toBe(Tile.Empty);
      expect(counted.blocks(x, y, 'pac')).toBe(false);
    }
    for (const tile of sleeperTiles()) {
      expect(counted.tile(tile.x, tile.y)).toBe(Tile.Empty);
    }
    const spawnY = Math.round(PAC_START.y);
    expect(counted.consume(Math.floor(PAC_START.x), spawnY)).toBe('dot');
    expect(counted.consume(Math.ceil(PAC_START.x), spawnY)).toBe('dot');
    expect(counted.remaining()).toBe(218);
    counted.resetDots();
    expect(counted.remaining()).toBe(220);
    for (const [x, y] of opened) {
      expect(counted.tile(x, y)).toBe(Tile.Empty);
      expect(counted.blocks(x, y, 'pac')).toBe(false);
    }
    for (const tile of sleeperTiles()) {
      expect(counted.tile(tile.x, tile.y)).toBe(Tile.Empty);
    }
    for (let y = 11; y <= 17; y++) {
      for (let x = 9; x <= 18; x++) {
        const tile = maze.tile(x, y);
        expect(tile === Tile.Dot || tile === Tile.Pellet).toBe(false);
      }
    }
  });
});

describe('side boards', () => {
  it('places 50 panels on each side of the main maze', () => {
    for (let id = 1; id <= 100; id++) {
      const rect = panelRect(id);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(VIEW_W + 0.01);
      expect(rect.y + rect.h).toBeLessThanOrEqual(VIEW_H + 0.01);
      if (id <= 50) expect(rect.x + rect.w).toBeLessThanOrEqual(BOARD_X);
      else expect(rect.x).toBeGreaterThanOrEqual(BOARD_X + BOARD_W);
    }
    expect(panelRect(1).x).toBe(0);
    expect(panelRect(1).y).toBe(0);
    expect(panelRect(51).x).toBeGreaterThan(panelRect(50).x);
    expect(new Set(Array.from({ length: 100 }, (_, i) => `${panelRect(i + 1).x},${panelRect(i + 1).y}`)).size).toBe(100);
  });
});
