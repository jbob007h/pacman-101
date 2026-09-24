import { describe, expect, it } from 'vitest';
import { CLEAR_SPEED_BONUS, FRIGHT_SECONDS, GHOST_ATTACK_WINDOW, JAMMER_CAP, speedsForBoard } from '../src/config';
import { Game } from '../src/game';
import { Tile } from '../src/gameplay/maze';
import {
  frightSecondsFor,
  scaleGhostAttack,
  SPEED_MODE_LEVELS,
  STRONGER_FRIGHT_SECONDS,
} from '../src/gameplay/powerMode';
import { SLEEPER_LEFT_X, SLEEPER_ROWS } from '../src/gameplay/train';
import { DIR_NONE } from '../src/shared/types';

describe('power modes', () => {
  it('queues a mode without applying it, then activates that mode on the next pellet', () => {
    const game = new Game(() => 0);
    expect(game.board.powerActive).toBe('standard');
    expect(game.board.powerQueued).toBe('standard');
    const before = game.board.pacSpeed();

    game.queuePower('speed');
    game.queuePower('stronger');
    expect(game.board.powerActive).toBe('standard');
    expect(game.board.powerQueued).toBe('stronger');
    expect(game.board.pacSpeed()).toBeCloseTo(before);
    expect(game.board.frightened).toBe(0);

    eatPellet(game);
    expect(game.board.powerActive).toBe('stronger');
    expect(game.board.powerQueued).toBe('stronger');
    expect(game.board.frightened).toBe(STRONGER_FRIGHT_SECONDS);
    expect(game.board.pelletDuration).toBe(STRONGER_FRIGHT_SECONDS);
    expect(frightSecondsFor('standard')).toBe(FRIGHT_SECONDS);
    expect(game.board.frightened).toBeLessThan(FRIGHT_SECONDS);

    game.queuePower('speed');
    expect(game.board.powerActive).toBe('stronger');
    expect(game.board.frightened).toBe(STRONGER_FRIGHT_SECONDS);

    eatPellet(game);
    expect(game.board.powerActive).toBe('speed');
    expect(game.board.frightened).toBe(FRIGHT_SECONDS);
    expect(game.board.pelletDuration).toBe(FRIGHT_SECONDS);
  });

  it('re-applies Stronger so the new pellet is 4 seconds again', () => {
    const game = new Game(() => 0);
    game.queuePower('stronger');
    eatPellet(game);
    game.board.frightened = 1;
    game.queuePower('stronger');
    eatPellet(game);
    expect(game.board.powerActive).toBe('stronger');
    expect(game.board.frightened).toBe(4);
  });

  it('doubles ghost-attack strength while Stronger is active, including the online earn', () => {
    expect(scaleGhostAttack('stronger', 3)).toBe(6);
    expect(scaleGhostAttack('standard', 3)).toBe(3);

    const local = new Game(() => 0);
    local.queuePower('stronger');
    expect(closeWindow(local, 3)).toBe(3);
    eatPellet(local);
    expect(closeWindow(local, 3)).toBe(6);
    expect(local.sims.sims[0]?.pressure).toBe(9);

    const online = new Game(() => 0);
    const earns: { attack: string; strength: number }[] = [];
    online.bindOnline({
      earn: (attack, strength) => earns.push({ attack, strength }),
      death: () => undefined,
    });
    online.startMatch();
    online.armOnline(1, 'Ada');
    online.queuePower('stronger');
    online.board.powerActive = 'stronger';
    online.bus.emit({ type: 'ghostEaten', ghostId: 'blinky', strength: 1, combo: 1 });
    online.bus.emit({ type: 'ghostEaten', ghostId: 'pinky', strength: 2, combo: 2 });
    online.sims.advanceGhostWindow(GHOST_ATTACK_WINDOW);
    expect(earns).toEqual([{ attack: 'ghost', strength: 4 }]);
  });

  it('adds 3 speed levels while Speed is active and strips them when another mode turns on', () => {
    const game = new Game(() => 0);
    const base = speedsForBoard(0).pac;
    expect(game.board.pacSpeed()).toBeCloseTo(base);
    expect(game.hud().speed).toBe(0);

    game.queuePower('speed');
    expect(game.board.pacSpeed()).toBeCloseTo(base);
    eatPellet(game);
    expect(game.board.modeSpeedLevels()).toBe(SPEED_MODE_LEVELS);
    expect(game.board.pacSpeed()).toBeCloseTo(base + SPEED_MODE_LEVELS * CLEAR_SPEED_BONUS);
    expect(game.hud().speed).toBe(SPEED_MODE_LEVELS);
    expect(game.board.displayedSpeed).toBe(0);

    game.queuePower('speed');
    eatPellet(game);
    expect(game.board.pacSpeed()).toBeCloseTo(base + SPEED_MODE_LEVELS * CLEAR_SPEED_BONUS);
    expect(game.hud().speed).toBe(SPEED_MODE_LEVELS);

    game.queuePower('standard');
    eatPellet(game);
    expect(game.board.powerActive).toBe('standard');
    expect(game.board.modeSpeedLevels()).toBe(0);
    expect(game.board.pacSpeed()).toBeCloseTo(base);
    expect(game.hud().speed).toBe(0);
    expect(game.board.frightened).toBe(FRIGHT_SECONDS);
  });

  it('halves attack strength, rounding up, only while Speed is active', () => {
    expect(scaleGhostAttack('speed', 1)).toBe(1);
    expect(scaleGhostAttack('speed', 3)).toBe(2);
    expect(scaleGhostAttack('speed', 4)).toBe(2);

    const game = new Game(() => 0);
    game.queuePower('speed');
    expect(closeWindow(game, 3)).toBe(3);
    eatPellet(game);
    expect(closeWindow(game, 3)).toBe(2);
    expect(closeWindow(game, 1)).toBe(1);
    expect(game.sims.sims[0]?.pressure).toBe(3 + 2 + 1);
  });

  it('adds two train ghosts per wake and one white jammer every four wakes', () => {
    const game = new Game(() => 0.3);
    park(game);
    game.queuePower('train');
    eatPellet(game);
    expect(game.board.powerActive).toBe('train');
    expect(game.board.train.followers).toHaveLength(0);

    wakeSleeper(game, 0);
    expect(game.board.train.followers).toHaveLength(2);
    expect(game.board.train.asleep()).toHaveLength(15);
    expect(game.board.trainWakes).toBe(1);
    expect(game.board.inbound.count).toBe(0);

    wakeSleeper(game, 1);
    wakeSleeper(game, 2);
    expect(game.board.inbound.count).toBe(0);
    wakeSleeper(game, 3);
    expect(game.board.train.followers).toHaveLength(8);
    expect(game.board.trainWakes).toBe(4);
    expect(game.board.inbound.count).toBe(1);
    expect(game.board.inbound.jammers[0]?.kind).toBe('white');

    game.queuePower('standard');
    eatPellet(game);
    expect(game.board.powerActive).toBe('standard');
    expect(game.board.trainWakes).toBe(0);

    game.queuePower('train');
    eatPellet(game);
    const whites = game.board.inbound.count;
    wakeSleeper(game, 4);
    expect(game.board.trainWakes).toBe(1);
    expect(game.board.inbound.count).toBe(whites);
    expect(game.board.train.followers).toHaveLength(10);
  });

  it('does not spawn the Train white when the jammer cap is full', () => {
    const game = new Game(() => 0.3);
    park(game);
    game.board.powerActive = 'train';
    game.board.powerQueued = 'train';
    while (game.board.inbound.jammers.length < JAMMER_CAP) {
      game.board.inbound.jammers.push({
        kind: 'white',
        phase: 'live',
        anim: 1,
        centerKey: -1,
        prevX: 2,
        prevY: 2,
        x: 2,
        y: 2,
        dir: { ...DIR_NONE },
        queued: null,
      });
    }
    for (let i = 0; i < 4; i++) wakeSleeper(game, i);
    expect(game.board.trainWakes).toBe(4);
    expect(game.board.inbound.count).toBe(JAMMER_CAP);
    expect(game.board.train.followers).toHaveLength(8);
  });
});

function closeWindow(game: Game, eats: number): number {
  const strengths: number[] = [];
  const off = game.bus.on('ghostVolley', (event) => strengths.push(event.count));
  for (let i = 0; i < eats; i++) {
    game.bus.emit({ type: 'ghostEaten', ghostId: 'blinky', strength: i + 1, combo: i + 1 });
  }
  game.sims.advanceGhostWindow(GHOST_ATTACK_WINDOW);
  off();
  return strengths.at(-1) ?? -1;
}

function park(game: Game): void {
  for (const ghost of game.board.ghosts) {
    ghost.mode = 'house';
    ghost.x = 14;
    ghost.y = 14;
    ghost.releaseAt = 1e9;
  }
}

function eatPellet(game: Game): void {
  park(game);
  const tile = findPellet(game);
  if (!tile) throw new Error('no power pellet');
  game.board.pac.x = tile.x;
  game.board.pac.y = tile.y;
  game.board.pac.dir = { x: 1, y: 0 };
  game.board.pac.alive = true;
  game.update(1 / 60);
  if (game.board.maze.tile(tile.x, tile.y) === Tile.Pellet) {
    throw new Error(`pellet at ${tile.x},${tile.y} was not eaten`);
  }
}

function findPellet(game: Game): { x: number; y: number } | null {
  const maze = game.board.maze;
  for (let y = 0; y < maze.rows; y++) {
    for (let x = 0; x < maze.cols; x++) {
      if (maze.tile(x, y) === Tile.Pellet) return { x, y };
    }
  }
  return null;
}

function wakeSleeper(game: Game, index: number): void {
  const y = SLEEPER_ROWS[index];
  if (y == null) throw new Error(`no sleeper ${index}`);
  park(game);
  game.board.pac.x = SLEEPER_LEFT_X;
  game.board.pac.y = y;
  game.board.pac.dir = { ...DIR_NONE };
  game.update(0);
}
