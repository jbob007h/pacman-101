import { describe, expect, it } from 'vitest';
import {
  EAT_GHOST_PAUSE,
  EAT_PAUSE_DECAY,
  EAT_PAUSE_FLOOR,
  eatPauseForChain,
  FRIGHT_SECONDS,
  FRUIT_TILE,
  GHOST_SCORE_BASE,
  pelletFill,
} from '../src/config';
import { Game } from '../src/game';
import { Maze } from '../src/gameplay/maze';
import {
  glideToward,
  SLEEPER_LEFT_X,
  SLEEPER_RIGHT_X,
  SLEEPER_ROWS,
  slotsBehind,
  sleeperTiles,
  TRAIN_CATCHUP,
  TRAIN_JOIN_SPEED,
  TRAIN_JOINED,
  mainGhostDistance,
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

  it('wakes a sleeper during a pellet without eating it until it reaches the back', () => {
    const game = new Game(() => 0.5);
    const events: string[] = [];
    game.bus.on('sleeperWoken', () => events.push('wake'));
    game.bus.on('trainGhostEaten', () => events.push('train'));
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    blinky.mode = 'chase';
    blinky.x = 7;
    blinky.y = 13;
    game.board.frightened = 9;
    game.board.pac.x = SLEEPER_LEFT_X;
    game.board.pac.y = 13;
    game.board.pac.dir = { ...DIR_NONE };

    game.update(0);
    expect(events).toEqual(['wake']);
    expect(game.board.score).toBe(0);
    expect(game.board.train.followers).toHaveLength(1);
    expect(game.board.train.followers[0]?.joined).toBe(false);
    expect(game.board.train.asleep()).toHaveLength(15);

    game.update(1 / 60);
    const joining = game.board.train.followers[0];
    if (!joining) throw new Error('missing follower');
    expect(joining.joined).toBe(false);
    expect(events).toEqual(['wake']);
    expect(Math.hypot(joining.x - joining.wakeX, joining.y - joining.wakeY)).toBeGreaterThan(0);
    expect(Math.hypot(joining.x - blinky.x, joining.y - blinky.y)).toBeGreaterThan(TRAIN_JOINED);

    for (let i = 0; i < 30 && !game.board.train.followers[0]?.joined; i++) game.update(1 / 60);
    const arrived = game.board.train.followers[0];
    if (!arrived) throw new Error('missing follower');
    expect(arrived.joined).toBe(true);
    expect(events).toEqual(['wake']);
    expect(Math.hypot(arrived.x - blinky.x, arrived.y - blinky.y)).toBeLessThanOrEqual(TRAIN_JOINED + 0.001);

    blinky.mode = 'house';
    blinky.x = 14;
    blinky.y = 14;
    game.board.pac.x = arrived.x;
    game.board.pac.y = arrived.y;
    game.update(0);
    expect(events).toEqual(['wake']);
    expect(game.board.train.followers).toHaveLength(1);
    expect(game.board.pac.alive).toBe(true);

    blinky.mode = 'frightened';
    game.update(0);
    expect(events).toEqual(['wake', 'train']);
    expect(game.board.train.followers).toHaveLength(0);
  });

  it('does not eat a follower that is still overlapping Pac while joining', () => {
    const game = new Game(() => 0.5);
    const events: string[] = [];
    game.bus.on('trainGhostEaten', () => events.push('train'));
    game.board.pac.x = 5;
    game.board.pac.y = 5;
    game.board.pac.dir = { ...DIR_NONE };
    game.board.frightened = 9;
    game.board.train.leaderId = 'blinky';
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    blinky.mode = 'frightened';
    blinky.x = 20;
    blinky.y = 5;
    const pending = follower(1, 5, 5);
    pending.joined = false;
    game.board.train.followers = [pending];
    game.update(0);
    expect(events).toEqual([]);
    expect(game.board.train.followers).toHaveLength(1);
    expect(game.board.score).toBe(0);
  });

  it('puts the first woken ghost behind the closest main ghost, even in the house', () => {
    const mains = ['blinky', 'pinky', 'inky', 'clyde'] as const;
    const game = new Game(() => 0.5);
    game.board.pac.x = SLEEPER_LEFT_X;
    game.board.pac.y = 13;
    game.board.pac.dir = { ...DIR_NONE };
    game.update(0);

    const leaderId = game.board.train.leaderId;
    expect(mains).toContain(leaderId);
    expect(leaderId).toBe('inky');
    expect(game.board.train.followers).toHaveLength(1);
    expect(game.board.train.headKind(game.board.ghosts)).toBe('main');
    const inky = game.board.ghosts.find((ghost) => ghost.id === 'inky');
    const follower = game.board.train.followers[0];
    if (!inky || !follower) throw new Error('missing train');
    expect(inky.mode).toBe('house');
    const before = Math.hypot(follower.x - inky.x, follower.y - inky.y);
    game.update(1 / 60);
    expect(game.board.train.leaderId).toBe('inky');
    expect(game.board.train.followers).toHaveLength(1);
    expect(Math.hypot(follower.x - inky.x, follower.y - inky.y)).toBeLessThan(before);

    for (const mode of ['eaten', 'frightened', 'house'] as const) {
      const again = new Game(() => 0.5);
      for (const ghost of again.board.ghosts) {
        ghost.x = 24;
        ghost.y = 24;
        ghost.mode = 'chase';
      }
      const blinky = again.board.ghosts[0];
      if (!blinky) throw new Error('missing blinky');
      blinky.mode = mode;
      blinky.x = 8;
      blinky.y = 13;
      again.board.pac.x = SLEEPER_LEFT_X;
      again.board.pac.y = 13;
      again.board.pac.dir = { ...DIR_NONE };
      again.update(0);
      expect(again.board.train.leaderId).toBe('blinky');
      expect(again.board.train.followers).toHaveLength(1);
      expect(again.board.train.headKind(again.board.ghosts)).toBe('main');
      const waking = again.board.train.followers[0];
      if (!waking) throw new Error('missing follower');
      const start = Math.hypot(waking.x - blinky.x, waking.y - blinky.y);
      again.board.train.update(1 / 60, again.board.ghosts, again.board.maze);
      expect(Math.hypot(waking.x - blinky.x, waking.y - blinky.y)).toBeLessThan(start);
      expect(waking.x).toBeGreaterThan(SLEEPER_LEFT_X);
    }
  });

  it('measures closest across the tunnel wrap in tile units', () => {
    const cols = 28;
    const tunnel = 14;
    const wrapped = mainGhostDistance(0.2, tunnel, 27.2, tunnel, cols, tunnel);
    const longWay = Math.hypot(27, 0);
    expect(wrapped).toBeLessThan(2);
    expect(wrapped).toBeLessThan(longWay);
    expect(mainGhostDistance(6, 13, -0.4, tunnel, cols, tunnel)).toBeCloseTo(
      mainGhostDistance(6, 13, 27.6, tunnel, cols, tunnel),
    );
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
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    blinky.x = 20;
    blinky.y = 5;
    game.board.train.followers[0]!.x = 5;
    game.board.train.followers[0]!.y = 5;
    game.update(0);
    expect(events).toEqual([]);
    expect(game.board.pac.alive).toBe(true);

    blinky.mode = 'frightened';
    game.update(0);
    expect(events).toEqual(['train']);
    expect(game.board.train.followers.map((item) => item.id)).toEqual([2, 3]);
    expect(game.board.score).toBe(GHOST_SCORE_BASE);
    expect(game.board.eatPause).toBe(EAT_GHOST_PAUSE);
    expect(game.board.pac.alive).toBe(true);
  });

  it('hands the eaten leader identity to the next train ghost instead of sending eyes home', () => {
    const game = new Game(() => 0.5);
    const events: string[] = [];
    game.bus.on('ghostEaten', () => events.push('main'));
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    const color = blinky.color;
    blinky.mode = 'frightened';
    blinky.x = 5;
    blinky.y = 5;
    game.board.pac.x = 5;
    game.board.pac.y = 5;
    game.board.pac.dir = { ...DIR_NONE };
    game.board.frightened = 4;
    game.board.train.leaderId = 'blinky';
    const next = follower(4, 8, 5);
    next.dir = { x: 1, y: 0 };
    game.board.train.followers = [next, follower(5, 9, 5)];
    game.update(0);
    expect(events).toEqual(['main']);
    expect(blinky.id).toBe('blinky');
    expect(blinky.color).toBe(color);
    expect(blinky.mode).toBe('frightened');
    expect(blinky.skipFright).toBe(false);
    expect(blinky.x).toBe(8);
    expect(blinky.y).toBe(5);
    expect(blinky.dir).toEqual({ x: 1, y: 0 });
    expect(game.board.train.leaderId).toBe('blinky');
    expect(game.board.train.followers.map((item) => item.id)).toEqual([5]);
    expect(game.board.train.headKind(game.board.ghosts)).toBe('main');
    expect(game.board.ghosts.filter((ghost) => ghost.id === 'blinky')).toHaveLength(1);
    expect(game.board.train.followers[0]?.x).toBe(9);
    expect(game.board.train.followers[0]?.y).toBe(5);
  });

  it('leaves the rest of the train on its tiles when the leader is eaten', () => {
    const game = new Game(() => 0);
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    blinky.mode = 'frightened';
    blinky.x = 4;
    blinky.y = 5;
    blinky.dir = { x: 1, y: 0 };
    game.board.train.leaderId = 'blinky';
    game.board.train.followers = [follower(1, 4, 5), follower(2, 4, 5), follower(3, 4, 5)];
    const maze = game.board.maze;
    for (let step = 0; step < 50; step++) {
      blinky.x += 0.12;
      game.board.train.update(1 / 60, game.board.ghosts, maze);
    }
    const spread = game.board.train.followers.map((item) => item.x);
    expect(spread[0]! - spread[2]!).toBeGreaterThan(1.2);
    const promoted = game.board.train.followers[0];
    if (!promoted) throw new Error('missing promoted ghost');
    const frozen = game.board.train.followers.slice(1).map((item) => ({ x: item.x, y: item.y }));
    game.board.train.handoffLeader(blinky, maze);
    expect(blinky.x).toBeCloseTo(promoted.x);
    expect(blinky.y).toBeCloseTo(promoted.y);
    expect(game.board.train.followers.map((item) => item.x)).toEqual(frozen.map((item) => item.x));
    expect(game.board.train.followers.map((item) => item.y)).toEqual(frozen.map((item) => item.y));

    game.board.train.update(1 / 60, game.board.ghosts, maze);
    for (let i = 0; i < frozen.length; i++) {
      const follower = game.board.train.followers[i];
      const spot = frozen[i];
      if (!follower || !spot) throw new Error('missing follower');
      expect(follower.x).toBeCloseTo(spot.x, 5);
      expect(follower.y).toBeCloseTo(spot.y, 5);
    }

    blinky.x += 0.35;
    game.board.train.update(1 / 60, game.board.ghosts, maze);
    for (let i = 0; i < frozen.length; i++) {
      const follower = game.board.train.followers[i];
      const spot = frozen[i];
      if (!follower || !spot) throw new Error('missing follower');
      expect(Math.hypot(follower.x - spot.x, follower.y - spot.y)).toBeLessThan(0.5);
      expect(Math.hypot(follower.x - blinky.x, follower.y - blinky.y)).toBeGreaterThan(0.5);
    }
  });

  it('sends the leader home as eyes only when the train has no next ghost', () => {
    const game = new Game(() => 0.5);
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
    game.update(0);
    expect(blinky.mode).toBe('eaten');
    expect(blinky.skipFright).toBe(true);
    expect(blinky.x).toBe(5);
    expect(blinky.y).toBe(5);
  });

  it('hands off whichever main ghost is leading, and still eyes a ghost who is not the leader', () => {
    const game = new Game(() => 0.5);
    const blinky = game.board.ghosts[0];
    const pinky = game.board.ghosts[1];
    if (!blinky || !pinky) throw new Error('missing ghosts');
    const pink = pinky.color;
    pinky.mode = 'frightened';
    pinky.x = 5;
    pinky.y = 5;
    blinky.mode = 'frightened';
    blinky.x = 20;
    blinky.y = 5;
    game.board.pac.x = 5;
    game.board.pac.y = 5;
    game.board.pac.dir = { ...DIR_NONE };
    game.board.frightened = 4;
    game.board.train.leaderId = 'pinky';
    game.board.train.followers = [follower(7, 11, 5)];
    game.update(0);
    expect(pinky.id).toBe('pinky');
    expect(pinky.color).toBe(pink);
    expect(pinky.mode).toBe('frightened');
    expect(pinky.x).toBe(11);
    expect(pinky.y).toBe(5);
    expect(blinky.mode).toBe('frightened');
    expect(blinky.x).toBe(20);

    game.board.eatPause = 0;
    game.board.train.leaderId = 'pinky';
    game.board.train.followers = [follower(8, 3, 5)];
    blinky.x = 5;
    blinky.y = 5;
    game.board.pac.x = 5;
    game.board.pac.y = 5;
    game.update(0);
    expect(blinky.mode).toBe('eaten');
    expect(pinky.x).toBe(11);
    expect(game.board.train.followers).toHaveLength(1);
    expect(game.board.train.leaderId).toBe('pinky');
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

  it('reloads the sleepers when the fruit advances the board and leaves the main ghosts', () => {
    const game = new Game(() => 0.5);
    const ghosts = game.board.ghosts;
    for (const ghost of ghosts) ghost.mode = 'chase';
    const blinky = ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    blinky.x = SLEEPER_LEFT_X;
    blinky.y = 14;

    game.board.pac.x = SLEEPER_LEFT_X;
    game.board.pac.y = 13;
    game.board.pac.dir = { ...DIR_NONE };
    game.update(0);
    game.board.pac.y = 12;
    game.update(0);
    expect(game.board.train.followers).toHaveLength(2);
    const shifted = game.board.train.sleepers.find((sleeper) => sleeper.awake);
    if (!shifted) throw new Error('missing awake sleeper');
    shifted.x += 4;

    const handedFrom = game.board.train.followers[0];
    if (!handedFrom) throw new Error('missing follower');
    const handedAt = { x: handedFrom.x, y: handedFrom.y };
    game.board.frightened = 5;
    expect(game.board.train.handoffLeader(blinky, game.board.maze)).toBe(true);
    expect(game.board.train.followers).toHaveLength(1);
    const mains = ghosts.map((ghost) => ({
      id: ghost.id,
      color: ghost.color,
      mode: ghost.mode,
      x: ghost.x,
      y: ghost.y,
    }));

    game.board.fruit = { ...FRUIT_TILE };
    game.board.pac.x = FRUIT_TILE.x;
    game.board.pac.y = FRUIT_TILE.y;
    game.board.pac.dir = { x: -1, y: 0 };
    game.update(0);

    expect(game.board.boardIndex).toBe(1);
    expect(game.board.maze.remaining()).toBeGreaterThan(1);
    expect(game.board.train.followers).toHaveLength(0);
    expect(game.board.train.leaderId).toBeNull();
    expect(game.board.train.asleep()).toHaveLength(16);
    expect(game.board.train.sleepers.map((sleeper) => ({ x: sleeper.x, y: sleeper.y, awake: sleeper.awake }))).toEqual(
      sleeperTiles().map((tile) => ({ x: tile.x, y: tile.y, awake: false })),
    );
    expect(ghosts.map((ghost) => ({ id: ghost.id, color: ghost.color, mode: ghost.mode, x: ghost.x, y: ghost.y }))).toEqual(mains);
    expect(blinky.x).toBe(handedAt.x);
    expect(blinky.y).toBe(handedAt.y);
    expect(blinky.mode).toBe('frightened');

    game.board.pac.dir = { ...DIR_NONE };
    while (game.board.clearPause > 0) game.update(0.05);
    game.board.pac.x = SLEEPER_RIGHT_X;
    game.board.pac.y = SLEEPER_ROWS[0] ?? 10;
    game.update(0);
    expect(game.board.train.leaderId).not.toBeNull();
    expect(game.board.train.followers).toHaveLength(1);
    expect(game.board.train.asleep()).toHaveLength(15);
  });

  it('keeps an awakened train when the pellets are cleared without the fruit', () => {
    const game = new Game(() => 0.5);
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    blinky.mode = 'chase';
    blinky.x = SLEEPER_LEFT_X;
    blinky.y = 14;
    game.board.pac.x = SLEEPER_LEFT_X;
    game.board.pac.y = 13;
    game.board.pac.dir = { ...DIR_NONE };
    game.update(0);
    expect(game.board.train.followers).toHaveLength(1);

    const maze = game.board.maze;
    const last = { x: 5, y: 5 };
    for (let y = 0; y < maze.rows; y++) {
      for (let x = 0; x < maze.cols; x++) {
        if (x === last.x && y === last.y) continue;
        maze.consume(x, y);
      }
    }
    game.board.pac.dir = { x: 0, y: -1 };
    game.board.pac.x = last.x;
    game.board.pac.y = last.y;
    game.update(1 / 60);
    expect(game.board.boardIndex).toBe(0);
    expect(maze.remaining()).toBe(0);
    expect(game.board.train.followers).toHaveLength(1);
    expect(game.board.train.asleep()).toHaveLength(15);
  });

  it('flies a woken ghost through walls in a straight line and will not eat it until it joins', () => {
    const game = new Game(() => 0.5);
    const events: string[] = [];
    game.bus.on('trainGhostEaten', () => events.push('train'));
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    blinky.mode = 'chase';
    blinky.x = 9;
    blinky.y = 13;
    game.board.frightened = 9;
    game.board.pac.x = SLEEPER_LEFT_X;
    game.board.pac.y = 13;
    game.board.pac.dir = { ...DIR_NONE };
    expect(game.board.maze.blocks(7, 13, 'ghost')).toBe(true);

    game.update(0);
    const joining = game.board.train.followers[0];
    if (!joining) throw new Error('missing follower');
    expect(joining.joined).toBe(false);
    expect(events).toEqual([]);

    game.update(1 / 60);
    const flown = game.board.train.followers[0];
    if (!flown) throw new Error('missing follower');
    expect(flown.joined).toBe(false);
    expect(flown.y).toBe(13);
    expect(flown.x - SLEEPER_LEFT_X).toBeCloseTo(TRAIN_JOIN_SPEED / 60);
    expect(Math.round(flown.x)).toBe(7);
    expect(game.board.maze.blocks(Math.round(flown.x), Math.round(flown.y), 'ghost')).toBe(true);
    expect(TRAIN_JOIN_SPEED).toBeGreaterThan(game.board.speeds().ghost * 3);
    expect(events).toEqual([]);

    game.board.pac.x = flown.x;
    game.board.pac.y = flown.y;
    game.update(0);
    expect(events).toEqual([]);
    expect(game.board.score).toBe(0);
    expect(game.board.pac.alive).toBe(true);

    game.board.pac.x = 1;
    game.board.pac.y = 23;
    for (let i = 0; i < 20 && !game.board.train.followers[0]?.joined; i++) game.update(1 / 60);
    const arrived = game.board.train.followers[0];
    if (!arrived) throw new Error('missing follower');
    expect(arrived.joined).toBe(true);
    expect(Math.hypot(arrived.x - blinky.x, arrived.y - blinky.y)).toBeLessThanOrEqual(TRAIN_JOINED + 0.05);

    blinky.mode = 'house';
    blinky.skipFright = false;
    blinky.x = 14;
    blinky.y = 14;
    game.board.pac.x = arrived.x;
    game.board.pac.y = arrived.y;
    game.update(0);
    expect(events).toEqual([]);
    expect(game.board.train.followers).toHaveLength(1);
    expect(game.board.pac.alive).toBe(true);

    blinky.mode = 'frightened';
    game.update(0);
    expect(events).toEqual(['train']);
  });

  it('keeps joined followers inedible unless the leader mode is frightened', () => {
    const game = new Game(() => 0.5);
    const events: string[] = [];
    game.bus.on('trainGhostEaten', () => events.push('train'));
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    blinky.mode = 'chase';
    blinky.skipFright = true;
    blinky.x = 20;
    blinky.y = 5;
    game.board.frightened = 4;
    game.board.pac.x = 5;
    game.board.pac.y = 5;
    game.board.pac.dir = { ...DIR_NONE };
    game.board.train.leaderId = 'blinky';
    game.board.train.followers = [follower(1, 5, 5)];
    game.update(0);
    expect(events).toEqual([]);
    expect(game.board.pac.alive).toBe(true);
    expect(game.board.train.followers).toHaveLength(1);

    blinky.mode = 'house';
    blinky.skipFright = false;
    game.update(0);
    expect(events).toEqual([]);
    expect(game.board.train.followers).toHaveLength(1);

    blinky.mode = 'frightened';
    game.update(0);
    expect(events).toEqual(['train']);
    expect(game.board.train.followers).toHaveLength(0);
    expect(game.board.pac.alive).toBe(true);
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
    joined: true,
    wakeX: x,
    wakeY: y,
  };
}
