import { describe, expect, it } from 'vitest';
import { JAMMER_CAP, JAMMER_HIT_DISTANCE, JAMMER_SPAWN_SECONDS } from '../src/config';
import { Game } from '../src/game';
import { InboundField, pickSpawnTiles, quadrantOf, redUnfreezeDirection, redWeight, slowProfile, splitJammerColors, type InboundJammer } from '../src/gameplay/inbound';
import { Maze, Tile } from '../src/gameplay/maze';
import { DIR_DOWN, DIR_LEFT, DIR_NONE, DIR_RIGHT, DIR_UP, type Dir } from '../src/shared/types';

describe('inbound jammers', () => {
  it('ramps the red share every 30s and is red-only at 7:00', () => {
    expect(redWeight(0)).toBe(0);
    expect(redWeight(89.9)).toBe(0);
    expect(redWeight(90)).toBe(1);
    expect(redWeight(120)).toBe(2);
    expect(redWeight(90 + 30 * 10)).toBe(11);
    expect(redWeight(419)).toBe(11);
    expect(redWeight(420)).toBe(12);
    expect(splitJammerColors(10, 4, true)).toEqual({ red: 0, white: 4, usedFirstRed: false });
    expect(splitJammerColors(90, 4, true)).toEqual({ red: 1, white: 3, usedFirstRed: true });
    expect(splitJammerColors(420, 4, false)).toEqual({ red: 4, white: 0, usedFirstRed: false });
  });

  it('grows the white slow every 30s and caps it at 7:00', () => {
    const early = slowProfile(0);
    const later = slowProfile(60);
    expect(early).toEqual({ seconds: 0.35, factor: 0.42 });
    expect(slowProfile(29.9).seconds).toBeCloseTo(0.35);
    expect(slowProfile(30).seconds).toBeCloseTo(0.43);
    expect(later.seconds).toBeCloseTo(0.35 + 2 * 0.08);
    expect(later.seconds).toBeGreaterThan(early.seconds);
    expect(later.factor).toBeCloseTo(0.42);
    expect(slowProfile(420).seconds).toBeCloseTo(0.35 + 14 * 0.08);
    expect(slowProfile(10_000).seconds).toBe(slowProfile(420).seconds);
  });

  it('spawns outside Pac’s quadrant, caps at 16, and drops the overflow', () => {
    const game = new Game(() => 0.3);
    game.board.pac.x = 14;
    game.board.pac.y = 23;
    game.board.matchTime = 0;
    const spawned = game.board.spawnInbound(40);
    expect(spawned).toBeGreaterThan(0);
    expect(spawned).toBeLessThanOrEqual(8);
    const pacQ = quadrantOf(14, 23);
    for (const jammer of game.board.inbound.jammers) {
      expect(quadrantOf(jammer.x, jammer.y)).not.toBe(pacQ);
      expect(jammer.kind).toBe('white');
      expect(jammer.phase).toBe('spawn');
    }

    game.board.matchTime = 90;
    game.board.inbound.jammers = [];
    game.board.spawnInbound(32);
    const reds = game.board.inbound.jammers.filter((jammer) => jammer.kind === 'red');
    expect(reds).toHaveLength(1);

    game.board.inbound.jammers = [];
    game.board.matchTime = 420;
    game.board.spawnInbound(24);
    expect(game.board.inbound.jammers.every((jammer) => jammer.kind === 'red')).toBe(true);

    while (game.board.inbound.jammers.length < JAMMER_CAP) {
      game.board.inbound.jammers.push(idle('white'));
    }
    expect(game.board.spawnInbound(40)).toBe(0);
    expect(game.board.inbound.count).toBe(JAMMER_CAP);
  });

  it('spawns white and red jammers only on starting dots, even after those dots are eaten', () => {
    const maze = new Maze();
    const dots = new Set<string>();
    for (let y = 0; y < maze.rows; y++) {
      for (let x = 0; x < maze.cols; x++) {
        if (maze.startingDot(x, y)) dots.add(`${x},${y}`);
      }
    }
    expect(dots.size).toBe(maze.dotCount());
    expect(maze.startingDot(1, 3)).toBe(false);
    for (let x = 0; x < maze.cols; x++) expect(maze.startingDot(x, maze.tunnelRow)).toBe(false);
    for (let y = 13; y <= 15; y++) {
      for (let x = 11; x <= 16; x++) expect(maze.startingDot(x, y)).toBe(false);
    }

    for (const key of dots) {
      const [x, y] = key.split(',').map(Number);
      expect(maze.consume(x ?? -1, y ?? -1)).toBe('dot');
    }
    expect(maze.dotCount()).toBe(0);

    const tiles = pickSpawnTiles(maze, 14, 23, 400, [], () => 0.37);
    expect(tiles.length).toBeGreaterThan(20);
    const pacQ = quadrantOf(14, 23);
    for (const tile of tiles) {
      expect(maze.startingDot(tile.x, tile.y)).toBe(true);
      expect(dots.has(`${tile.x},${tile.y}`)).toBe(true);
      expect(maze.tile(tile.x, tile.y)).toBe(Tile.Empty);
      expect(quadrantOf(tile.x, tile.y)).not.toBe(pacQ);
      expect(Math.hypot(tile.x - 14, tile.y - 23)).toBeGreaterThanOrEqual(4);
    }

    const game = new Game(() => 0.2);
    game.board.pac.x = 14;
    game.board.pac.y = 23;
    game.board.matchTime = 420;
    for (let y = 0; y < game.board.maze.rows; y++) {
      for (let x = 0; x < game.board.maze.cols; x++) {
        if (game.board.maze.tile(x, y) === Tile.Dot) game.board.maze.consume(x, y);
      }
    }
    expect(game.board.spawnInbound(80)).toBeGreaterThan(0);
    for (const jammer of game.board.inbound.jammers) {
      expect(jammer.kind === 'white' || jammer.kind === 'red').toBe(true);
      expect(game.board.maze.startingDot(jammer.x, jammer.y)).toBe(true);
    }
  });

  it('falls back to a farther starting dot in Pac’s quadrant when the other quadrants are taken', () => {
    const maze = new Maze();
    const pacX = 14;
    const pacY = 23;
    const pacQ = quadrantOf(pacX, pacY);
    const existing: InboundJammer[] = [];
    for (let y = 0; y < maze.rows; y++) {
      for (let x = 0; x < maze.cols; x++) {
        if (!maze.startingDot(x, y) || quadrantOf(x, y) === pacQ) continue;
        existing.push({ ...idle('white'), x, y, prevX: x, prevY: y });
      }
    }
    const tiles = pickSpawnTiles(maze, pacX, pacY, 3, existing, () => 0);
    expect(tiles.length).toBe(3);
    for (const tile of tiles) {
      expect(maze.startingDot(tile.x, tile.y)).toBe(true);
      expect(quadrantOf(tile.x, tile.y)).toBe(pacQ);
      expect(Math.hypot(tile.x - pacX, tile.y - pacY)).toBeGreaterThanOrEqual(4);
      expect(tile.x === Math.round(pacX) && tile.y === Math.round(pacY)).toBe(false);
    }
  });

  it('pulses in for the full spawn window and cannot hit until that ends', () => {
    const game = new Game(() => 0.3);
    game.board.pac.x = 14;
    game.board.pac.y = 23;
    expect(game.board.spawnInbound(8)).toBeGreaterThan(0);
    const jammer = game.board.inbound.jammers[0];
    if (!jammer) throw new Error('missing jammer');
    const maze = game.board.maze;
    let elapsed = 0;
    while (elapsed < JAMMER_SPAWN_SECONDS - 0.05) {
      game.board.inbound.update(0.05, maze, game.board.pac.x, game.board.pac.y, 6.4, false);
      elapsed += 0.05;
    }
    expect(JAMMER_SPAWN_SECONDS).toBeGreaterThan(1);
    expect(jammer.phase).toBe('spawn');
    expect(jammer.x).toBeGreaterThan(0);
    expect(game.board.inbound.touch(jammer.x, jammer.y, 0)).toBe(false);
    game.board.inbound.update(0.1, maze, game.board.pac.x, game.board.pac.y, 6.4, false);
    expect(jammer.phase).toBe('live');
  });

  it('ignores Pac during the spawn fade, slows on a white hit, and dies on a red hit', () => {
    const field = new InboundField();
    const white = idle('white');
    white.x = 10;
    white.y = 20;
    white.phase = 'spawn';
    white.anim = 0.4;
    field.jammers.push(white);
    expect(field.touch(10, 20, 0)).toBe(false);
    expect(field.slow).toBe(0);

    white.phase = 'live';
    expect(field.touch(10, 20, 0)).toBe(false);
    expect(white.phase).toBe('dying');
    expect(field.slow).toBeCloseTo(0.35);
    expect(field.slowFactor).toBeCloseTo(0.42);

    const reds = new InboundField();
    const spawning = idle('red');
    spawning.x = 4;
    spawning.y = 4;
    spawning.phase = 'spawn';
    reds.jammers.push(spawning);
    expect(reds.touch(4, 4, 60)).toBe(false);

    spawning.phase = 'live';
    expect(reds.touch(4, 4, 60)).toBe(true);
    expect(spawning.phase).toBe('live');
    expect(reds.slow).toBe(0);
  });

  it('freezes live reds during a power pellet and clears them when the fruit is eaten', () => {
    const game = new Game(() => 0);
    const red = idle('red');
    red.phase = 'live';
    red.x = 6;
    red.y = 5;
    red.dir = { x: 1, y: 0 };
    game.board.inbound.jammers.push(red);
    game.board.frightened = 4;
    game.board.pac.dir = { x: -1, y: 0 };
    game.board.pac.x = 14;
    game.board.pac.y = 23;
    game.update(1 / 60);
    expect(red.phase).toBe('live');
    expect(red.x).toBe(6);
    expect(red.y).toBe(5);

    game.board.fruit = { x: 14, y: 17 };
    game.board.pac.x = 14;
    game.board.pac.y = 17;
    game.update(1 / 60);
    expect(game.board.boardIndex).toBe(1);
    expect(red.phase).toBe('dying');
  });

  it('kills Pac when a live red overlaps him and ignores a red that is still spawning', () => {
    const spawning = new Game(() => 0);
    const fading = idle('red');
    fading.phase = 'spawn';
    fading.x = spawning.board.pac.x;
    fading.y = spawning.board.pac.y;
    spawning.board.inbound.jammers.push(fading);
    spawning.board.pac.dir = { x: -1, y: 0 };
    spawning.update(1 / 60);
    expect(spawning.board.pac.alive).toBe(true);

    const game = new Game(() => 0);
    const red = idle('red');
    red.phase = 'live';
    red.x = game.board.pac.x;
    red.y = game.board.pac.y;
    game.board.inbound.jammers.push(red);
    game.board.pac.dir = { x: 0, y: -1 };
    game.update(1 / 60);
    expect(game.board.pac.alive).toBe(false);
    expect(game.match.phase).toBe('lost');
  });

  it('kills Pac when a red body overlaps even if the centers are farther than the old hitbox', () => {
    const game = new Game(() => 0);
    for (const ghost of game.board.ghosts) {
      ghost.mode = 'house';
      ghost.releaseAt = 1e9;
    }
    const red = idle('red');
    red.phase = 'live';
    red.x = 10;
    red.y = 20;
    red.prevX = 10;
    red.prevY = 20;
    red.dir = { x: 0, y: 0 };
    red.centerKey = 20 * 28 + 10;
    game.board.inbound.jammers.push(red);
    game.board.pac.dir = { x: -1, y: 0 };
    game.board.pac.x = 10.7;
    game.board.pac.y = 20;
    game.update(1 / 60);
    expect(game.board.pac.alive).toBe(false);
    expect(game.match.phase).toBe('lost');
  });

  it('stops every live red while a power pellet is active, then lets them chase again', () => {
    const game = new Game(() => 0);
    for (const ghost of game.board.ghosts) {
      ghost.mode = 'house';
      ghost.releaseAt = 1e9;
    }
    const pellet = findPellet(game.board.maze);
    const red = idle('red');
    red.phase = 'live';
    red.x = 6;
    red.y = 5;
    red.prevX = 6;
    red.prevY = 5;
    red.dir = { x: 1, y: 0 };
    red.centerKey = -1;
    game.board.inbound.jammers.push(red);
    game.board.pac.dir = { x: 1, y: 0 };
    game.board.pac.x = pellet.x;
    game.board.pac.y = pellet.y;
    game.update(1 / 60);
    expect(game.board.frightened).toBeGreaterThan(0);
    expect(red.x).toBe(6);
    expect(red.y).toBe(5);
    expect(game.board.inbound.touch(6, 5, 0)).toBe(true);
    expect(red.phase).toBe('live');
    expect(game.board.pac.alive).toBe(true);
    const heldX = red.x;
    const heldY = red.y;
    for (let i = 0; i < 8; i++) game.update(1 / 60);
    expect(game.board.frightened).toBeGreaterThan(0);
    expect(red.phase).toBe('live');
    expect(red.x).toBe(heldX);
    expect(red.y).toBe(heldY);

    game.board.frightened = 0;
    for (const ghost of game.board.ghosts) {
      if (ghost.mode === 'frightened') ghost.mode = 'chase';
    }
    game.matchTime = 60;
    game.update(1 / 60);
    expect(Math.hypot(red.x - heldX, red.y - heldY)).toBeGreaterThan(0.01);
  });

  it('kills white jammers on a power pellet and leaves reds', () => {
    const game = new Game(() => 0);
    const pellet = findPellet(game.board.maze);
    const white = idle('white');
    white.phase = 'live';
    const red = idle('red');
    red.phase = 'live';
    red.x = 2;
    game.board.inbound.jammers.push(white, red);
    game.board.pac.dir = { x: 1, y: 0 };
    game.board.pac.x = pellet.x;
    game.board.pac.y = pellet.y;
    game.update(1 / 60);
    expect(white.phase).toBe('dying');
    expect(red.phase).toBe('live');
  });

  it('sends a thawing red right, then up, then back to chase', () => {
    const maze = new Maze();
    const rightOpen = { x: 10, y: 5 };
    const upOnly = { x: 6, y: 8 };
    const bothBlocked = { x: 26, y: 1 };
    const pac = { x: 1, y: 1 };

    expect(maze.blocks(rightOpen.x + 1, rightOpen.y, 'pac')).toBe(false);
    expect(maze.blocks(upOnly.x + 1, upOnly.y, 'pac')).toBe(true);
    expect(maze.blocks(upOnly.x, upOnly.y - 1, 'pac')).toBe(false);
    expect(maze.blocks(bothBlocked.x + 1, bothBlocked.y, 'pac')).toBe(true);
    expect(maze.blocks(bothBlocked.x, bothBlocked.y - 1, 'pac')).toBe(true);

    expect(redUnfreezeDirection(maze, rightOpen.x, rightOpen.y, pac.x, pac.y, DIR_DOWN)).toEqual(DIR_RIGHT);
    expect(redUnfreezeDirection(maze, upOnly.x, upOnly.y, pac.x, pac.y, DIR_DOWN)).toEqual(DIR_UP);
    const chase = redUnfreezeDirection(maze, bothBlocked.x, bothBlocked.y, pac.x, pac.y, DIR_DOWN);
    expect(chase).toEqual(DIR_LEFT);
    expect(chase).not.toEqual(DIR_RIGHT);
    expect(chase).not.toEqual(DIR_UP);

    const right = thaw(maze, rightOpen, pac, DIR_DOWN);
    expect(right.red.dir).toEqual(DIR_RIGHT);
    expect(right.red.x).toBeGreaterThan(rightOpen.x);
    expect(right.white.dir).toEqual(DIR_LEFT);
    expect(right.white.x).toBeLessThan(14);

    const up = thaw(maze, upOnly, pac, DIR_DOWN);
    expect(up.red.dir).toEqual(DIR_UP);
    expect(up.red.y).toBeLessThan(upOnly.y);

    const fallback = thaw(maze, bothBlocked, pac, DIR_DOWN);
    expect(fallback.red.dir).toEqual(DIR_LEFT);
    expect(fallback.red.x).toBeLessThan(bothBlocked.x);

    const stayed = new InboundField();
    const still = liveAt('red', rightOpen.x, rightOpen.y, DIR_DOWN);
    stayed.jammers.push(still);
    stayed.update(1 / 60, maze, pac.x, rightOpen.y, 8, false, true);
    expect(still.dir).toEqual(DIR_LEFT);
  });

  it('does not kill Pac when an attack arrives, even if that attack includes reds', () => {
    const game = new Game(() => 0);
    for (const ghost of game.board.ghosts) {
      ghost.mode = 'house';
      ghost.releaseAt = 1e9;
    }
    game.board.pac.x = 1;
    game.board.pac.y = 1;
    game.board.pac.dir = { ...DIR_NONE };
    game.matchTime = 120;
    game.board.matchTime = 120;
    const spawned = game.board.spawnInbound(16, true, 4);
    expect(spawned).toBeGreaterThan(0);
    expect(game.board.inbound.jammers.some((jammer) => jammer.kind === 'red')).toBe(true);
    expect(game.board.pac.alive).toBe(true);
    for (const jammer of game.board.inbound.jammers) {
      expect(Math.hypot(jammer.x - game.board.pac.x, jammer.y - game.board.pac.y)).toBeGreaterThan(JAMMER_HIT_DISTANCE);
    }

    const steps = Math.ceil(JAMMER_SPAWN_SECONDS / 0.05) + 2;
    for (let i = 0; i < steps; i++) {
      game.board.inbound.update(0.05, game.board.maze, game.board.pac.x, game.board.pac.y, 8, false, false);
    }
    expect(game.board.inbound.jammers.every((jammer) => jammer.phase === 'live')).toBe(true);
    expect(game.board.inbound.touch(game.board.pac.x, game.board.pac.y, 120)).toBe(false);
    expect(game.board.pac.alive).toBe(true);
    expect(game.match.phase).toBe('playing');
  });

  it('starts the match clock at 0:00 and counts up after the first step', () => {
    const game = new Game(() => 0);
    game.update(0.05);
    expect(game.hud().time).toBe('0:00');
    game.board.pac.dir = { x: -1, y: 0 };
    for (let i = 0; i < 20; i++) game.update(0.05);
    expect(game.hud().time).toBe('0:01');
  });
});

function thaw(
  maze: Maze,
  tile: { x: number; y: number },
  pac: { x: number; y: number },
  facing: Dir,
): { red: InboundJammer; white: InboundJammer } {
  const field = new InboundField();
  const red = liveAt('red', tile.x, tile.y, facing);
  const white = liveAt('white', 14, 5, DIR_DOWN);
  field.jammers.push(red, white);
  field.update(1 / 60, maze, pac.x, pac.y, 8, true, true);
  expect(red.x).toBe(tile.x);
  expect(red.y).toBe(tile.y);
  field.update(1 / 60, maze, pac.x, pac.y, 8, false, true);
  return { red, white };
}

function liveAt(kind: 'white' | 'red', x: number, y: number, dir: Dir): InboundJammer {
  return {
    kind,
    phase: 'live',
    anim: 1,
    centerKey: -1,
    prevX: x,
    prevY: y,
    x,
    y,
    dir: { ...dir },
    queued: null,
  };
}

function idle(kind: 'white' | 'red'): InboundJammer {
  return {
    kind,
    phase: 'spawn',
    anim: 0,
    centerKey: -1,
    prevX: 1,
    prevY: 1,
    x: 1,
    y: 1,
    dir: { ...DIR_NONE },
    queued: null,
  };
}

function findPellet(maze: Game['board']['maze']): { x: number; y: number } {
  for (let y = 0; y < maze.rows; y++) {
    for (let x = 0; x < maze.cols; x++) {
      if (maze.tile(x, y) === Tile.Pellet) return { x, y };
    }
  }
  throw new Error('missing pellet');
}
