import {
  CLEAR_SPEED_BONUS,
  COLLIDE_DISTANCE,
  SPEED_POPUP_SECONDS,
  DOT_SCORE,
  elroyLevel,
  DOT_STOP_FRAMES,
  EAT_CHAIN_RESET,
  eatPauseForChain,
  FRIGHT_SECONDS,
  GHOST_SCORE_BASE,
  PELLET_EXTEND_SECONDS,
  PELLET_EXTEND_THRESHOLD,
  FRUIT_SCORE,
  FRUIT_TILE,
  PAC_START,
  PELLET_SCORE,
  POWER_STOP_FRAMES,
  speedsForBoard,
  type BoardSpeeds,
} from '../config';
import type { EventBus } from '../shared/events';
import type { Rng } from '../shared/rng';
import type { Dir } from '../shared/types';
import { DIR_NONE } from '../shared/types';
import { createGhosts, updateGhost, type Ghost, type GhostMode } from './ghosts';
import { InboundField } from './inbound';
import { Maze } from './maze';
import { GhostTrain } from './train';
import { advanceMover, applyQueuedTurn, type Mover } from './movement';

export interface Pac extends Mover {
  alive: boolean;
  anim: number;
}

interface Wave {
  mode: 'chase' | 'scatter';
  duration: number;
}

const WAVES: readonly Wave[] = [
  { mode: 'chase', duration: 18 },
  { mode: 'scatter', duration: 6 },
  { mode: 'chase', duration: 18 },
  { mode: 'scatter', duration: 6 },
  { mode: 'chase', duration: 18 },
  { mode: 'scatter', duration: 5 },
  { mode: 'chase', duration: 1e9 },
];

/**
 * Main-board simulation. Emits gameplay events and never touches sims or the HUD.
 * Incoming jammers are spawned through {@link Board.spawnInbound}.
 */
export class Board {
  readonly maze: Maze;
  readonly inbound = new InboundField();
  pac: Pac;
  ghosts: Ghost[];
  score = 0;
  time = 0;
  frightened = 0;
  /** Match clock, copied from the composition root. Slow duration reads it. */
  matchTime = 0;
  deathTime = 0;
  clearPause = 0;
  /** Freeze after eating a frightened ghost. Gameplay clocks do not advance. */
  eatPause = 0;
  lastEatPoints = 0;
  /** Zero-based. Eating the fruit advances it and raises the pace. */
  boardIndex = 0;
  /**
   * Player-facing Speed. Starts at 0. Goes up by 1 on every full pellet clear,
   * and by 1 again when fruit advances off an even board (2, 4, 6…).
   */
  displayedSpeed = 0;
  /** Full pellet clears this match. Each one adds {@link CLEAR_SPEED_BONUS} to Pac until restart. */
  clearBoost = 0;
  /**
   * Seconds left on the "Speed Up!" callout. Set when the last pellet is eaten
   * and ticked even while the clear pause holds Pac still.
   */
  speedPopup = 0;
  /** Awakened sleepers lined up behind one main ghost. */
  readonly train = new GhostTrain();
  /** Ghost eats since the last 2s gap. Drives the shrinking eat pause. */
  private eatChain = 0;
  /** Active seconds since the last ghost eat. The eat pause itself does not add to this. */
  private sinceGhostEat = 0;
  /** Fruit sitting under the ghost house, or null when none is out. */
  fruit: { x: number; y: number } | null = null;
  dotsEaten = 0;
  combo = 0;
  /** Edible dots + power pellets at the start of the current pellet set. Fruit is not included. */
  private boardPellets = 0;
  /**
   * Simulation frames Pac skips movement after a bite.
   * One {@link Board.update} call is one frame when the browser steps at 60Hz.
   */
  private biteStop = 0;
  private fruitSpawned = false;
  private waveIndex = 0;
  private waveTime: number = WAVES[0]?.duration ?? 18;
  wave: 'chase' | 'scatter' = WAVES[0]?.mode ?? 'chase';

  constructor(
    private readonly bus: EventBus,
    private readonly rng: Rng,
    maze: Maze = new Maze(),
  ) {
    this.maze = maze;
    this.pac = spawnPac();
    this.ghosts = createGhosts();
    this.maze.consume(PAC_START.x, PAC_START.y);
    this.boardPellets = this.maze.remaining();
  }

  get playing(): boolean {
    return this.pac.alive && this.clearPause <= 0 && this.eatPause <= 0;
  }

  speeds(): BoardSpeeds {
    return speedsForBoard(this.boardIndex);
  }

  /** Board pace plus the permanent full-clear bonus. The HUD Speed number is {@link displayedSpeed}. */
  pacSpeed(): number {
    const base = this.speeds().pac + this.clearBoost * CLEAR_SPEED_BONUS;
    if (this.inbound.slow <= 0) return base;
    return base * this.inbound.slowFactor;
  }

  /**
   * Pac's board pace plus full-clear bonuses, before the white-jammer slow.
   * Jammers scale off this. Ghosts and Elroy do not — they use {@link basePacPace}.
   */
  chaseSpeed(): number {
    return this.speeds().pac + this.clearBoost * CLEAR_SPEED_BONUS;
  }

  /**
   * Pac's board pace with no full-clear Speed bonus.
   * Elroy 1 matches this number. Elroy 2 is 1.1× it. Ghost chase and fright
   * come from the board table alone, so a Speed Up never speeds the ghosts.
   */
  basePacPace(): number {
    return this.speeds().pac;
  }

  setDirection(dir: Dir | null): void {
    if (!this.pac.alive) return;
    this.pac.queued = dir;
  }

  /**
   * Systems hook: a sim threw jammers onto the maze.
   * Returns how many sprites spawned. Overflow past the cap is not spawned.
   */
  spawnInbound(strength: number): number {
    if (!this.pac.alive) return 0;
    return this.inbound.spawn(strength, this.matchTime, this.maze, this.pac.x, this.pac.y, this.rng);
  }

  update(dt: number): void {
    const step = Math.min(dt, 0.05);
    if (!this.pac.alive) {
      this.deathTime += step;
      return;
    }
    if (this.speedPopup > 0) this.speedPopup = Math.max(0, this.speedPopup - step);
    if (this.eatPause > 0) {
      this.eatPause = Math.max(0, this.eatPause - step);
      this.spendBite(step);
      return;
    }
    this.time += step;
    this.sinceGhostEat += step;
    const pacX0 = this.pac.x;
    const pacY0 = this.pac.y;
    this.inbound.update(step, this.maze, this.pac.x, this.pac.y, this.chaseSpeed(), this.redsFrozen());
    if (this.clearPause > 0) {
      this.clearPause -= step;
      this.spendBite(step);
      return;
    }
    this.movePac(step);
    const started = this.pac.dir.x !== 0 || this.pac.dir.y !== 0;
    if (!started) {
      this.moveGhosts(step, true);
      this.stepTrain(step);
      if (this.inbound.touch(this.pac.x, this.pac.y, this.matchTime, pacX0, pacY0)) this.kill();
      this.collide();
      return;
    }
    this.tickModes(step);
    this.consumeTile();
    this.tryEatFruit();
    if (this.redsFrozen()) this.inbound.holdReds();
    if (!this.pac.alive) return;
    this.moveGhosts(step, false);
    this.stepTrain(step);
    if (this.inbound.touch(this.pac.x, this.pac.y, this.matchTime, pacX0, pacY0)) this.kill();
    if (this.clearPause > 0) return;
    this.collide();
  }

  reset(): void {
    this.maze.resetDots();
    this.pac = spawnPac();
    this.ghosts = createGhosts();
    this.score = 0;
    this.time = 0;
    this.frightened = 0;
    this.deathTime = 0;
    this.clearPause = 0;
    this.eatPause = 0;
    this.biteStop = 0;
    this.lastEatPoints = 0;
    this.boardIndex = 0;
    this.displayedSpeed = 0;
    this.clearBoost = 0;
    this.speedPopup = 0;
    this.eatChain = 0;
    this.sinceGhostEat = 0;
    this.train.reset();
    this.fruit = null;
    this.fruitSpawned = false;
    this.dotsEaten = 0;
    this.combo = 0;
    this.waveIndex = 0;
    this.wave = WAVES[0]?.mode ?? 'chase';
    this.waveTime = WAVES[0]?.duration ?? 18;
    this.maze.consume(PAC_START.x, PAC_START.y);
    this.boardPellets = this.maze.remaining();
    this.matchTime = 0;
    this.inbound.reset();
  }

  private tickModes(dt: number): void {
    if (this.frightened > 0) {
      this.frightened -= dt;
      if (this.frightened <= 0) {
        this.frightened = 0;
        this.combo = 0;
        for (const ghost of this.ghosts) {
          if (ghost.mode === 'frightened') {
            ghost.mode = this.wave;
            ghost.reversePending = true;
          }
        }
      }
      return;
    }
    this.waveTime -= dt;
    if (this.waveTime <= 0) this.advanceWave();
  }

  private advanceWave(): void {
    this.waveIndex = Math.min(this.waveIndex + 1, WAVES.length - 1);
    const wave = WAVES[this.waveIndex] ?? WAVES[WAVES.length - 1];
    if (!wave) return;
    this.wave = wave.mode;
    this.waveTime = wave.duration;
    for (const ghost of this.ghosts) {
      if (ghost.mode === 'chase' || ghost.mode === 'scatter') {
        ghost.mode = wave.mode;
        ghost.reversePending = true;
      }
    }
  }

  private movePac(dt: number): void {
    if (this.biteStop > 0) {
      this.spendBite(dt);
      return;
    }
    const traveled = advanceMover(
      this.pac,
      dt,
      this.pacSpeed(),
      (x, y) => this.maze.blocks(x, y, 'pac'),
      this.maze.tunnelRow,
      this.maze.cols,
      () => applyQueuedTurn(this.pac, (x, y) => this.maze.blocks(x, y, 'pac')),
    );
    if (traveled > 0) this.pac.anim += traveled * 1.6;
  }

  private consumeTile(): void {
    const x = Math.round(this.pac.x);
    const y = Math.round(this.pac.y);
    if (Math.hypot(this.pac.x - x, this.pac.y - y) > 0.45) return;
    const kind = this.maze.consume(x, y);
    if (!kind) return;
    if (kind === 'dot') {
      this.score += DOT_SCORE;
      this.biteStop = DOT_STOP_FRAMES;
    } else {
      this.score += PELLET_SCORE;
      this.biteStop = POWER_STOP_FRAMES;
      this.combo = 0;
      this.frighten();
      this.bus.emit({ type: 'powerPelletEaten' });
    }
    this.dotsEaten += 1;
    const remaining = this.maze.remaining();
    this.bus.emit({ type: 'dotEaten', totalEaten: this.dotsEaten, remaining });
    this.maybeSpawnFruit(remaining);
    if (remaining === 0) this.onPelletsCleared();
  }

  /**
   * Half of the current pellet set (dots + power pellets, fruit excluded).
   * Threshold is `ceil(boardPellets / 2)` eaten, counted from the set that was on the board
   * after the silent spawn-tile consume or the latest refill.
   */
  private maybeSpawnFruit(remaining: number): void {
    if (this.fruitSpawned || this.boardPellets <= 0) return;
    const eaten = this.boardPellets - remaining;
    if (eaten < Math.ceil(this.boardPellets / 2)) return;
    this.fruitSpawned = true;
    this.fruit = { x: FRUIT_TILE.x, y: FRUIT_TILE.y };
  }

  /**
   * Full clear adds 1 to the Speed readout, permanently speeds Pac, and sends a jammer.
   * It does not advance the board or reload dots. The fruit, if it is already out, stays until eaten.
   * Speed is committed before the event so a listener cannot observe the pre-clear meter.
   */
  private onPelletsCleared(): void {
    this.clearBoost += 1;
    this.displayedSpeed += 1;
    this.speedPopup = SPEED_POPUP_SECONDS;
    this.clearPause = 0.7;
    this.bus.emit({ type: 'boardCleared' });
  }

  private tryEatFruit(): void {
    const fruit = this.fruit;
    if (!fruit) return;
    if (Math.hypot(this.pac.x - fruit.x, this.pac.y - fruit.y) > 0.45) return;
    this.score += FRUIT_SCORE;
    this.advanceFromFruit();
  }

  /**
   * Same refill and pace step the maze used to take on a full clear.
   * Sleepers reload with the pellets: the train is dissolved and all 16 go
   * back to sleep on their original tiles. Main ghosts are not retargeted
   * or moved here.
   */
  private advanceFromFruit(): void {
    const finishedBoard = this.boardIndex + 1;
    if (finishedBoard % 2 === 0) this.displayedSpeed += 1;
    this.boardIndex += 1;
    this.fruit = null;
    this.fruitSpawned = false;
    this.maze.resetDots();
    this.boardPellets = this.maze.remaining();
    this.train.reset();
    this.inbound.killReds();
    this.clearPause = 0.7;
  }

  /** One logic frame of the post-bite hitch. Longer pauses absorb it so it does not stack. */
  private spendBite(step: number): void {
    if (step > 0 && this.biteStop > 0) this.biteStop -= 1;
  }

  private redsFrozen(): boolean {
    if (this.frightened > 0) return true;
    return this.ghosts.some((ghost) => ghost.mode === 'frightened');
  }

  private frighten(): void {
    this.inbound.killWhites();
    this.frightened = FRIGHT_SECONDS;
    for (const ghost of this.ghosts) {
      ghost.skipFright = false;
      if (isHuntable(ghost.mode) || ghost.mode === 'frightened') {
        ghost.mode = 'frightened';
        ghost.reversePending = true;
      }
    }
  }

  private moveGhosts(dt: number, idle: boolean): void {
    const elroy = elroyLevel(this.boardIndex, this.maze.remaining());
    const pacPace = this.basePacPace();
    for (const ghost of this.ghosts) {
      if (idle && ghost.mode !== 'house') continue;
      const blinky = this.ghosts[0];
      updateGhost(ghost, {
        dt,
        time: idle ? -1 : this.time,
        maze: this.maze,
        wave: this.wave,
        frightenedLeft: this.frightened,
        incoming: false,
        speeds: this.speeds(),
        pacX: this.pac.x,
        pacY: this.pac.y,
        pacDir: this.pac.dir,
        blinkyX: blinky?.x ?? this.pac.x,
        blinkyY: blinky?.y ?? this.pac.y,
        rng: this.rng,
        elroy,
        pacPace,
      });
    }
  }

  private stepTrain(step: number): void {
    const woke = this.train.touch(this.pac.x, this.pac.y, this.ghosts);
    for (let i = 0; i < woke; i++) this.bus.emit({ type: 'sleeperWoken' });
    this.train.update(
      step,
      this.ghosts,
      this.maze,
      this.frightened > 0,
      this.speeds(),
      this.pac.x,
      this.pac.y,
      this.rng,
    );
  }

  /**
   * One frightened ghost per frame so a packed train pays the shrinking pause
   * on each bite. A live hunter still kills, even if a blue ghost is also touching.
   */
  private collide(): void {
    let deadly = false;
    let meal: Ghost | null = null;
    for (const ghost of this.ghosts) {
      if (!overlaps(this.pac, ghost)) continue;
      if (ghost.mode === 'frightened') {
        if (!meal) meal = ghost;
      } else if (isHuntable(ghost.mode)) deadly = true;
    }
    if (deadly) {
      this.kill();
      return;
    }
    if (meal) {
      this.eatGhost(meal);
      return;
    }
    if (this.frightened <= 0) return;
    const follower = this.train.closestFollower(this.pac.x, this.pac.y);
    if (follower) this.eatFollower(follower.id);
  }

  private eatGhost(ghost: Ghost): void {
    this.combo += 1;
    const strength = this.combo;
    const points = Math.min(1600, GHOST_SCORE_BASE * 2 ** (strength - 1));
    this.score += points;
    const handed = this.train.handoffLeader(ghost, this.maze);
    if (!handed) {
      ghost.mode = 'eaten';
      ghost.reversePending = true;
      ghost.centerKey = -1;
      ghost.skipFright = true;
    }
    this.lastEatPoints = points;
    this.beginEatPause();
    this.bus.emit({ type: 'ghostEaten', ghostId: ghost.id, strength, combo: this.combo });
  }

  /** Train followers score and pause like a frightened ghost, and they do not throw a jammer. */
  private eatFollower(id: number): void {
    this.combo += 1;
    const points = Math.min(1600, GHOST_SCORE_BASE * 2 ** (this.combo - 1));
    this.score += points;
    this.lastEatPoints = points;
    this.train.removeFollower(id);
    this.beginEatPause();
    this.bus.emit({ type: 'trainGhostEaten', combo: this.combo });
  }

  private beginEatPause(): void {
    if (this.sinceGhostEat >= EAT_CHAIN_RESET) this.eatChain = 0;
    this.eatChain += 1;
    this.sinceGhostEat = 0;
    this.eatPause = eatPauseForChain(this.eatChain);
    if (this.frightened > 0 && this.frightened < PELLET_EXTEND_THRESHOLD) {
      this.frightened += PELLET_EXTEND_SECONDS;
    }
  }

  private kill(): void {
    if (!this.pac.alive) return;
    this.pac.alive = false;
    this.deathTime = 0;
    this.bus.emit({ type: 'playerDied' });
  }
}

function spawnPac(): Pac {
  return {
    x: PAC_START.x,
    y: PAC_START.y,
    dir: { ...DIR_NONE },
    queued: null,
    alive: true,
    anim: 0,
  };
}

function isHuntable(mode: GhostMode): boolean {
  return mode === 'chase' || mode === 'scatter';
}

function overlaps(pac: Pac, ghost: Ghost): boolean {
  return Math.hypot(pac.x - ghost.x, pac.y - ghost.y) < COLLIDE_DISTANCE;
}
