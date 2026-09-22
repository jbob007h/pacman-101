import { describe, expect, it } from 'vitest';
import {
  EAT_GHOST_PAUSE,
  EAT_PAUSE_DECAY,
  EAT_PAUSE_FLOOR,
  eatPauseForChain,
  FRIGHT_SECONDS,
  GHOST_SCORE_BASE,
  pelletFill,
} from '../src/config';
import { Game } from '../src/game';
import { Maze } from '../src/gameplay/maze';
import {
  glideToward,
  leaderYields,
  SLEEPER_LEFT_X,
  SLEEPER_RIGHT_X,
  SLEEPER_ROWS,
  slotsBehind,
  sleeperTiles,
  TRAIN_CATCHUP,
  TRAIN_MAX_FOLLOWERS,
  TRAIN_SPACING,
  TRAIN_TUNNEL_SPACING,
  type TrainFollower,
} from '../src/gameplay/train';
import { DIR_LEFT, DIR_NONE } from '../src/shared/types';

describe('sleeping ghosts and the train', () => {
  it('parks eight sleepers on each vertical corridor beside the tunnels', () => {
    const tiles = sleeperTiles();
    expect(tiles).toHaveLength(16);
    expect(tiles.filter((tile) => tile.x === SLEEPER_LEFT_X)).toHaveLength(8);
    expect(tiles.filter((tile) => tile.x === SLEEPER_RIGHT_X)).toHaveLength(8);
    expect(tiles.map((tile) => tile.y)).toEqual([...SLEEPER_ROWS, ...SLEEPER_ROWS]);
    expect(tiles.some((tile) => tile.y === 14)).toBe(false);

    const maze = new Maze();
    for (const tile of tiles) {
      expect(maze.blocks(tile.x, tile.y, 'pac')).toBe(false);
      expect(tile.x).toBe(Math.round(tile.x));
      expect(tile.y).toBe(Math.round(tile.y));
    }

    const game = new Game(() => 0.5);
    expect(game.board.train.sleepers).toHaveLength(16);
    expect(game.board.train.asleep()).toHaveLength(16);
  });

  it('spaces followers by 1 tile, and by half a tile along the tunnel', () => {
    const open = slotsBehind(
      [
        { x: 0, y: 5 },
        { x: 10, y: 5 },
      ],
      2,
      () => TRAIN_SPACING,
      28,
      14,
    );
    expect(open[0]).toEqual({ x: 9, y: 5 });
    expect(open[1]).toEqual({ x: 8, y: 5 });

    const tunnel = slotsBehind(
      [
        { x: 0, y: 14 },
        { x: 10, y: 14 },
      ],
      2,
      () => TRAIN_TUNNEL_SPACING,
      28,
      14,
    );
    expect(tunnel[0]?.x).toBeCloseTo(9.5);
    expect(tunnel[1]?.x).toBeCloseTo(9);
  });

  it('glides a short gap closed instead of teleporting', () => {
    const member = { x: 7, y: 5, dir: { ...DIR_LEFT } };
    glideToward(member, { x: 8, y: 5 }, 1 / 60, 28, 14);
    expect(member.x).toBeCloseTo(7 + TRAIN_CATCHUP / 60);
    expect(member.x).toBeLessThan(8);
    glideToward(member, { x: 20, y: 5 }, 1 / 60, 28, 14);
    expect(member.x).toBe(20);
  });

  it('wakes into one train behind the closest main ghost and appends after that', () => {
    const game = new Game(() => 0.5);
    const ghosts = game.board.ghosts;
    for (const ghost of ghosts) {
      ghost.x = 24;
      ghost.y = 24;
      ghost.mode = 'chase';
    }
    const blinky = ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    blinky.x = 6;
    blinky.y = 14;

    game.board.pac.x = 6;
    game.board.pac.y = 13;
    game.board.pac.dir = { ...DIR_NONE };
    const seen: string[] = [];
    game.bus.on('sleeperWoken', () => seen.push('wake'));
    game.update(0);
    expect(seen).toEqual(['wake']);
    expect(game.board.train.leaderId).toBe('blinky');
    expect(game.board.train.followers).toHaveLength(1);
    expect(game.board.train.headKind(ghosts)).toBe('main');
    expect(game.board.train.asleep()).toHaveLength(15);

    game.board.pac.y = 12;
    game.update(0);
    expect(game.board.train.leaderId).toBe('blinky');
    expect(game.board.train.followers).toHaveLength(2);
    expect(game.board.pac.alive).toBe(true);
  });

  it('does nothing when the train is already full', () => {
    const game = new Game(() => 0.5);
    game.board.train.leaderId = 'blinky';
    game.board.train.followers = Array.from({ length: TRAIN_MAX_FOLLOWERS }, (_, id) => follower(id, 3, 3));
    game.board.pac.x = SLEEPER_LEFT_X;
    game.board.pac.y = SLEEPER_ROWS[0] ?? 10;
    game.board.pac.dir = { ...DIR_NONE };
    game.update(0);
    expect(game.board.train.followers).toHaveLength(TRAIN_MAX_FOLLOWERS);
    expect(game.board.train.sleepers.every((sleeper) => !sleeper.awake)).toBe(true);
  });

  it('does not let a follower kill Pac, and eats one when the pellet is active', () => {
    const game = new Game(() => 0.5);
    const events: string[] = [];
    game.bus.on('ghostEaten', () => events.push('main'));
    game.bus.on('trainGhostEaten', () => events.push('train'));
    game.board.pac.x = 5;
    game.board.pac.y = 5;
    game.board.pac.dir = { ...DIR_NONE };
    game.board.train.leaderId = 'blinky';
    game.board.train.followers = [follower(1, 5, 5), follower(2, 8, 5), follower(3, 7, 5)];
    game.update(0);
    expect(game.board.pac.alive).toBe(true);
    expect(events).toEqual([]);

    game.board.frightened = 4;
    game.board.train.followers[0]!.x = 5;
    game.board.train.followers[0]!.y = 5;
    game.update(0);
    expect(events).toEqual(['train']);
    expect(game.board.train.followers.map((item) => item.id)).toEqual([2, 3]);
    expect(game.board.score).toBe(GHOST_SCORE_BASE);
    expect(game.board.eatPause).toBe(EAT_GHOST_PAUSE);
    expect(game.board.pac.alive).toBe(true);
  });

  it('eats the main leader with the usual rules and promotes the next follower', () => {
    const game = new Game(() => 0.5);
    const events: string[] = [];
    game.bus.on('ghostEaten', () => events.push('main'));
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    blinky.mode = 'frightened';
    blinky.x = 5;
    blinky.y = 5;
    game.board.pac.x = 5;
    game.board.pac.y = 5;
    game.board.pac.dir = { ...DIR_NONE };
    game.board.frightened = 4;
    game.board.train.leaderId = 'blinky';
    game.board.train.followers = [follower(4, 8, 5)];
    game.update(0);
    expect(events).toEqual(['main']);
    expect(blinky.mode).toBe('eaten');
    expect(game.board.train.followers).toHaveLength(1);
    expect(game.board.train.headKind(game.board.ghosts)).toBe('temporary');
    expect(leaderYields('eaten')).toBe(true);
    expect(leaderYields('house')).toBe(true);
    expect(leaderYields('chase')).toBe(false);
  });

  it('shortens each successive eat pause and resets after two active seconds', () => {
    const game = new Game(() => 0.5);
    const blinky = game.board.ghosts[0];
    const pinky = game.board.ghosts[1];
    if (!blinky || !pinky) throw new Error('missing ghosts');
    game.board.pac.x = 5;
    game.board.pac.y = 5;
    game.board.pac.dir = { ...DIR_NONE };
    game.board.frightened = 9;

    blinky.mode = 'frightened';
    blinky.x = 5;
    blinky.y = 5;
    game.update(0);
    expect(game.board.eatPause).toBeCloseTo(eatPauseForChain(1));

    while (game.board.eatPause > 0) game.update(0.05);
    pinky.mode = 'frightened';
    pinky.x = 5;
    pinky.y = 5;
    game.board.pac.x = 5;
    game.board.pac.y = 5;
    game.update(0);
    expect(game.board.eatPause).toBeCloseTo(EAT_GHOST_PAUSE * EAT_PAUSE_DECAY);
    expect(game.board.eatPause).toBeLessThan(EAT_GHOST_PAUSE);

    while (game.board.eatPause > 0) game.update(0.05);
    for (let i = 0; i < 40; i++) game.update(0.05);
    const clyde = game.board.ghosts[2];
    if (!clyde) throw new Error('missing clyde');
    clyde.mode = 'frightened';
    clyde.x = 5;
    clyde.y = 5;
    game.board.pac.x = 5;
    game.board.pac.y = 5;
    game.update(0);
    expect(game.board.eatPause).toBeCloseTo(EAT_GHOST_PAUSE);
    expect(eatPauseForChain(8)).toBe(EAT_PAUSE_FLOOR);
  });

  it('starts the pellet ring full and adds 1.5s when a ghost is eaten under 1.5s', () => {
    expect(pelletFill(FRIGHT_SECONDS)).toBe(1);
    expect(pelletFill(FRIGHT_SECONDS / 2)).toBeCloseTo(0.5);
    expect(pelletFill(0)).toBe(0);

    const fresh = new Game(() => 0.5);
    park(fresh);
    fresh.board.pac.x = 1;
    fresh.board.pac.y = 23;
    fresh.board.pac.dir = { x: 1, y: 0 };
    fresh.update(1 / 60);
    expect(fresh.board.frightened).toBe(FRIGHT_SECONDS);
    expect(pelletFill(fresh.board.frightened)).toBe(1);

    const game = new Game(() => 0.5);
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    game.board.pac.x = 5;
    game.board.pac.y = 5;
    game.board.pac.dir = { ...DIR_NONE };
    blinky.mode = 'frightened';
    blinky.x = 5;
    blinky.y = 5;
    game.board.frightened = 1.5;
    game.update(0);
    expect(game.board.frightened).toBe(1.5);

    while (game.board.eatPause > 0) game.update(0.05);
    const pinky = game.board.ghosts[1];
    if (!pinky) throw new Error('missing pinky');
    pinky.mode = 'frightened';
    pinky.x = 5;
    pinky.y = 5;
    game.board.pac.x = 5;
    game.board.pac.y = 5;
    game.board.frightened = 1.49;
    game.update(0);
    expect(game.board.frightened).toBeCloseTo(1.49 + 1.5);
    expect(pelletFill(game.board.frightened)).toBeCloseTo((1.49 + 1.5) / FRIGHT_SECONDS);
  });
});

function park(game: Game): void {
  for (const ghost of game.board.ghosts) {
    ghost.mode = 'house';
    ghost.releaseAt = 1e9;
  }
}

function follower(id: number, x: number, y: number): TrainFollower {
  return {
    id,
    x,
    y,
    dir: { ...DIR_LEFT },
    queued: null,
    centerKey: -1,
    reversePending: false,
  };
}
