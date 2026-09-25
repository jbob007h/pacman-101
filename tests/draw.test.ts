import { describe, expect, it } from 'vitest';
import { TILE, VIEW_H, VIEW_W } from '../src/config';
import { createGhosts } from '../src/gameplay/ghosts';
import type { InboundJammer, JammerKind } from '../src/gameplay/inbound';
import { Maze, Tile } from '../src/gameplay/maze';
import { TRAIN_CALM_SCALE } from '../src/gameplay/train';
import { DIR_LEFT } from '../src/shared/types';
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
import { setActiveTheme } from '../src/theme';
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
  it('keeps maze ghosts above jammers when the theme changes silhouettes', () => {
    setActiveTheme('deep-sea', false);
    try {
      const log: { kind: string; layer: string; clipped: boolean; text?: string; actor?: string }[] = [];
      const ctx = recordingContext(log);
      const input = frameAtTunnel();
      const ghosts = createGhosts();
      for (const ghost of ghosts) ghost.mode = ghost.id === 'inky' ? 'eaten' : 'chase';
      input.ghosts = ghosts;
      input.frightened = 5;
      input.jammers = [liveJammer('white', 4, 14), liveJammer('red', 10, 14)];
      drawFrame(ctx, input);
      const actors = log.filter((entry) => entry.kind === 'actor' && entry.layer === 'maze').map((entry) => entry.actor);
      const lastJammer = actors.lastIndexOf('jammer');
      const firstGhost = actors.findIndex((actor) => actor === 'ghost' || actor === 'eyes');
      expect(actors.filter((actor) => actor === 'jammer')).toHaveLength(2);
      expect(actors).toContain('eyes');
      expect(firstGhost).toBeGreaterThan(lastJammer);
      expect(actors.indexOf('pac')).toBeGreaterThan(firstGhost);
    } finally {
      setActiveTheme('classic', false);
    }
  });

  it('blits an unclipped overlay after the grids so Speed Up covers them', () => {
    const log: { kind: string; layer: string; clipped: boolean; text?: string }[] = [];
    const ctx = recordingContext(log);
    drawFrame(ctx, frameAtTunnel());

    const popup = log.find((entry) => entry.kind === 'text' && entry.text === SPEED_POPUP_TEXT);
    const eat = log.find((entry) => entry.kind === 'text' && entry.text === '4');
    const panel = log.find((entry) => entry.kind === 'panel');
    const bolt = log.find((entry) => entry.kind === 'bolt');
    const blits = log.filter((entry) => entry.kind === 'blit').map((entry) => entry.layer);
    expect(blits).toEqual(['panels', 'maze', 'overlay']);
    expect(panel?.layer).toBe('panels');
    expect(popup?.layer).toBe('overlay');
    expect(popup?.clipped).toBe(false);
    expect(eat?.layer).toBe('overlay');
    expect(eat?.clipped).toBe(false);
    expect(bolt?.layer).toBe('overlay');
    expect(bolt?.clipped).toBe(false);
    expect(log.some((entry) => entry.kind === 'clip' && entry.layer === 'maze')).toBe(true);
    expect(log.some((entry) => entry.kind === 'clip' && entry.layer === 'overlay')).toBe(false);
    expect(log.indexOf(popup!)).toBeGreaterThan(log.indexOf(panel!));
  });

  it('paints Blinky, Pinky, Inky, and Clyde above white and red jammers, with Pac still above the ghosts', () => {
    const log: { kind: string; layer: string; clipped: boolean; text?: string; actor?: string }[] = [];
    const ctx = recordingContext(log);
    const input = frameAtTunnel();
    const ghosts = createGhosts();
    const blinky = ghosts[0];
    const pinky = ghosts[1];
    const inky = ghosts[2];
    const clyde = ghosts[3];
    if (!blinky || !pinky || !inky || !clyde) throw new Error('missing ghosts');
    blinky.mode = 'chase';
    pinky.mode = 'frightened';
    inky.mode = 'eaten';
    clyde.mode = 'scatter';
    input.ghosts = ghosts;
    input.frightened = 5;
    input.jammers = [liveJammer('white', 4, 14), liveJammer('red', 10, 14)];
    drawFrame(ctx, input);

    const actors = log.filter((entry) => entry.kind === 'actor' && entry.layer === 'maze').map((entry) => entry.actor);
    const lastJammer = actors.lastIndexOf('jammer');
    const ghostMarks = actors
      .map((actor, index) => (actor === 'ghost' || actor === 'eyes' ? index : -1))
      .filter((index) => index >= 0);
    const firstGhost = ghostMarks[0] ?? -1;
    const lastGhost = ghostMarks[ghostMarks.length - 1] ?? -1;
    const pac = actors.indexOf('pac');
    expect(actors.filter((actor) => actor === 'jammer')).toHaveLength(2);
    expect(actors.filter((actor) => actor === 'ghost').length).toBeGreaterThanOrEqual(3);
    expect(actors).toContain('eyes');
    expect(firstGhost).toBeGreaterThan(lastJammer);
    expect(pac).toBeGreaterThan(lastGhost);

    const popup = log.find((entry) => entry.kind === 'text' && entry.text === SPEED_POPUP_TEXT);
    expect(popup?.layer).toBe('overlay');
    expect(popup?.clipped).toBe(false);
  });

  it('paints the power-mode list on the unclipped overlay', () => {
    const log: { kind: string; layer: string; clipped: boolean; text?: string }[] = [];
    const ctx = recordingContext(log);
    const input = frameAtTunnel();
    input.powerActive = 'stronger';
    input.powerQueued = 'speed';
    drawFrame(ctx, input);
    const standard = log.find((entry) => entry.text === '1  Standard');
    const next = log.find((entry) => entry.text === 'NEXT');
    const active = log.find((entry) => entry.text === 'ACTIVE');
    expect(standard?.layer).toBe('overlay');
    expect(standard?.clipped).toBe(false);
    expect(next?.layer).toBe('overlay');
    expect(active?.layer).toBe('overlay');
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
    koByYou: false,
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
    pelletDuration: 9,
    powerActive: 'standard',
    powerQueued: 'standard',
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

function liveJammer(kind: JammerKind, x: number, y: number): InboundJammer {
  return {
    kind,
    phase: 'live',
    anim: 0,
    centerKey: -1,
    prevX: x,
    prevY: y,
    x,
    y,
    dir: { ...DIR_LEFT },
    queued: null,
    sender: 1,
  };
}

function recordingContext(
  log: { kind: string; layer: string; clipped: boolean; text?: string; actor?: string }[],
): CanvasRenderingContext2D {
  const names = ['panels', 'maze', 'overlay'];
  let made = 0;
  const rootCanvas = {
    width: VIEW_W,
    height: VIEW_H,
    ownerDocument: {
      createElement: () => layerCanvas(log, names[made++] ?? 'extra'),
    },
  };
  return makeCtx(log, 'root', rootCanvas);
}

function layerCanvas(
  log: { kind: string; layer: string; clipped: boolean; text?: string; actor?: string }[],
  layer: string,
): {
  width: number;
  height: number;
  __layer: string;
  getContext: () => CanvasRenderingContext2D;
} {
  const canvas = {
    width: 0,
    height: 0,
    __layer: layer,
    getContext: () => makeCtx(log, layer, canvas),
  };
  return canvas;
}

function makeCtx(
  log: { kind: string; layer: string; clipped: boolean; text?: string; actor?: string }[],
  layer: string,
  canvas: { width: number; height: number; __layer?: string },
): CanvasRenderingContext2D {
  let clipped = 0;
  const stack: number[] = [];
  const ctx = {
    canvas,
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
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    setTransform: () => undefined,
    save: () => stack.push(clipped),
    restore: () => {
      clipped = stack.pop() ?? 0;
    },
    clip: () => {
      clipped += 1;
      log.push({ kind: 'clip', layer, clipped: true });
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      const panel = panelRect(5);
      if (x === panel.x && y === panel.y && w === panel.w && h === panel.h) {
        log.push({ kind: 'panel', layer, clipped: clipped > 0 });
      }
    },
    fillText: (text: string) => {
      log.push({ kind: 'text', layer, clipped: clipped > 0, text });
    },
    drawImage: (image: { __layer?: string }) => {
      log.push({ kind: 'blit', layer: image.__layer ?? layer, clipped: clipped > 0 });
    },
    markActor: (actor: string) => {
      if (actor === 'bolt') log.push({ kind: 'bolt', layer, clipped: clipped > 0 });
      else log.push({ kind: 'actor', layer, clipped: clipped > 0, actor });
    },
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop in target) return target[prop as keyof typeof target];
      return () => undefined;
    },
  }) as unknown as CanvasRenderingContext2D;
}
