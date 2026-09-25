import { describe, expect, it } from 'vitest';
import {
  CLEAR_SPEED_BONUS,
  GHOST_SCATTER_BUMP,
  JAMMER_CHASE_GATE,
  JAMMER_SPAWN_SECONDS,
  speedsForBoard,
} from '../src/config';
import { Game } from '../src/game';
import { InboundField } from '../src/gameplay/inbound';
import type { InboundJammer } from '../src/gameplay/inbound';
import { DIR_NONE } from '../src/shared/types';

describe('gameplay feel', () => {
  it('cuts the clear bonus and the later-board steps to two thirds of the old deltas', () => {
    expect(CLEAR_SPEED_BONUS).toBeCloseTo(1.125 * (2 / 3));
    const board1 = speedsForBoard(0);
    const board2 = speedsForBoard(1);
    expect(board1.pac).toBeCloseTo(7.78);
    expect(board1.ghost).toBeCloseTo(5.47);
    expect(board1.fright).toBeCloseTo(2.49);
    expect(board2.pac - board1.pac).toBeCloseTo((9.315 - 8.64) * (2 / 3));
    expect(board2.ghost - board1.ghost).toBeCloseTo((6.84 - 6.075) * (2 / 3));
    expect(board2.fright - board1.fright).toBeCloseTo((3.0375 - 2.7675) * (2 / 3));
    expect(board2.fright).toBeLessThan(board2.ghost * 0.5);
    expect(GHOST_SCATTER_BUMP).toBeCloseTo(0.765 * (2 / 3));
  });

  it('skips the ghost speed bump on the opening scatter and adds it on each later scatter', () => {
    const game = new Game(() => 0);
    park(game);
    expect(game.board.wave).toBe('scatter');
    expect(game.board.ghostPaceBoost).toBe(0);
    expect(game.board.ghostCruise()).toBeCloseTo(speedsForBoard(0).ghost);

    const cruise = game.board.ghostCruise();
    runUntilWave(game, 'chase');
    expect(game.board.ghostPaceBoost).toBe(0);
    expect(game.board.ghostCruise()).toBeCloseTo(cruise);

    runUntilWave(game, 'scatter');
    expect(game.board.ghostPaceBoost).toBe(1);
    expect(game.board.ghostCruise()).toBeCloseTo(speedsForBoard(0).ghost + GHOST_SCATTER_BUMP);

    const pinky = game.board.ghosts[1];
    if (!pinky) throw new Error('missing pinky');
    pinky.mode = 'chase';
    pinky.x = 12;
    pinky.y = 5;
    pinky.dir = { x: 1, y: 0 };
    pinky.centerKey = -1;
    game.board.pac.x = 4;
    game.board.pac.y = 14;
    game.board.pac.dir = { x: -1, y: 0 };
    const x0 = pinky.x;
    const y0 = pinky.y;
    game.update(1 / 60);
    expect(Math.hypot(pinky.x - x0, pinky.y - y0)).toBeCloseTo(game.board.ghostCruise() / 60, 2);
    expect(game.board.wave).toBe('scatter');
  });

  it('holds inbound jammers still until 60s, then lets those same bodies chase', () => {
    const game = new Game(() => 0.2);
    park(game);
    game.board.pac.x = 14;
    game.board.pac.y = 23;
    game.board.pac.dir = { x: -1, y: 0 };
    game.matchTime = 5;
    expect(game.board.spawnInbound(16)).toBeGreaterThan(1);
    finishSpawn(game, false);
    const white = game.board.inbound.jammers.find((jammer) => jammer.kind === 'white' && jammer.phase === 'live');
    if (!white) throw new Error('missing white jammer');
    const satX = white.x;
    const satY = white.y;
    game.update(1 / 60);
    expect(game.matchTime).toBeLessThan(JAMMER_CHASE_GATE);
    expect(white.x).toBe(satX);
    expect(white.y).toBe(satY);
    expect(white.phase).toBe('live');

    game.board.pac.x = white.x;
    game.board.pac.y = white.y;
    game.update(1 / 60);
    expect(white.phase).toBe('dying');
    expect(game.board.inbound.slow).toBeGreaterThan(0);
    expect(game.board.inbound.slowFactor).toBeLessThan(1);

    const sitter = game.board.inbound.jammers.find((jammer) => jammer.phase === 'live');
    if (!sitter) throw new Error('missing sitting jammer');
    const stillX = sitter.x;
    const stillY = sitter.y;
    game.matchTime = JAMMER_CHASE_GATE;
    game.update(1 / 60);
    expect(Math.hypot(sitter.x - stillX, sitter.y - stillY)).toBeGreaterThan(0.01);
  });

  it('lets a jammer spawned after the gate chase once it is live, and a sitting red still kills', () => {
    const gated = new Game(() => 0.2);
    park(gated);
    gated.matchTime = JAMMER_CHASE_GATE;
    gated.board.pac.x = 14;
    gated.board.pac.y = 23;
    gated.board.pac.dir = { x: -1, y: 0 };
    expect(gated.board.spawnInbound(8)).toBeGreaterThan(0);
    const born = gated.board.inbound.jammers[0];
    if (!born) throw new Error('missing jammer');
    finishSpawn(gated, true);
    expect(born.phase).toBe('live');
    const x = born.x;
    const y = born.y;
    gated.update(1 / 60);
    expect(Math.hypot(born.x - x, born.y - y)).toBeGreaterThan(0.01);

    const field = new InboundField();
    const red = idleRed();
    field.jammers.push(red);
    field.update(1 / 60, gated.board.maze, 1, 1, 8, false, false);
    expect(red.x).toBe(4);
    expect(red.y).toBe(4);
    expect(field.touch(4, 4, 10)).toBe(true);
  });
});

function park(game: Game): void {
  for (const ghost of game.board.ghosts) {
    ghost.mode = 'house';
    ghost.releaseAt = 1e9;
  }
}

function runUntilWave(game: Game, mode: 'chase' | 'scatter'): void {
  game.board.pac.x = 5;
  game.board.pac.y = 14;
  game.board.pac.dir = { x: -1, y: 0 };
  let guard = 0;
  while (game.board.wave !== mode && guard++ < 2000) game.update(0.05);
  expect(game.board.wave).toBe(mode);
}

function finishSpawn(game: Game, chase: boolean): void {
  const steps = Math.ceil(JAMMER_SPAWN_SECONDS / (1 / 60)) + 2;
  for (let i = 0; i < steps; i++) {
    game.board.inbound.update(
      1 / 60,
      game.board.maze,
      game.board.pac.x,
      game.board.pac.y,
      game.board.chaseSpeed(),
      false,
      chase,
    );
  }
}

function idleRed(): InboundJammer {
  return {
    kind: 'red',
    phase: 'live',
    anim: 1,
    centerKey: -1,
    prevX: 4,
    prevY: 4,
    x: 4,
    y: 4,
    dir: { ...DIR_NONE },
    queued: null,
  };
}
