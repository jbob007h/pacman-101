import { Sfx } from './audio/sfx';
import { COUNTDOWN_BEAT_FRAMES, COUNTDOWN_BEATS, KILL_PRESSURE, PAC_LAUNCH_DIR, SIM_ATTACK_GRACE } from './config';
import { Board } from './gameplay/board';
import { formatMatchTime } from './gameplay/inbound';
import { earnFromEvent } from './net/earn';
import type { AttackKind, Placement, RosterSeat } from './net/protocol';
import { drawFrame, type DrawInput } from './render/draw';
import { BoltField } from './render/fx';
import { boardRect, ghostHouseCenter, panelCenter } from './render/layout';
import type { Dir } from './shared/types';
import { DIR_NONE } from './shared/types';
import { EventBus, type GameplayEvent } from './shared/events';
import type { JamReason } from './shared/events';
import type { Rng } from './shared/rng';
import { Match, type MatchPhase } from './systems/match';
import { DEFAULT_PLAYER_NAME } from './systems/names';
import { Ranking, type StandingSnapshot } from './systems/ranking';
import { SimWorld } from './systems/sims';

export interface OnlineHandlers {
  earn(attack: AttackKind, strength: number): void;
  death(): void;
}

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
  overlay: { title: string; body: string; hint: string | null } | null;
  /** Death rankings after the collapse, or the win rankings after congratulations. */
  standings: StandingSnapshot | null;
}

/**
 * Composition root. Gameplay and systems only meet here (and on the event bus).
 */
export class Game {
  readonly bus = new EventBus();
  readonly board: Board;
  readonly sims: SimWorld;
  readonly match: Match;
  readonly ranking: Ranking;
  /** Human name used on the HUD and in the standings. */
  playerName = DEFAULT_PLAYER_NAME;
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
  /** True after the player clicks through the win congratulations card. */
  private winAcknowledged = false;
  /** Title-screen status while connecting or waiting for the other seat. */
  onlineNote = '';
  /** Live online match. Local sim targeting stays off until the next reset. */
  online = false;
  private onlineSeat = 0;
  /** Server finish list for this online match. Offline standings stay on {@link ranking}. */
  private onlineStandings: StandingSnapshot | null = null;
  private earnSink: OnlineHandlers['earn'] | null = null;
  private deathSink: OnlineHandlers['death'] | null = null;
  private suppressDeathReport = false;
  private muteEliminations = false;

  constructor(rng: Rng = Math.random) {
    this.board = new Board(this.bus, rng);
    this.sims = new SimWorld(this.bus, rng);
    this.match = new Match(this.bus, this.sims);
    this.ranking = new Ranking(this.bus, this.playerName);
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
      if (this.muteEliminations) return;
      const name =
        this.online && event.simId === 1
          ? (this.sims.sims[0]?.name ?? this.ranking.nameForSim(event.simId))
          : this.ranking.nameForSim(event.simId);
      this.setBanner(`Eliminated ${name}`);
    });
    this.bus.on('incomingJammer', (event) => {
      this.fx.queueIncoming(panelCenter(event.fromSimId), ghostHouseCenter(), event.strength);
      this.setBanner(`Jammer from ${this.ranking.nameForSim(event.fromSimId)}`);
    });
    this.bus.on('dotEaten', () => this.sfx.dot());
    this.bus.on('powerPelletEaten', () => this.sfx.pellet());
    this.bus.on('ghostEaten', (event) => this.sfx.ghost(event.combo));
    this.bus.on('sleeperWoken', () => this.sfx.wake());
    this.bus.on('trainGhostEaten', (event) => this.sfx.trainEat(event.combo));
    this.bus.on('boardCleared', () => this.sfx.boardClear());
    this.bus.on('playerDied', () => {
      this.sfx.death();
      this.forwardDeath();
    });
    this.bus.on('ghostVolley', (event) => {
      if (!this.online || !this.earnSink || event.count <= 0) return;
      this.earnSink('ghost', event.count);
    });
    this.bus.on('dotEaten', (event) => this.forwardEarn(event));
    this.bus.on('boardCleared', (event) => this.forwardEarn(event));
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

  setOnlineNote(text: string): void {
    this.onlineNote = text;
  }

  /** Where local earns and maze deaths go while this client is connected. */
  bindOnline(handlers: OnlineHandlers | null): void {
    this.earnSink = handlers?.earn ?? null;
    this.deathSink = handlers?.death ?? null;
  }

  /**
   * Two-seat match. Call after {@link startMatch}: reset turns local battle
   * back on, and this parks every sim except the one remote human.
   */
  armOnline(you: number, opponentName: string): void {
    this.online = true;
    this.onlineSeat = you;
    this.sims.setLocalBattle(false);
    const opponent = this.sims.sims[0];
    if (opponent) {
      opponent.name = opponentName || 'Opponent';
      opponent.alive = true;
      opponent.pressure = 0;
      opponent.heat = 0;
      opponent.busy = 0;
    }
    this.muteEliminations = true;
    for (const sim of this.sims.sims) {
      if (sim.id === 1 || !sim.alive) continue;
      sim.alive = false;
      this.bus.emit({ type: 'simEliminated', simId: sim.id, remainingPlayers: 2 });
    }
    this.muteEliminations = false;
  }

  applyOnlineRoster(seats: readonly RosterSeat[]): void {
    if (!this.online) return;
    const other = seats.find((seat) => seat.seat !== this.onlineSeat);
    const sim = this.sims.sims[0];
    if (!other || !sim || !sim.alive || !other.alive) return;
    sim.name = other.name;
    sim.pressure = other.pressure;
    if (other.hit) sim.heat = 1;
    if (other.busy) sim.busy = 1;
  }

  /**
   * Inbound jammer chosen by the server. Panel 1 is the other human.
   * A ghost volley spawns one sprite per ghost. Dots and clears keep the
   * pressure-to-count curve.
   */
  receiveOnlineJammer(strength: number, fromName: string, attack: AttackKind = 'dots'): void {
    this.fx.queueIncoming(panelCenter(1), ghostHouseCenter(), strength, attack === 'ghost');
    this.setBanner(`${attackLabel(attack)} from ${fromName}`);
  }

  /** Server confirmed this maze is out. Does not echo a death report. */
  applyServerElimination(): void {
    if (this.match.phase !== 'playing' || !this.board.pac.alive) return;
    this.suppressDeathReport = true;
    this.board.pac.alive = false;
    this.bus.emit({ type: 'playerDied' });
  }

  /**
   * Final standings from `matchEnd`. Both clients render this list: the same
   * names and places, with `you` marked on the local seat only.
   */
  setOnlineStandings(placements: readonly Placement[]): void {
    const rows = [...placements]
      .sort((a, b) => a.place - b.place || a.seat - b.seat)
      .map((row) => ({
        place: row.place,
        name: row.name,
        you: row.seat === this.onlineSeat,
        state: 'out' as const,
      }));
    this.onlineStandings = {
      rows,
      yourPlace: rows.find((row) => row.you)?.place ?? null,
      stillIn: 0,
    };
  }

  /** Server confirmed the other human is out. The last local seat wins. */
  eliminateOnlineOpponent(): void {
    if (!this.online) return;
    const sim = this.sims.sims[0];
    if (!sim?.alive) return;
    sim.alive = false;
    sim.pressure = KILL_PRESSURE;
    sim.busy = 0;
    this.bus.emit({ type: 'simEliminated', simId: sim.id, remainingPlayers: 1 });
  }

  startMatch(): void {
    this.restart();
    this.inMatch = true;
    this.sfx.unlock();
    this.armCountdown();
  }

  setPlayerName(name: string): void {
    this.playerName = name;
    this.ranking.setPlayerName(name);
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
    // Opening grace follows the match clock. Once you are out, the field keeps
    // attacking so the standings can still move.
    const attackClock = this.match.phase === 'lost' ? Math.max(this.matchTime, SIM_ATTACK_GRACE) : this.matchTime;
    this.sims.syncMatchClock(attackClock);
    const runSims = this.online || this.match.phase === 'lost' || (this.match.phase === 'playing' && started);
    if (runSims) this.sims.update(step);
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
    this.winAcknowledged = false;
    this.online = false;
    this.onlineSeat = 0;
    this.onlineStandings = null;
    this.suppressDeathReport = false;
    this.sfx.resetWatch();
    this.ranking.reset(this.playerName);
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
      standings: this.standingsOverlay(),
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
      eatPopup: this.board.eatPopup,
      eatPopupCount: this.board.eatPopupCount,
      eatPopupX: this.board.eatPopupX,
      eatPopupY: this.board.eatPopupY,
      sleepers: this.board.train.asleep(),
      train: this.board.train.followers,
      trainLeaderId: this.board.train.leaderId,
      fruit: this.board.fruit,
      jammers: this.board.inbound.jammers,
      slow: this.board.inbound.slow,
    };
    drawFrame(ctx, input);
  }

  private tickFx(step: number): void {
    this.fx.update(step, (strength, exact) => {
      this.sfx.impact();
      const spawned = this.board.spawnInbound(strength, exact);
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
    if (!this.inMatch) return this.onlineNote || 'Start match to play';
    const countdown = this.countdownLabel();
    if (countdown) return countdown;
    if (this.bannerT > 0 && this.match.phase !== 'won') return this.banner;
    if (this.match.phase === 'playing' && this.board.pac.dir.x === 0 && this.board.pac.dir.y === 0) {
      return 'Press an arrow key or WASD to start';
    }
    if (this.match.phase === 'won') return this.winAcknowledged ? 'Final standings' : 'Congratulations';
    if (this.match.phase === 'lost') return 'Eliminated';
    if (this.board.inbound.slow > 0) return 'Slowed by a jammer';
    if (this.board.frightened > 0) return 'Ghosts are frightened and slow — eat them to jam opponents';
    return 'Large dots frighten ghosts. Eating them sends jammers sideways.';
  }

  /** Leave the congratulations card and open the final standings. */
  acknowledgeWin(): void {
    if (this.match.phase !== 'won' || this.winAcknowledged) return;
    this.winAcknowledged = true;
  }

  private overlay(): HudState['overlay'] {
    if (this.match.phase === 'won' && !this.winAcknowledged) {
      return {
        title: 'Congratulations!',
        body: `Last one standing. Score ${this.board.score}.`,
        hint: 'Click, tap, Space, or Enter',
      };
    }
    return null;
  }

  /** Death rankings wait out the collapse. A win shows them after the congratulations card. */
  private standingsOverlay(): StandingSnapshot | null {
    if (this.match.phase === 'won' && this.winAcknowledged) return this.finalStandings();
    if (this.match.phase !== 'lost' || this.board.deathTime <= 0.85) return null;
    return this.finalStandings();
  }

  /** Online matches wait for the server list. Offline keeps the local 101. */
  private finalStandings(): StandingSnapshot | null {
    if (this.online) return this.onlineStandings;
    return this.ranking.snapshot();
  }

  private setBanner(text: string): void {
    this.banner = text;
    this.bannerT = 2.2;
  }

  private forwardEarn(event: GameplayEvent): void {
    if (!this.online || !this.earnSink) return;
    const earned = earnFromEvent(event);
    if (earned) this.earnSink(earned.attack, earned.strength);
  }

  private forwardDeath(): void {
    if (this.suppressDeathReport) {
      this.suppressDeathReport = false;
      return;
    }
    if (!this.online || !this.deathSink) return;
    this.deathSink();
  }
}

function attackLabel(attack: AttackKind): string {
  switch (attack) {
    case 'ghost':
      return 'Ghost jam';
    case 'dots':
      return 'Dot pressure';
    case 'clear':
      return 'Board clear';
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
