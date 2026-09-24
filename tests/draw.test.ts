import { describe, expect, it } from 'vitest';
import { TILE, VIEW_H, VIEW_W } from '../src/config';
import { Maze, Tile } from '../src/gameplay/maze';
import { TRAIN_CALM_SCALE } from '../src/gameplay/train';
import type { DrawInput } from '../src/render/draw';
import {
  drawFrame,
  ghostDrawMode,
  jammerSpawnScale,
  SPEED_POPUP_TEXT,
  SPRITE_SCALE,
  trainFollowerLook,
  wallFill,
} from '../src/render/draw';
import { panelRect } from '../src/render/layout';
import type { Sim } from '../src/systems/sims';

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

describe('playfield layer order', () => {
  it('paints side grids first and leaves Speed Up unclipped so it covers them', () => {
    const log: { kind: string; clipped: boolean; text?: string }[] = [];
    const ctx = recordingContext(log);
    drawFrame(ctx, frameAtTunnel());

    const panel = log.findIndex((entry) => entry.kind === 'panel');
    const popup = log.find((entry) => entry.kind === 'text' && entry.text === SPEED_POPUP_TEXT);
    const eat = log.find((entry) => entry.kind === 'text' && entry.text === '4');
    const bolt = log.findIndex((entry) => entry.kind === 'bolt');
    expect(panel).toBeGreaterThanOrEqual(0);
    expect(popup).toBeDefined();
    expect(popup?.clipped).toBe(false);
    expect(log.indexOf(popup!)).toBeGreaterThan(panel);
    expect(eat?.clipped).toBe(false);
    expect(log.indexOf(eat!)).toBeGreaterThan(panel);
    expect(bolt).toBeGreaterThan(panel);
    expect(log[bolt]?.clipped).toBe(false);
  });
});

function frameAtTunnel(): DrawInput {
  const maze = new Maze();
  const sim: Sim = {
    id: 5,
    name: 'grid',
    alive: true,
    pressure: 40,
    heat: 0,
    busy: 0,
    relief: 0,
    lock: 0,
    phase: 0,
    attackIn: 1,
    parked: false,
    showName: false,
  };
  return {
    maze,
    pac: { x: 0.2, y: maze.tunnelRow, dir: { x: -1, y: 0 }, queued: null, alive: true, anim: 1 },
    ghosts: [],
    sims: [sim],
    bolts: [{ sx: 400, sy: 200, tx: panelRect(5).x + 10, ty: panelRect(5).y + 10, t: 0.2, duration: 0.36, scale: 1 }],
    incoming: [],
    particles: [],
    shake: 0,
    mazeFlash: 0,
    frightened: 0,
    deathTime: 0,
    time: 0.4,
    eatPause: 0.2,
    eatPoints: 200,
    speedPopup: 1,
    eatPopup: 1,
    eatPopupCount: 4,
    eatPopupX: 0.2,
    eatPopupY: maze.tunnelRow,
    sleepers: [],
    train: [],
    trainLeaderId: null,
    fruit: null,
    jammers: [],
    slow: 0,
  };
}

function recordingContext(log: { kind: string; clipped: boolean; text?: string }[]): CanvasRenderingContext2D {
  let clipped = 0;
  const stack: number[] = [];
  const ctx = {
    canvas: { width: VIEW_W, height: VIEW_H },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    lineJoin: 'miter',
    miterLimit: 10,
    lineCap: 'butt',
    getTransform: () => ({ a: 1, d: 1 }),
    save: () => stack.push(clipped),
    restore: () => {
      clipped = stack.pop() ?? 0;
    },
    clip: () => {
      clipped += 1;
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      const panel = panelRect(5);
      if (x === panel.x && y === panel.y && w === panel.w && h === panel.h) {
        log.push({ kind: 'panel', clipped: clipped > 0 });
      }
    },
    fillText: (text: string) => {
      log.push({ kind: 'text', clipped: clipped > 0, text });
    },
    arc: (x: number, _y: number, radius: number) => {
      if (radius === 3.2 && x > 0) log.push({ kind: 'bolt', clipped: clipped > 0 });
    },
  };
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop in target) return target[prop as keyof typeof target];
      return () => undefined;
    },
  }) as unknown as CanvasRenderingContext2D;
}
