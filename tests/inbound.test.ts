import { describe, expect, it } from 'vitest';
import { JAMMER_CAP } from '../src/config';
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

  it('grows the slow every 30s and makes red harsher than white', () => {
    const early = slowProfile('white', 0);
    const later = slowProfile('white', 60);
    const red = slowProfile('red', 60);
    expect(later.seconds).toBeGreaterThan(early.seconds);
    expect(red.seconds).toBeGreaterThan(later.seconds);
    expect(red.factor).toBeLessThan(later.factor);
    expect(slowProfile('white', 10_000).seconds).toBe(slowProfile('white', 420).seconds);
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

  it('ignores Pac during the spawn fade, then whites die on hit and reds stay immune', () => {
    const field = new InboundField();
    const white = idle('white');
    white.x = 10;
    white.y = 20;
    white.phase = 'spawn';
    white.anim = 0.4;
    field.jammers.push(white);
    field.touch(10, 20, 0);
    expect(field.slow).toBe(0);

    white.phase = 'live';
    field.touch(10, 20, 0);
    expect(white.phase).toBe('dying');
    expect(field.slow).toBeCloseTo(1.2);
    expect(field.slowFactor).toBeCloseTo(0.42);

    const reds = new InboundField();
    const red = idle('red');
    red.x = 4;
    red.y = 4;
    red.phase = 'live';
    reds.jammers.push(red);
    reds.touch(4, 4, 60);
    expect(red.phase).toBe('live');
    expect(red.immune).toBeGreaterThan(1);
    expect(reds.slow).toBeGreaterThan(slowProfile('white', 60).seconds);
    expect(reds.slowFactor).toBeLessThan(0.42);
    reds.touch(4, 4, 60);
    expect(reds.slow).toBeCloseTo(slowProfile('red', 60).seconds);
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
    expect(game.hud().jammers).toBe('0/16');
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
    immune: 0,
    centerKey: -1,
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
