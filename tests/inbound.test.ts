import { describe, expect, it } from 'vitest';
import { JAMMER_CAP, JAMMER_SPAWN_SECONDS } from '../src/config';
import { Game } from '../src/game';
import { InboundField, quadrantOf, redWeight, slowProfile, splitJammerColors, type InboundJammer } from '../src/gameplay/inbound';
import { Tile } from '../src/gameplay/maze';
import { DIR_NONE } from '../src/shared/types';

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
    expect(later.seconds).toBeGreaterThan(early.seconds);
    expect(early.factor).toBeCloseTo(0.42);
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
    expect(field.slow).toBeCloseTo(0.6);
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

  it('starts the match clock at 0:00 and counts up after the first step', () => {
    const game = new Game(() => 0);
    game.update(0.05);
    expect(game.hud().time).toBe('0:00');
    game.board.pac.dir = { x: -1, y: 0 };
    for (let i = 0; i < 20; i++) game.update(0.05);
    expect(game.hud().time).toBe('0:01');
  });
});

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
