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
  end?(): void;
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
  /** True when every living seat is a bot and this viewer may end the match. */
  canEndMatch: boolean;
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
  /** Server seat → side-panel sim, for the seats that are not this client. */
  private onlinePanels = new Map<number, number>();
  /** Names and alive flags from the server roster. Places come only from confirms. */
  private onlineSeats = new Map<number, OnlineSeat>();
  /** True once `matchEnd` replaced the partial list with the final order. */
  private onlineFinal = false;
  /** Server finish list for this online match. Offline standings stay on {@link ranking}. */
  private onlineStandings: StandingSnapshot | null = null;
  private spectatorRoster: RosterSeat[] = [];
  private spectatorPlaces = new Map<number, number>();
  private spectatorClock = 0;
  private earnSink: OnlineHandlers['earn'] | null = null;
  private deathSink: OnlineHandlers['death'] | null = null;
  private endSink: OnlineHandlers['end'] | null = null;
  private suppressDeathReport = false;

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
      const named = this.online ? this.sims.sims.find((sim) => sim.id === event.simId) : undefined;
      const name = named?.name ?? this.ranking.nameForSim(event.simId);
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
    this.endSink = handlers?.end ?? null;
  }

  /**
   * Finish a match that only bots are still playing.
   * Online and spectate ask the server. Local seals the remaining CPU places.
   */
  requestEndMatch(): void {
    if (!this.mayEndMatch()) return;
    if (this.online || this.spectating) {
      this.endSink?.();
      return;
    }
    const survivors = this.sims.sims
      .filter((sim) => sim.alive && !sim.parked)
      .sort((a, b) => a.pressure - b.pressure || a.id - b.id);
    this.ranking.sealSims(survivors.map((sim) => ({ id: sim.id, name: sim.name })));
    for (const sim of survivors) {
      sim.alive = false;
      sim.pressure = KILL_PRESSURE;
      sim.busy = 0;
    }
  }

  /**
   * Online match. Call after {@link startMatch}: reset turns local battle
   * back on, and this parks every sim that is not in the server roster.
   * A string is the N1 one-opponent shorthand (tests and a single remote name).
   * A roster snapshot shows every other seat, human or bot, and hides the rest
   * so the alive counter matches the room (101 in N2b).
   */
  armOnline(you: number, opponent: string | readonly RosterSeat[]): void {
    const roster = typeof opponent === 'string' ? oneOpponentRoster(you, opponent) : opponent;
    this.spectating = false;
    this.online = true;
    this.onlineSeat = you;
    this.onlinePanels.clear();
    this.onlineSeats.clear();
    this.onlineFinal = false;
    this.onlineStandings = null;
    this.sims.setLocalBattle(false);
    const others = roster
      .filter((seat) => seat.seat !== you)
      .sort((a, b) => a.seat - b.seat);
    others.forEach((seat, index) => {
      const sim = this.sims.sims[index];
      if (!sim) return;
      this.onlinePanels.set(seat.seat, sim.id);
      sim.parked = false;
      sim.showName = true;
      sim.name = seat.name || 'Opponent';
      sim.alive = seat.alive;
      sim.pressure = seat.alive ? seat.pressure : KILL_PRESSURE;
      sim.heat = seat.hit ? 1 : 0;
      sim.busy = seat.busy ? 1 : 0;
      sim.relief = 0;
    });
    for (let index = others.length; index < this.sims.sims.length; index++) {
      const sim = this.sims.sims[index];
      if (!sim) continue;
      sim.parked = true;
      sim.showName = false;
      sim.alive = false;
      sim.pressure = 0;
      sim.heat = 0;
      sim.busy = 0;
    }
    this.rememberRoster(roster);
  }

  applyOnlineRoster(seats: readonly RosterSeat[], clock?: number): void {
    if (this.spectating) {
      this.applySpectateRoster(seats, clock);
      return;
    }
    if (!this.online) return;
    this.rememberRoster(seats);
    for (const seat of seats) {
      if (seat.seat === this.onlineSeat) continue;
      const sim = this.simForSeat(seat.seat);
      if (!sim || sim.parked) continue;
      sim.name = seat.name;
      sim.showName = true;
      if (!seat.alive) {
        if (sim.alive) this.markSimOut(sim);
        continue;
      }
      if (!sim.alive) continue;
      sim.pressure = seat.pressure;
      if (seat.hit) sim.heat = 1;
      if (seat.busy) sim.busy = 1;
    }
    this.refreshOnlineStandings();
  }

  /**
   * Server locked a place (`playerEliminated`). Living seats stay unplaced.
   * Standings open only after this client's own place is locked, and the death
   * pause still gates the overlay.
   */
  noteOnlineElimination(seat: number, place: number): void {
    if (this.spectating) {
      this.noteSpectatorElimination(seat, place);
      return;
    }
    if (!this.online || this.onlineFinal || !Number.isFinite(place)) return;
    const known = this.onlineSeats.get(seat) ?? { seat, name: '', alive: true, place: null, bot: false };
    known.alive = false;
    known.place = place;
    if (seat === this.onlineSeat && !known.name) known.name = this.playerName;
    this.onlineSeats.set(seat, known);
    this.refreshOnlineStandings();
  }

  /**
   * Inbound jammer chosen by the server. The bolt leaves that seat's panel.
   * Only a ghost earn spawns sprites: one per ghost eaten. Dot and clear
   * messages are ignored. Bot shots use the same ghost count.
   */
  receiveOnlineJammer(strength: number, fromName: string, attack: AttackKind = 'ghost', fromSeat?: number): void {
    if (attack !== 'ghost' || !(strength > 0)) return;
    const simId = fromSeat != null ? (this.onlinePanels.get(fromSeat) ?? 1) : 1;
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
    this.onlineFinal = true;
    this.onlineSeats.clear();
    for (const row of placements) {
      this.onlineSeats.set(row.seat, {
        seat: row.seat,
        name: row.name,
        alive: false,
        place: row.place,
        bot: false,
      });
    }
    this.refreshOnlineStandings();
  }

  /**
   * Admit a late joiner as a spectator. The maze stays off.
   * Roster and standings update; there is no playable board for this match.
   */
  beginSpectate(roster: readonly RosterSeat[], clock: number): void {
    this.spectating = true;
    this.online = false;
    this.inMatch = false;
    this.spectatorRoster = roster.map((seat) => ({ ...seat }));
    this.spectatorPlaces.clear();
    this.rememberSpectatorPlaces(this.spectatorRoster);
    this.spectatorClock = clock;
    this.onlineNote = this.spectateNote();
  }

  applySpectateRoster(seats: readonly RosterSeat[], clock?: number): void {
    if (!this.spectating) return;
    this.spectatorRoster = seats.map((seat) => ({ ...seat }));
    if (clock != null) this.spectatorClock = clock;
    this.rememberSpectatorPlaces(this.spectatorRoster);
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
      bot: false,
      ready: false,
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

  /** Server confirmed one other seat is out. The last living seat wins. */
  eliminateOnlineSeat(seat: number): void {
    if (!this.online) return;
    const sim = this.simForSeat(seat);
    if (!sim) return;
    this.markSimOut(sim);
  }

  /** Mark every other online seat out. Used when the server says this client won. */
  eliminateOnlineOpponent(): void {
    if (!this.online) return;
    for (const seat of [...this.onlinePanels.keys()]) this.eliminateOnlineSeat(seat);
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
    this.spectatorRoster = [];
    this.spectatorPlaces.clear();
    this.spectatorClock = 0;
    this.onlinePanels.clear();
    this.onlineSeats.clear();
    this.onlineFinal = false;
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
      standings: this.spectating ? this.spectatorSnapshot() : this.standingsOverlay(),
      canEndMatch: this.mayEndMatch(),
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

  /**
   * End-match control: an in-progress match whose living seats are all bots.
   * A living human, a finished match, and the pre-standings death pause hide it.
   */
  private mayEndMatch(): boolean {
    if (this.spectating) return botsOnly(this.spectatorRoster);
    if (this.online) {
      if (this.onlineFinal || this.match.phase !== 'lost' || this.board.deathTime <= 0.85) return false;
      return botsOnly([...this.onlineSeats.values()]);
    }
    if (this.match.phase !== 'lost' || this.board.deathTime <= 0.85) return false;
    return this.ranking.snapshot().stillIn > 0;
  }

  /** Death rankings wait out the collapse. A win shows them after the congratulations card. */
  private standingsOverlay(): StandingSnapshot | null {
    if (this.match.phase === 'won' && this.winAcknowledged) return this.finalStandings();
    if (this.match.phase !== 'lost' || this.board.deathTime <= 0.85) return null;
    return this.finalStandings();
  }

  /**
   * Online standings are the server list: partial after this seat's confirm,
   * final after `matchEnd`. Offline keeps the local 101.
   */
  private finalStandings(): StandingSnapshot | null {
    if (this.online) return this.onlineStandings;
    return this.ranking.snapshot();
  }

  private rememberRoster(seats: readonly RosterSeat[]): void {
    if (this.onlineFinal) return;
    for (const seat of seats) {
      const known = this.onlineSeats.get(seat.seat);
      const name = seat.name || known?.name || '';
      const place = known?.place ?? null;
      this.onlineSeats.set(seat.seat, {
        seat: seat.seat,
        name,
        alive: place != null ? false : seat.alive,
        place,
        bot: seat.bot,
      });
    }
  }

  /** Blank places for the living. Locked places only from server confirms. */
  private refreshOnlineStandings(): void {
    if (!this.online) return;
    const self = this.onlineSeats.get(this.onlineSeat);
    if (!this.onlineFinal && self?.place == null) {
      this.onlineStandings = null;
      return;
    }
    const seats = [...this.onlineSeats.values()];
    const label = (seat: OnlineSeat): string =>
      seat.name || (seat.seat === this.onlineSeat ? this.playerName : 'Pac');
    const toRow = (seat: OnlineSeat, state: 'active' | 'out') => ({
      place: state === 'active' ? null : seat.place,
      name: label(seat),
      you: seat.seat === this.onlineSeat,
      state,
    });
    if (this.onlineFinal) {
      const rows = seats
        .sort((a, b) => (a.place ?? 0) - (b.place ?? 0) || a.seat - b.seat)
        .map((seat) => toRow(seat, 'out'));
      this.onlineStandings = {
        rows,
        yourPlace: rows.find((row) => row.you)?.place ?? null,
        stillIn: 0,
      };
      return;
    }
    const active = seats
      .filter((seat) => seat.alive && seat.place == null)
      .sort((a, b) => label(a).localeCompare(label(b)) || a.seat - b.seat);
    const out = seats
      .filter((seat) => seat.place != null || !seat.alive)
      .sort((a, b) => (a.place ?? Number.MAX_SAFE_INTEGER) - (b.place ?? Number.MAX_SAFE_INTEGER) || a.seat - b.seat);
    const rows = [...active.map((seat) => toRow(seat, 'active')), ...out.map((seat) => toRow(seat, 'out'))];
    this.onlineStandings = {
      rows,
      yourPlace: self?.place ?? null,
      stillIn: active.length,
    };
  }

  /** Locked places travel on the roster, including seats already out at join. */
  private rememberSpectatorPlaces(seats: readonly RosterSeat[]): void {
    for (const seat of seats) {
      if (seat.place == null) continue;
      this.spectatorPlaces.set(seat.seat, seat.place);
    }
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
        active.push({ place: null, name: seat.name, you: false, state: 'active' });
      } else {
        out.push({ place, name: seat.name, you: false, state: 'out' });
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

  private simForSeat(seat: number) {
    const simId = this.onlinePanels.get(seat);
    if (simId == null) return undefined;
    return this.sims.sims.find((sim) => sim.id === simId);
  }

  private markSimOut(sim: { id: number; alive: boolean; pressure: number; busy: number }): void {
    if (!sim.alive) return;
    sim.alive = false;
    sim.pressure = KILL_PRESSURE;
    sim.busy = 0;
    this.bus.emit({ type: 'simEliminated', simId: sim.id, remainingPlayers: 1 + this.sims.aliveCount() });
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

interface OnlineSeat {
  seat: number;
  name: string;
  alive: boolean;
  /** Null while the server has not locked a finish. */
  place: number | null;
  bot: boolean;
}

/** Living seats are all CPU bots, so a waiting human may close the match. */
function botsOnly(seats: readonly { alive: boolean; bot: boolean }[]): boolean {
  const living = seats.filter((seat) => seat.alive);
  return living.length > 0 && living.every((seat) => seat.bot);
}

function oneOpponentRoster(you: number, name: string): RosterSeat[] {
  const other = you === 1 ? 2 : 1;
  const blank = { alive: true, pressure: 0, hit: false, busy: false, bot: false, ready: true };
  return [
    { ...blank, seat: you, name: '' },
    { ...blank, seat: other, name: name || 'Opponent' },
  ];
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
