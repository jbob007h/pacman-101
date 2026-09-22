import {
  COLLIDE_DISTANCE,
  DOT_SCORE,
  EAT_GHOST_PAUSE,
  FRIGHT_SECONDS,
  GHOST_SCORE_BASE,
  PAC_START,
  PELLET_SCORE,
  speedsForBoard,
  type BoardSpeeds,
} from '../config';
import type { EventBus } from '../shared/events';
import type { Rng } from '../shared/rng';
import type { Dir } from '../shared/types';
import { DIR_NONE } from '../shared/types';
import { createGhosts, updateGhost, type Ghost, type GhostMode } from './ghosts';
import { Maze } from './maze';
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
 * Incoming jammer pressure is applied through {@link Board.applyIncomingJammer}.
 */
export class Board {
  readonly maze: Maze;
  pac: Pac;
  ghosts: Ghost[];
  score = 0;
  time = 0;
  frightened = 0;
  incoming = 0;
  deathTime = 0;
  clearPause = 0;
  /** Freeze after eating a frightened ghost. Gameplay clocks do not advance. */
  eatPause = 0;
  lastEatPoints = 0;
  /** Zero-based. Clearing the maze advances it and raises the pace. */
  boardIndex = 0;
  dotsEaten = 0;
  combo = 0;
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
  }

  get playing(): boolean {
    return this.pac.alive && this.clearPause <= 0 && this.eatPause <= 0;
  }

  speeds(): BoardSpeeds {
    return speedsForBoard(this.boardIndex);
  }

  setDirection(dir: Dir | null): void {
    if (!this.pac.alive) return;
    this.pac.queued = dir;
  }

  /** Systems hook: a sim dumped junk on the human. Speeds ghosts for a few seconds. */
  applyIncomingJammer(strength: number): void {
    if (!this.pac.alive) return;
    this.incoming = Math.min(7, this.incoming + 1.6 + strength * 0.04);
  }

  update(dt: number): void {
    const step = Math.min(dt, 0.05);
    if (!this.pac.alive) {
      this.deathTime += step;
      return;
    }
    if (this.eatPause > 0) {
      this.eatPause = Math.max(0, this.eatPause - step);
      return;
    }
    this.time += step;
    if (this.incoming > 0) this.incoming = Math.max(0, this.incoming - step);
    if (this.clearPause > 0) {
      this.clearPause -= step;
      return;
    }
    this.movePac(step);
    const started = this.pac.dir.x !== 0 || this.pac.dir.y !== 0;
    if (!started) {
      this.moveGhosts(step, true);
      this.collide();
      return;
    }
    this.tickModes(step);
    this.consumeTile();
    if (!this.pac.alive) return;
    this.moveGhosts(step, false);
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
    this.incoming = 0;
    this.deathTime = 0;
    this.clearPause = 0;
    this.eatPause = 0;
    this.lastEatPoints = 0;
    this.boardIndex = 0;
    this.dotsEaten = 0;
    this.combo = 0;
    this.waveIndex = 0;
    this.wave = WAVES[0]?.mode ?? 'chase';
    this.waveTime = WAVES[0]?.duration ?? 18;
    this.maze.consume(PAC_START.x, PAC_START.y);
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
    const traveled = advanceMover(
      this.pac,
      dt,
      this.speeds().pac,
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
    if (kind === 'dot') this.score += DOT_SCORE;
    else {
      this.score += PELLET_SCORE;
      this.combo = 0;
      this.frighten();
      this.bus.emit({ type: 'powerPelletEaten' });
    }
    this.dotsEaten += 1;
    const remaining = this.maze.remaining();
    this.bus.emit({ type: 'dotEaten', totalEaten: this.dotsEaten, remaining });
    if (remaining === 0) {
      this.bus.emit({ type: 'boardCleared' });
      this.maze.resetDots();
      this.boardIndex += 1;
      this.clearPause = 0.7;
    }
  }

  private frighten(): void {
    this.frightened = FRIGHT_SECONDS;
    for (const ghost of this.ghosts) {
      if (isHuntable(ghost.mode) || ghost.mode === 'frightened') {
        ghost.mode = 'frightened';
        ghost.reversePending = true;
      }
    }
  }

  private moveGhosts(dt: number, idle: boolean): void {
    for (const ghost of this.ghosts) {
      if (idle && ghost.mode !== 'house') continue;
      const blinky = this.ghosts[0];
      updateGhost(ghost, {
        dt,
        time: idle ? -1 : this.time,
        maze: this.maze,
        wave: this.wave,
        frightenedLeft: this.frightened,
        incoming: this.incoming > 0,
        speeds: this.speeds(),
        pacX: this.pac.x,
        pacY: this.pac.y,
        pacDir: this.pac.dir,
        blinkyX: blinky?.x ?? this.pac.x,
        blinkyY: blinky?.y ?? this.pac.y,
        rng: this.rng,
      });
    }
  }

  private collide(): void {
    let deadly = false;
    for (const ghost of this.ghosts) {
      if (!overlaps(this.pac, ghost)) continue;
      if (ghost.mode === 'frightened') this.eatGhost(ghost);
      else if (isHuntable(ghost.mode)) deadly = true;
    }
    if (deadly) this.kill();
  }

  private eatGhost(ghost: Ghost): void {
    this.combo += 1;
    const strength = this.combo;
    const points = Math.min(1600, GHOST_SCORE_BASE * 2 ** (strength - 1));
    this.score += points;
    ghost.mode = 'eaten';
    ghost.reversePending = true;
    ghost.centerKey = -1;
    this.lastEatPoints = points;
    this.eatPause = EAT_GHOST_PAUSE;
    this.bus.emit({ type: 'ghostEaten', ghostId: ghost.id, strength, combo: this.combo });
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
