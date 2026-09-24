import {
  CLEAR_SPEED_BONUS,
  GHOST_SCATTER_BUMP,
  JAMMER_CHASE_GATE,
  COLLIDE_DISTANCE,
  SPEED_POPUP_SECONDS,
  DOT_SCORE,
  elroyLevel,
  DOT_STOP_FRAMES,
  EAT_CHAIN_RESET,
  eatPauseForChain,
  frightSecondsForBoard,
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
import { advanceMover, applyQueuedTurn, type Mover } from './movement';
import { frightSecondsFor, ghostsPerWake, speedLevelsFor, TRAIN_WHITE_EVERY, type PacMode } from './powerMode';
import { GhostTrain } from './train';

export interface Pac extends Mover {
  alive: boolean;
  anim: number;
}

interface Wave {
  mode: 'chase' | 'scatter';
  duration: number;
}

/**
 * The match opens in scatter. After that wave the usual pairs run:
 * chase, scatter, chase, and a last chase that does not end.
 */
const WAVES: readonly Wave[] = [
  { mode: 'scatter', duration: 6 },
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
  /**
   * Length of the pellet that set {@link frightened}. The ring drains against this,
   * so a Stronger pellet (4s) starts full instead of 4/9 of the normal timer.
   */
  pelletDuration = frightSecondsForBoard(1);
  /** Mode in effect. Starts as Standard and changes only when a power pellet is eaten. */
  powerActive: PacMode = 'standard';
  /** Mode that will become active on the next power pellet. */
  powerQueued: PacMode = 'standard';
  /**
   * Sleeping ghosts woken while Train is the active mode.
   * Reset when Train is left and on {@link Board.reset}. Not cleared by another Train pellet.
   */
  trainWakes = 0;
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
   * Each Stronger activation subtracts 1, floored at 0.
   */
  displayedSpeed = 0;
  /**
   * Full pellet clears this match. Each one adds {@link CLEAR_SPEED_BONUS} to Pac until restart.
   * Each Stronger activation subtracts 1, floored at 0. Speed mode adds its levels on top.
   */
  clearBoost = 0;
  /**
   * Scatter re-entries after the opening wave. The match starts in scatter with no bump.
   * Each later scatter adds {@link GHOST_SCATTER_BUMP} to chase and scatter for the rest of the match.
   */
  ghostPaceBoost = 0;
  /**
   * Seconds left on the "Speed Up!" callout. Set when the last pellet is eaten
   * and ticked while Pac keeps moving.
   */
  speedPopup = 0;
  /**
   * Seconds left on the ghost-eat count. One slot only: a new eat restarts it
   * and moves {@link eatPopupX}/{@link eatPopupY}. Ticked like the Speed Up callout,
   * including during the eat pause.
   */
  eatPopup = 0;
  /** Ghosts eaten since fright last fully ended. Shown by {@link eatPopupCount}. */
  private frightEats = 0;
  /** Snapshot of {@link frightEats} for the popup. A new pellet does not clear it while fright is still running. */
  eatPopupCount = 0;
  eatPopupX = 0;
  eatPopupY = 0;
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
  private waveTime: number = WAVES[0]?.duration ?? 6;
  wave: 'chase' | 'scatter' = WAVES[0]?.mode ?? 'scatter';

  constructor(
    private readonly bus: EventBus,
    private readonly rng: Rng,
    maze: Maze = new Maze(),
  ) {
    this.maze = maze;
    this.pac = spawnPac();
    this.ghosts = createGhosts();
    clearSpawnTile(this.maze);
    this.boardPellets = this.maze.remaining();
  }

  get playing(): boolean {
    return this.pac.alive && this.clearPause <= 0 && this.eatPause <= 0;
  }

  speeds(): BoardSpeeds {
    return speedsForBoard(this.boardIndex);
  }

  /** Temporary Speed-mode levels. Zero unless Speed is the active mode. */
  modeSpeedLevels(): number {
    return speedLevelsFor(this.powerActive);
  }

  /** Board pace plus permanent clears and the temporary Speed-mode levels. */
  pacSpeed(): number {
    const base = this.chaseSpeed();
    if (this.inbound.slow <= 0) return base;
    return base * this.inbound.slowFactor;
  }

  /**
   * Pac's board pace plus full-clear bonuses and Speed-mode levels, before the white-jammer slow.
   * Jammers scale off this. Ghosts and Elroy do not — they use {@link basePacPace}.
   */
  chaseSpeed(): number {
    return this.speeds().pac + (this.clearBoost + this.modeSpeedLevels()) * CLEAR_SPEED_BONUS;
  }

  /**
   * Pac's board pace with no full-clear Speed bonus.
   * Elroy 1 matches this number. Elroy 2 is 1.1× it. Ghost chase and fright
   * come from the board table plus {@link ghostPaceBoost}, so a Speed Up never speeds the ghosts.
   */
  basePacPace(): number {
    return this.speeds().pac;
  }

  /** Chase/scatter tiles per second before Elroy and the tunnel slow. */
  ghostCruise(): number {
    return this.speeds().ghost + this.ghostPaceBoost * GHOST_SCATTER_BUMP;
  }

  setDirection(dir: Dir | null): void {
    if (!this.pac.alive) return;
    this.pac.queued = dir;
  }

  /** Queue the mode that the next power pellet will turn on. Does not change the active mode. */
  queuePower(mode: PacMode): void {
    this.powerQueued = mode;
  }

  /**
   * Systems hook: a sim threw jammers onto the maze.
   * Returns how many sprites spawned. Overflow past the cap is not spawned.
   */
  spawnInbound(strength: number, exact = false): number {
    if (!this.pac.alive) return 0;
    return this.inbound.spawn(strength, this.matchTime, this.maze, this.pac.x, this.pac.y, this.rng, exact);
  }

  update(dt: number): void {
    const step = Math.min(dt, 0.05);
    if (!this.pac.alive) {
      this.deathTime += step;
      return;
    }
    if (this.speedPopup > 0) this.speedPopup = Math.max(0, this.speedPopup - step);
    if (this.eatPopup > 0) this.eatPopup = Math.max(0, this.eatPopup - step);
    if (this.eatPause > 0) {
      this.eatPause = Math.max(0, this.eatPause - step);
      this.spendBite(step);
      return;
    }
    this.time += step;
    this.sinceGhostEat += step;
    const pacX0 = this.pac.x;
    const pacY0 = this.pac.y;
    this.inbound.update(
      step,
      this.maze,
      this.pac.x,
      this.pac.y,
      this.chaseSpeed(),
      this.redsFrozen(),
      this.matchTime >= JAMMER_CHASE_GATE,
    );
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
    this.pelletDuration = frightSecondsForBoard(1);
    this.powerActive = 'standard';
    this.powerQueued = 'standard';
    this.trainWakes = 0;
    this.deathTime = 0;
    this.clearPause = 0;
    this.eatPause = 0;
    this.biteStop = 0;
    this.lastEatPoints = 0;
    this.boardIndex = 0;
    this.displayedSpeed = 0;
    this.clearBoost = 0;
    this.ghostPaceBoost = 0;
    this.speedPopup = 0;
    this.eatPopup = 0;
    this.eatPopupCount = 0;
    this.frightEats = 0;
    this.eatChain = 0;
    this.sinceGhostEat = 0;
    this.train.reset();
    this.fruit = null;
    this.fruitSpawned = false;
    this.dotsEaten = 0;
    this.combo = 0;
    this.waveIndex = 0;
    this.wave = WAVES[0]?.mode ?? 'scatter';
    this.waveTime = WAVES[0]?.duration ?? 6;
    clearSpawnTile(this.maze);
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
        this.frightEats = 0;
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
    if (wave.mode === 'scatter') this.ghostPaceBoost += 1;
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
   * Full clear adds 1 to the Speed readout and permanently speeds Pac. It does not send a jammer.
   * It does not advance the board or reload dots. The fruit, if it is already out, stays until eaten.
   * Speed is committed before the event so a listener cannot observe the pre-clear meter.
   */
  private onPelletsCleared(): void {
    this.clearBoost += 1;
    this.displayedSpeed += 1;
    this.speedPopup = SPEED_POPUP_SECONDS;
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
   * Sleepers go back to their tiles. The live train stays on the maze, and
   * new wakes append to it. Main ghosts are not retargeted or moved here.
   */
  private advanceFromFruit(): void {
    const finishedBoard = this.boardIndex + 1;
    if (finishedBoard % 2 === 0) this.displayedSpeed += 1;
    this.boardIndex += 1;
    this.fruit = null;
    this.fruitSpawned = false;
    this.maze.resetDots();
    this.boardPellets = this.maze.remaining();
    this.train.reloadSleepers();
    this.inbound.killReds();
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
    this.activateQueuedPower();
    this.inbound.killWhites();
    const seconds = frightSecondsFor(this.powerActive, this.boardIndex + 1, this.matchTime);
    this.pelletDuration = seconds;
    this.frightened = seconds;
    for (const ghost of this.ghosts) {
      ghost.skipFright = false;
      if (!(isHuntable(ghost.mode) || ghost.mode === 'frightened')) continue;
      if (seconds > 0) ghost.mode = 'frightened';
      else if (ghost.mode === 'frightened') ghost.mode = this.wave;
      ghost.reversePending = true;
    }
  }

  private moveGhosts(dt: number, idle: boolean): void {
    const elroy = elroyLevel(this.boardIndex, this.maze.remaining());
    const pacPace = this.basePacPace();
    const table = this.speeds();
    const speeds = { ...table, ghost: this.ghostCruise() };
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
        speeds,
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
    const woke = this.train.touch(
      this.pac.x,
      this.pac.y,
      this.ghosts,
      this.maze,
      ghostsPerWake(this.powerActive),
    );
    for (let i = 0; i < woke; i++) this.bus.emit({ type: 'sleeperWoken' });
    if (this.powerActive === 'train' && woke > 0) this.noteTrainWakes(woke);
    this.train.update(step, this.ghosts, this.maze);
  }

  /**
   * The queued mode becomes active. Leaving Train clears its white-jammer counter.
   * Each Stronger activation, including a re-apply, permanently drops one speed level.
   */
  private activateQueuedPower(): void {
    const next = this.powerQueued;
    if (this.powerActive === 'train' && next !== 'train') this.trainWakes = 0;
    this.powerActive = next;
    if (next === 'stronger') this.dropSpeedLevel();
  }

  /** One permanent speed level, shared by the readout and the clear-bonus pace. Never below 0. */
  private dropSpeedLevel(): void {
    this.displayedSpeed = Math.max(0, this.displayedSpeed - 1);
    this.clearBoost = Math.max(0, this.clearBoost - 1);
  }

  /**
   * Each sleeper woken under Train counts toward a white jammer.
   * Every {@link TRAIN_WHITE_EVERY} wakes try to spawn one white, under the jammer cap.
   */
  private noteTrainWakes(woke: number): void {
    const before = this.trainWakes;
    this.trainWakes += woke;
    const due = Math.floor(this.trainWakes / TRAIN_WHITE_EVERY) - Math.floor(before / TRAIN_WHITE_EVERY);
    if (due <= 0) return;
    this.inbound.spawnWhites(due, this.maze, this.pac.x, this.pac.y, this.rng);
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
    if (!this.leaderFrightened()) return;
    const follower = this.train.closestFollower(this.pac.x, this.pac.y);
    if (follower) this.eatFollower(follower.id);
  }

  /** The train is frightened only while its main leader is. A house ghost that merely looks blue is not. */
  private leaderFrightened(): boolean {
    const id = this.train.leaderId;
    if (!id) return false;
    return this.ghosts.some((ghost) => ghost.id === id && ghost.mode === 'frightened');
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
    this.frightEats += 1;
    this.eatPopup = SPEED_POPUP_SECONDS;
    this.eatPopupCount = this.frightEats;
    this.eatPopupX = this.pac.x;
    this.eatPopupY = this.pac.y;
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

/**
 * Clear the dots on the two tiles the opening pose straddles.
 * Pac sits on the boundary, so leaving either dot would put a pellet under him
 * and hitch the first step.
 */
function clearSpawnTile(maze: Maze): void {
  const y = Math.round(PAC_START.y);
  const left = Math.floor(PAC_START.x);
  const right = Math.ceil(PAC_START.x);
  maze.consume(left, y);
  if (right !== left) maze.consume(right, y);
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
