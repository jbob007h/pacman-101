import { Sfx } from './audio/sfx';
import { COUNTDOWN_BEAT_FRAMES, COUNTDOWN_BEATS, KILL_PRESSURE, PAC_LAUNCH_DIR } from './config';
import { Board } from './gameplay/board';
import { formatMatchTime } from './gameplay/inbound';
import type { AttackKind, Placement, RosterSeat } from './net/protocol';
import { drawFrame, type DrawInput } from './render/draw';
import { BoltField } from './render/fx';
import { boardRect, ghostHouseCenter, panelCenter } from './render/layout';
import type { Dir } from './shared/types';
import { DIR_NONE } from './shared/types';
import { EventBus } from './shared/events';
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
  /** Roster-only view of a match already in play. There is no local maze. */
  spectating = false;
  private onlineSeat = 0;
  /** Server seat id → local sim panel id for the other 100 seats. */
  private onlineSimBySeat = new Map<number, number>();
  private onlineRoster: RosterSeat[] = [];
  private onlinePlaces = new Map<number, number>();
  /** Server finish list for this online match. Offline standings stay on {@link ranking}. */
  private onlineStandings: StandingSnapshot | null = null;
  private spectatorRoster: RosterSeat[] = [];
  private spectatorPlaces = new Map<number, number>();
  private spectatorClock = 0;
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
      this.fx.queueIncoming(panelCenter(event.fromSimId), ghostHouseCenter(), event.strength, event.exact === true);
      this.setBanner(`Ghost jam from ${this.ranking.nameForSim(event.fromSimId)}`);
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
   * Online match. Call after {@link startMatch}: reset turns local battle
   * back on, and this maps every other roster seat onto a side panel.
   * Seats past the 100 panels are not drawn. Local CPU timers stay off.
   */
  armOnline(you: number, roster: readonly RosterSeat[]): void {
    this.online = true;
    this.spectating = false;
    this.onlineSeat = you;
    this.onlinePlaces.clear();
    this.onlineStandings = null;
    this.onlineRoster = roster.map((seat) => ({ ...seat }));
    this.sims.setLocalBattle(false);
    this.onlineSimBySeat.clear();
    const others = roster.filter((seat) => seat.seat !== you).sort((a, b) => a.seat - b.seat);
    this.muteEliminations = true;
    for (let index = 0; index < this.sims.sims.length; index++) {
      const sim = this.sims.sims[index];
      const seat = others[index];
      if (!sim) continue;
      if (!seat) {
        sim.alive = false;
        sim.pressure = KILL_PRESSURE;
        continue;
      }
      sim.name = seat.name;
      sim.alive = seat.alive;
      sim.pressure = seat.pressure;
      sim.heat = seat.hit ? 1 : 0;
      sim.busy = seat.busy ? 1 : 0;
      this.onlineSimBySeat.set(seat.seat, sim.id);
    }
    this.muteEliminations = false;
  }

  applyOnlineRoster(seats: readonly RosterSeat[]): void {
    if (this.spectating) {
      this.applySpectateRoster(seats);
      return;
    }
    if (!this.online) return;
    this.onlineRoster = seats.map((seat) => ({ ...seat }));
    for (const place of this.onlinePlaces.keys()) {
      const row = this.onlineRoster.find((seat) => seat.seat === place);
      if (row) row.alive = false;
    }
    for (const seat of this.onlineRoster) {
      if (seat.seat === this.onlineSeat) continue;
      const sim = this.simForSeat(seat.seat);
      if (!sim) continue;
      sim.name = seat.name;
      sim.pressure = seat.pressure;
      if (seat.hit) sim.heat = 1;
      if (seat.busy) sim.busy = 1;
      if (sim.alive && !seat.alive) this.killOnlineSim(sim);
    }
  }

  /**
   * Inbound jammer chosen by the server. Panel 1 is the other human.
   * Only a ghost earn spawns sprites: one per ghost eaten. Dot and clear
   * messages are ignored.
   */
  receiveOnlineJammer(strength: number, fromName: string, attack: AttackKind = 'ghost', fromSeat?: number): void {
    if (attack !== 'ghost' || !(strength > 0)) return;
    const simId = fromSeat == null ? 1 : (this.onlineSimBySeat.get(fromSeat) ?? 1);
    this.fx.queueIncoming(panelCenter(simId), ghostHouseCenter(), strength, true);
    this.setBanner(`Ghost jam from ${fromName}`);
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

  /** Server confirmed another playing seat is out. */
  eliminateOnlineSeat(seatId: number, place: number, remaining: number): void {
    if (this.spectating) {
      this.noteSpectatorElimination(seatId, place);
      return;
    }
    if (!this.online) return;
    this.onlinePlaces.set(seatId, place);
    const row = this.onlineRoster.find((seat) => seat.seat === seatId);
    if (row) row.alive = false;
    const sim = this.simForSeat(seatId);
    if (sim) this.killOnlineSim(sim);
    this.refreshPartial(remaining);
  }

  /** Lock this client's place without treating it as a remote panel. */
  noteOnlineElimination(seatId: number, place: number, remaining: number): void {
    if (!this.online) return;
    this.onlinePlaces.set(seatId, place);
    const row = this.onlineRoster.find((seat) => seat.seat === seatId);
    if (row) row.alive = false;
    this.refreshPartial(remaining);
  }

  /** Server confirmed the other human is out. With one remote seat, that is the win. */
  eliminateOnlineOpponent(): void {
    if (!this.online) return;
    const sim = this.sims.sims[0];
    if (!sim) return;
    this.killOnlineSim(sim);
  }

  /**
   * Admit a late joiner as a spectator. The maze stays on the title screen.
   * Roster and standings update; there is no playable board for this match.
   */
  beginSpectate(roster: readonly RosterSeat[], clock: number): void {
    this.spectating = true;
    this.online = false;
    this.inMatch = false;
    this.spectatorRoster = roster.map((seat) => ({ ...seat }));
    this.spectatorPlaces.clear();
    this.spectatorClock = clock;
    this.onlineNote = this.spectateNote();
  }

  applySpectateRoster(seats: readonly RosterSeat[], clock?: number): void {
    if (!this.spectating) return;
    this.spectatorRoster = seats.map((seat) => ({ ...seat }));
    if (clock != null) this.spectatorClock = clock;
    for (const seatId of this.spectatorPlaces.keys()) {
      const row = this.spectatorRoster.find((seat) => seat.seat === seatId);
      if (row) row.alive = false;
    }
    this.onlineNote = this.spectateNote();
  }

  noteSpectatorElimination(seatId: number, place: number): void {
    if (!this.spectating) return;
    this.spectatorPlaces.set(seatId, place);
    const row = this.spectatorRoster.find((seat) => seat.seat === seatId);
    if (row) row.alive = false;
    this.onlineNote = this.spectateNote();
  }

  showSpectatorPlacements(placements: readonly Placement[]): void {
    if (!this.spectating) return;
    this.spectatorRoster = placements.map((row) => ({
      seat: row.seat,
      name: row.name,
      alive: false,
      pressure: 0,
      hit: false,
      busy: false,
    }));
    this.spectatorPlaces = new Map(placements.map((row) => [row.seat, row.place]));
    this.onlineNote = 'Match over. Joining the next lobby…';
  }

  clearSpectate(): void {
    this.spectating = false;
    this.spectatorRoster = [];
    this.spectatorPlaces.clear();
    this.spectatorClock = 0;
  }

  /** Last living seat, from the server. Force the local win if a roster delta was missed. */
  finishOnlineWin(): void {
    if (!this.online || this.match.phase !== 'playing') return;
    for (const sim of this.sims.sims) this.killOnlineSim(sim);
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
    // After a loss the field keeps its own attack timers so the standings can still move.
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
    this.spectating = false;
    this.onlineSeat = 0;
    this.onlineSimBySeat.clear();
    this.onlineRoster = [];
    this.onlinePlaces.clear();
    this.onlineStandings = null;
    this.spectatorRoster = [];
    this.spectatorPlaces.clear();
    this.spectatorClock = 0;
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
      standings: this.spectating ? this.spectatorSnapshot() : this.standingsOverlay(),
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

  private simForSeat(seatId: number) {
    const simId = this.onlineSimBySeat.get(seatId);
    if (simId == null) return undefined;
    return this.sims.sims[simId - 1];
  }

  private killOnlineSim(sim: { id: number; alive: boolean; pressure: number; busy: number }): void {
    if (!sim.alive) return;
    sim.alive = false;
    sim.pressure = KILL_PRESSURE;
    sim.busy = 0;
    this.bus.emit({ type: 'simEliminated', simId: sim.id, remainingPlayers: 1 + this.sims.aliveCount() });
  }

  private refreshPartial(stillIn: number): void {
    if (!this.online) return;
    const rows = this.onlineRoster.map((seat) => {
      const place = this.onlinePlaces.get(seat.seat) ?? null;
      const alive = place == null && seat.alive;
      return {
        place: alive ? null : place,
        name: seat.name,
        you: seat.seat === this.onlineSeat,
        state: alive ? ('active' as const) : ('out' as const),
      };
    });
    const active = rows.filter((row) => row.state === 'active').sort((a, b) => a.name.localeCompare(b.name));
    const out = rows.filter((row) => row.state === 'out').sort((a, b) => (a.place ?? 9999) - (b.place ?? 9999));
    this.onlineStandings = {
      rows: [...active, ...out],
      yourPlace: rows.find((row) => row.you)?.place ?? null,
      stillIn: stillIn,
    };
  }

  private spectateNote(): string {
    const alive = this.spectatorRoster.filter((seat) => seat.alive).length;
    return `Spectating · ${formatMatchTime(this.spectatorClock)} · ${alive} alive. No maze view — you join the next lobby when this match ends.`;
  }

  private spectatorSnapshot(): StandingSnapshot {
    const active: StandingSnapshot['rows'] = [];
    const out: StandingSnapshot['rows'] = [];
    for (const seat of this.spectatorRoster) {
      const place = this.spectatorPlaces.get(seat.seat) ?? null;
      if (seat.alive && place == null) {
        active.push({ place: null, name: seat.name, you: false, state: 'active' as const });
      } else {
        out.push({ place, name: seat.name, you: false, state: 'out' as const });
      }
    }
    active.sort((a, b) => a.name.localeCompare(b.name));
    out.sort((a, b) => (a.place ?? 9999) - (b.place ?? 9999) || a.name.localeCompare(b.name));
    return { rows: [...active, ...out], yourPlace: null, stillIn: active.length };
  }

  private setBanner(text: string): void {
    this.banner = text;
    this.bannerT = 2.2;
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
