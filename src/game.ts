import { Sfx } from './audio/sfx';
import { COUNTDOWN_BEAT_FRAMES, COUNTDOWN_BEATS, PAC_LAUNCH_DIR } from './config';
import { Board } from './gameplay/board';
import { formatMatchTime } from './gameplay/inbound';
import { drawFrame, type DrawInput } from './render/draw';
import { BoltField } from './render/fx';
import { boardRect, ghostHouseCenter, panelCenter } from './render/layout';
import type { Dir } from './shared/types';
import { DIR_NONE } from './shared/types';
import { EventBus } from './shared/events';
import type { JamReason } from './shared/events';
import type { Rng } from './shared/rng';
import { Match, type MatchPhase } from './systems/match';
import { SimWorld } from './systems/sims';

export interface HudState {
  score: number;
  board: number;
  remaining: number;
  speed: number;
  time: string;
  phase: MatchPhase;
  status: string;
  /** Big start callout, or null once the countdown is over. */
  countdown: string | null;
  overlay: { title: string; body: string } | null;
}

/**
 * Composition root. Gameplay and systems only meet here (and on the event bus).
 */
export class Game {
  readonly bus = new EventBus();
  readonly board: Board;
  readonly sims: SimWorld;
  readonly match: Match;
  readonly sfx = new Sfx();
  private readonly fx = new BoltField();
  private banner = '';
  private bannerT = 0;
  elapsed = 0;
  /** Seconds since the player started moving. Stays 0 until the first step. */
  matchTime = 0;
  private playStarted = false;
  /** False on the title screen. Tests start in a match. */
  inMatch = true;
  /** Index into {@link COUNTDOWN_BEATS}, or -1 when the opener is not running. */
  private beatIndex = -1;
  /** Frames already spent on the current beat. One {@link Game.update} call is one frame. */
  private beatFrame = 0;
  private beatSound = -1;

  constructor(rng: Rng = Math.random) {
    this.board = new Board(this.bus, rng);
    this.sims = new SimWorld(this.bus, rng);
    this.match = new Match(this.bus, this.sims);
    this.bus.on('jammersSent', (event) => {
      if (event.reason === 'sim') return;
      const board = boardRect();
      const origin = { x: board.x + board.w / 2, y: board.y + board.h / 2 };
      this.fx.launch(
        origin,
        event.targets.map((id) => panelCenter(id)),
      );
      this.setBanner(`${reasonLabel(event.reason)} ${event.strength} → ${formatTargets(event.targets)}`);
    });
    this.bus.on('simEliminated', (event) => {
      this.setBanner(`Eliminated #${event.simId}`);
    });
    this.bus.on('incomingJammer', (event) => {
      this.fx.queueIncoming(panelCenter(event.fromSimId), ghostHouseCenter(), event.strength);
      this.setBanner(`Jammer from #${event.fromSimId}`);
    });
    this.bus.on('dotEaten', () => this.sfx.dot());
    this.bus.on('powerPelletEaten', () => this.sfx.pellet());
    this.bus.on('ghostEaten', (event) => this.sfx.ghost(event.combo));
    this.bus.on('sleeperWoken', () => this.sfx.wake());
    this.bus.on('trainGhostEaten', (event) => this.sfx.trainEat(event.combo));
    this.bus.on('boardCleared', () => this.sfx.boardClear());
    this.bus.on('playerDied', () => this.sfx.death());
    this.bus.on('matchWon', () => this.sfx.win());
  }

  /** False while Ready / 3 / 2 / 1 own the start. True once Hit it! has released Pac. */
  get acceptsInput(): boolean {
    return this.inMatch && this.match.phase === 'playing' && !this.countdownHolding;
  }

  setDirection(dir: Dir | null): void {
    if (!this.acceptsInput) return;
    this.board.setDirection(dir);
  }

  /** Title screen. The match clock and the sims stay paused until {@link startMatch}. */
  showTitle(): void {
    this.restart();
    this.inMatch = false;
  }

  startMatch(): void {
    this.restart();
    this.inMatch = true;
    this.sfx.unlock();
    this.armCountdown();
  }

  toggleMute(): boolean {
    this.sfx.unlock();
    return this.sfx.toggle();
  }

  update(dt: number): void {
    const step = Math.min(0.05, Math.max(0, dt));
    this.elapsed += step;
    if (this.bannerT > 0) this.bannerT = Math.max(0, this.bannerT - step);
    if (!this.inMatch) return;
    if (this.beatIndex >= 0) this.advanceCountdown(step);
    if (this.countdownHolding) {
      this.tickFx(step);
      this.sfx.tick(step);
      return;
    }
    if (this.match.phase !== 'won') {
      this.board.matchTime = this.matchTime;
      this.board.update(step);
    }
    const started = this.board.pac.dir.x !== 0 || this.board.pac.dir.y !== 0;
    if (started) this.playStarted = true;
    if (this.playStarted && this.match.phase === 'playing') this.matchTime += step;
    this.board.matchTime = this.matchTime;
    if (this.match.phase === 'playing' && started) this.sims.update(step);
    this.tickFx(step);
    this.sfx.tick(step);
    if (this.inMatch) {
      this.sfx.sync({
        jammers: this.board.inbound.jammers,
        slow: this.board.inbound.slow,
        fruit: this.board.fruit != null,
        boardIndex: this.board.boardIndex,
      });
    }
  }

  restart(): void {
    this.board.reset();
    this.sims.reset();
    this.match.reset();
    this.fx.clear();
    this.banner = '';
    this.bannerT = 0;
    this.elapsed = 0;
    this.matchTime = 0;
    this.playStarted = false;
    this.beatIndex = -1;
    this.beatFrame = 0;
    this.beatSound = -1;
    this.sfx.resetWatch();
  }

  hud(): HudState {
    const phase = this.match.phase;
    return {
      score: this.board.score,
      board: this.board.speeds().board,
      remaining: this.match.remaining(),
      speed: this.board.displayedSpeed,
      time: formatMatchTime(this.matchTime),
      phase,
      status: this.statusLine(),
      countdown: this.countdownLabel(),
      overlay: this.overlay(),
    };
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const input: DrawInput = {
      maze: this.board.maze,
      pac: this.board.pac,
      ghosts: this.board.ghosts,
      sims: this.sims.sims,
      bolts: this.fx.bolts,
      incoming: this.fx.incoming,
      particles: this.fx.particles,
      shake: this.fx.shake,
      mazeFlash: this.fx.flash,
      frightened: this.board.frightened,
      deathTime: this.board.deathTime,
      time: this.elapsed,
      eatPause: this.board.eatPause,
      eatPoints: this.board.lastEatPoints,
      speedPopup: this.board.speedPopup,
      sleepers: this.board.train.asleep(),
      train: this.board.train.followers,
      fruit: this.board.fruit,
      jammers: this.board.inbound.jammers,
      slow: this.board.inbound.slow,
    };
    drawFrame(ctx, input);
  }

  private tickFx(step: number): void {
    this.fx.update(step, (strength) => {
      this.sfx.impact();
      const spawned = this.board.spawnInbound(strength);
      if (spawned === 0) this.setBanner('Jammers are full');
    });
  }

  private get countdownHolding(): boolean {
    return this.beatIndex >= 0 && this.beatIndex < COUNTDOWN_BEATS.length - 1;
  }

  private countdownLabel(): string | null {
    if (this.beatIndex < 0 || this.beatIndex >= COUNTDOWN_BEATS.length) return null;
    return COUNTDOWN_BEATS[this.beatIndex] ?? null;
  }

  /** Ready through Hit it!, one second (60 frames) each. Hit it! is the frame Pac starts left. */
  private armCountdown(): void {
    this.beatIndex = 0;
    this.beatFrame = 0;
    this.beatSound = -1;
    this.board.pac.dir = { ...DIR_NONE };
    this.board.pac.queued = null;
    this.markBeat();
  }

  private advanceCountdown(step: number): void {
    if (this.beatIndex < 0 || step <= 0) return;
    this.beatFrame += 1;
    if (this.beatFrame <= COUNTDOWN_BEAT_FRAMES) return;
    this.beatIndex += 1;
    this.beatFrame = 1;
    if (this.beatIndex >= COUNTDOWN_BEATS.length) {
      this.beatIndex = -1;
      this.beatFrame = 0;
      return;
    }
    this.markBeat();
  }

  private markBeat(): void {
    if (this.beatIndex === this.beatSound) return;
    this.beatSound = this.beatIndex;
    const go = this.beatIndex === COUNTDOWN_BEATS.length - 1;
    if (this.beatIndex >= 0) this.sfx.countdown(this.beatIndex, go);
    if (go) {
      this.board.pac.dir = { ...PAC_LAUNCH_DIR };
      this.board.pac.queued = null;
    }
  }

  private statusLine(): string {
    if (!this.inMatch) return 'Start match to play';
    const countdown = this.countdownLabel();
    if (countdown) return countdown;
    if (this.bannerT > 0) return this.banner;
    if (this.match.phase === 'playing' && this.board.pac.dir.x === 0 && this.board.pac.dir.y === 0) {
      return 'Press an arrow key or WASD to start';
    }
    if (this.match.phase === 'won') return 'You are the last one standing';
    if (this.match.phase === 'lost') return 'Eliminated';
    if (this.board.inbound.slow > 0) return 'Slowed by a jammer';
    if (this.board.frightened > 0) return 'Ghosts are frightened and slow — eat them to jam opponents';
    return 'Large dots frighten ghosts. Eating them sends jammers sideways.';
  }

  private overlay(): HudState['overlay'] {
    if (this.match.phase === 'won') {
      return {
        title: 'You win',
        body: `Last player standing. Score ${this.board.score}.`,
      };
    }
    if (this.match.phase === 'lost' && this.board.deathTime > 0.85) {
      return {
        title: 'Eliminated',
        body: `${this.sims.aliveCount()} opponents remain. Score ${this.board.score}.`,
      };
    }
    return null;
  }

  private setBanner(text: string): void {
    this.banner = text;
    this.bannerT = 2.2;
  }
}

function reasonLabel(reason: JamReason): string {
  switch (reason) {
    case 'ghost':
      return 'Ghost jam';
    case 'dots':
      return 'Dot pressure';
    case 'clear':
      return 'Board clear';
    case 'sim':
      return 'Sim jam';
    default:
      return 'Jam';
  }
}

function formatTargets(ids: readonly number[]): string {
  const shown = ids
    .slice(0, 4)
    .map((id) => `#${id}`)
    .join(' ');
  return ids.length > 4 ? `${shown} +${ids.length - 4}` : shown;
}
