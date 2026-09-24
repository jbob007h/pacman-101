import { KILL_PRESSURE, SIM_ATTACK_GRACE } from '../src/config';
import { LOBBY_COUNTDOWN_MS, MAX_HUMANS, ROOM_SIZE } from '../src/net/protocol';
import {
  EARN_RATE_LIMIT,
  EARN_RATE_WINDOW_MS,
  STRENGTH_MAX,
  STRENGTH_MIN,
  displayName,
  isAttackKind,
  type Placement,
  type RosterSeat,
  type ServerMessage,
} from '../src/net/protocol';
import { rollAttackDelay, rollJammerCount } from '../src/systems/jammers';
import { cpuName } from '../src/systems/names';

export interface SeatLink {
  send(message: ServerMessage): void;
}

interface Seat {
  id: number;
  name: string;
  ready: boolean;
  alive: boolean;
  pressure: number;
  hit: boolean;
  busy: boolean;
  place: number | null;
  bot: boolean;
  link: SeatLink;
  earns: number[];
  /** Seconds until this bot fires again. Humans leave this at 0. */
  attackIn: number;
}

interface Watcher {
  id: number;
  name: string;
  link: SeatLink;
}

export type JoinResult =
  | { ok: true; role: 'player'; seat: number }
  | { ok: true; role: 'spectator'; id: number }
  | { ok: false; text: string };

const noopLink: SeatLink = { send() {} };

/**
 * One in-memory room. The first Ready starts a lobby countdown. At 0 the
 * empty seats fill with CPU bots up to {@link ROOM_SIZE}. Joining during
 * play admits a spectator, not a playing seat.
 */
export class MatchRoom {
  private readonly seats = new Map<number, Seat>();
  private readonly byLink = new Map<SeatLink, Seat>();
  private readonly spectators = new Map<SeatLink, Watcher>();
  /** Humans who finished a match and are not in the next lobby yet. */
  private readonly retired = new Map<SeatLink, Watcher>();
  private phase: 'lobby' | 'playing' = 'lobby';
  private countdownEndsAt: number | null = null;
  private lastAnnouncedSecond: number | null = null;
  private matchStartedAt = 0;
  private lastNow: number;
  private watcherSeq = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly rng: () => number = Math.random,
    private readonly countdownMs = LOBBY_COUNTDOWN_MS,
  ) {
    this.lastNow = now();
  }

  join(link: SeatLink, name: unknown): JoinResult {
    if (this.phase === 'playing') return this.admitSpectator(link, name);
    if (this.humanCount() >= MAX_HUMANS) return { ok: false, text: 'Lobby is full' };
    const id = this.nextSeatId();
    if (id == null) return { ok: false, text: 'Lobby is full' };
    const seat = this.makeHuman(id, displayName(name), link);
    this.seats.set(id, seat);
    this.byLink.set(link, seat);
    this.pushLobby();
    return { ok: true, role: 'player', seat: id };
  }

  /** Drop a playing seat by id. Spectators disconnect through {@link disconnect}. */
  leave(id: number): void {
    const seat = this.seats.get(id);
    if (!seat || seat.bot) return;
    this.disconnect(seat.link);
  }

  disconnect(link: SeatLink): void {
    const spectator = this.spectators.get(link);
    if (spectator) {
      this.spectators.delete(link);
      return;
    }
    if (this.retired.delete(link)) return;
    const seat = this.byLink.get(link);
    if (!seat) return;
    this.byLink.delete(link);
    if (this.phase === 'playing' && seat.alive) {
      seat.link = noopLink;
      this.eliminate(seat);
      return;
    }
    this.seats.delete(seat.id);
    if (this.phase !== 'lobby') return;
    if (this.humanCount() === 0) {
      this.countdownEndsAt = null;
      this.lastAnnouncedSecond = null;
      return;
    }
    this.pushLobby();
  }

  /** Messages from a playing human, keyed by seat id. */
  handle(id: number, raw: unknown): void {
    const seat = this.seats.get(id);
    if (!seat || seat.bot) return;
    this.handleSeat(seat, raw);
  }

  onMessage(link: SeatLink, raw: unknown): void {
    if (!isRecord(raw) || typeof raw.type !== 'string') return;
    const seat = this.byLink.get(link);
    if (seat) {
      this.handleSeat(seat, raw);
      return;
    }
    if (this.spectators.has(link)) {
      if (raw.type === 'ping') link.send({ type: 'ping' });
      if (raw.type === 'endMatch') this.endIfBotsOnly();
      return;
    }
    const retired = this.retired.get(link);
    if (!retired) return;
    if (raw.type === 'ping') link.send({ type: 'ping' });
    if (raw.type === 'ready') this.promoteRetired(retired);
  }

  /**
   * Advance the lobby clock and bot attack timers.
   * Pass seconds to step bots in tests. Otherwise the delta comes from {@link now}.
   */
  tick(dtSeconds?: number): void {
    const t = this.now();
    const dt = dtSeconds != null ? Math.max(0, dtSeconds) : Math.max(0, (t - this.lastNow) / 1000);
    this.lastNow = t;
    if (this.phase === 'lobby') {
      this.announceCountdown();
      if (this.countdownEndsAt != null && t >= this.countdownEndsAt) this.begin();
      return;
    }
    this.tickBots(dt);
  }

  private admitSpectator(link: SeatLink, name: unknown): JoinResult {
    const watcher: Watcher = { id: ++this.watcherSeq, name: displayName(name), link };
    this.spectators.set(link, watcher);
    link.send({ type: 'spectate', roster: this.roster(), clock: this.clock() });
    return { ok: true, role: 'spectator', id: watcher.id };
  }

  private promoteRetired(retired: Watcher): void {
    if (this.phase === 'playing') {
      this.retired.delete(retired.link);
      this.admitSpectator(retired.link, retired.name);
      return;
    }
    if (this.humanCount() >= MAX_HUMANS) return;
    const id = this.nextSeatId();
    if (id == null) return;
    this.retired.delete(retired.link);
    const seat = this.makeHuman(id, retired.name, retired.link);
    this.seats.set(id, seat);
    this.byLink.set(retired.link, seat);
    this.markReady(seat);
  }

  private handleSeat(seat: Seat, raw: unknown): void {
    if (!isRecord(raw) || typeof raw.type !== 'string') return;
    if (raw.type === 'ping') {
      seat.link.send({ type: 'ping' });
      return;
    }
    if (raw.type === 'ready') {
      this.markReady(seat);
      return;
    }
    if (raw.type === 'earnAttack') {
      this.earn(seat, raw);
      return;
    }
    if (raw.type === 'deathReport') {
      if (this.phase === 'playing' && seat.alive) this.eliminate(seat);
      return;
    }
    if (raw.type === 'endMatch') {
      if (seat.alive || seat.bot) return;
      this.endIfBotsOnly();
    }
  }

  private makeHuman(id: number, name: string, link: SeatLink): Seat {
    return {
      id,
      name,
      ready: false,
      alive: true,
      pressure: 0,
      hit: false,
      busy: false,
      place: null,
      bot: false,
      link,
      earns: [],
      attackIn: 0,
    };
  }

  private fresh(seat: Seat): void {
    seat.ready = false;
    seat.alive = true;
    seat.pressure = 0;
    seat.hit = false;
    seat.busy = false;
    seat.place = null;
    seat.earns = [];
  }

  private markReady(seat: Seat): void {
    if (this.phase !== 'lobby' || seat.bot) return;
    seat.ready = true;
    if (this.countdownEndsAt == null) {
      this.countdownEndsAt = this.now() + this.countdownMs;
      this.lastAnnouncedSecond = null;
    }
    this.pushLobby();
  }

  private announceCountdown(): void {
    if (this.countdownEndsAt == null) return;
    const left = Math.max(0, this.countdownEndsAt - this.now());
    const sec = Math.ceil(left / 1000);
    if (sec === this.lastAnnouncedSecond) return;
    this.lastAnnouncedSecond = sec;
    this.pushLobby();
  }

  private begin(): void {
    this.countdownEndsAt = null;
    this.lastAnnouncedSecond = null;
    this.phase = 'playing';
    const humans = [...this.seats.values()].filter((seat) => !seat.bot);
    const used = new Set(humans.map((seat) => seat.id));
    for (let id = 1; id <= ROOM_SIZE; id++) {
      if (used.has(id)) continue;
      this.seats.set(id, {
        id,
        name: cpuName(id),
        ready: true,
        alive: true,
        pressure: 0,
        hit: false,
        busy: false,
        place: null,
        bot: true,
        link: noopLink,
        earns: [],
        attackIn: 0,
      });
    }
    for (const seat of this.seats.values()) {
      this.fresh(seat);
      if (seat.bot) seat.attackIn = rollAttackDelay(this.rng);
      else seat.ready = true;
    }
    this.matchStartedAt = this.now();
    const roster = this.roster();
    for (const seat of humans) {
      seat.link.send({
        type: 'matchStart',
        you: seat.id,
        roster,
        grace: SIM_ATTACK_GRACE,
      });
    }
  }

  private tickBots(dt: number): void {
    if (!(dt > 0)) return;
    for (const seat of [...this.seats.values()]) {
      if (this.phase !== 'playing') return;
      if (!seat.bot || !seat.alive) continue;
      seat.attackIn -= dt;
      if (seat.attackIn > 0) continue;
      this.botFire(seat);
      if (!seat.alive || this.phase !== 'playing') continue;
      seat.attackIn = rollAttackDelay(this.rng);
    }
  }

  private botFire(seat: Seat): void {
    if (this.phase !== 'playing' || !seat.alive) return;
    const strength = rollJammerCount(this.rng);
    this.applyHit(seat, strength, 'ghost');
  }

  private earn(seat: Seat, raw: Record<string, unknown>): void {
    if (this.phase !== 'playing' || !seat.alive || seat.bot) return;
    if ('target' in raw || 'targetId' in raw || 'targetSeat' in raw) return;
    if (!isAttackKind(raw.attack) || raw.attack !== 'ghost') return;
    if (typeof raw.strength !== 'number' || !Number.isFinite(raw.strength)) return;
    const rounded = Math.round(raw.strength);
    if (rounded < 1) return;
    const strength = Math.min(STRENGTH_MAX, Math.max(STRENGTH_MIN, rounded));
    if (!this.allowEarn(seat)) return;
    this.applyHit(seat, strength, raw.attack);
  }

  private applyHit(seat: Seat, strength: number, attack: 'ghost'): void {
    const victims = [...this.seats.values()].filter((other) => other.alive && other.id !== seat.id);
    if (victims.length === 0) return;
    const victim = victims[Math.floor(this.rng() * victims.length)];
    if (!victim) return;
    victim.pressure += strength;
    victim.hit = true;
    seat.busy = true;
    if (!victim.bot) {
      victim.link.send({
        type: 'jammerInbound',
        fromSeat: seat.id,
        fromName: seat.name,
        strength,
        attack,
      });
    }
    if (victim.pressure >= KILL_PRESSURE) this.eliminate(victim);
    else this.publishRoster();
  }

  private allowEarn(seat: Seat): boolean {
    const now = this.now();
    seat.earns = seat.earns.filter((stamp) => now - stamp < EARN_RATE_WINDOW_MS);
    if (seat.earns.length >= EARN_RATE_LIMIT) return false;
    seat.earns.push(now);
    return true;
  }

  private eliminate(seat: Seat): void {
    if (!seat.alive || this.phase !== 'playing') return;
    seat.alive = false;
    seat.pressure = Math.max(seat.pressure, KILL_PRESSURE);
    seat.busy = false;
    const survivors = [...this.seats.values()].filter((other) => other.alive);
    seat.place = survivors.length + 1;
    this.broadcast({
      type: 'playerEliminated',
      seat: seat.id,
      place: seat.place,
      remaining: survivors.length,
    });
    this.publishRoster();
    if (survivors.length <= 1) this.finish(survivors[0] ?? null);
  }

  /**
   * Eliminated humans and spectators may close a match that only bots are
   * still playing. A living human, a bot, or a match that already ended is ignored.
   * Survivors keep distinct places: lower pressure first, then seat id.
   */
  private endIfBotsOnly(): void {
    if (this.phase !== 'playing') return;
    const alive = [...this.seats.values()].filter((seat) => seat.alive);
    if (alive.some((seat) => !seat.bot)) return;
    alive.sort((a, b) => a.pressure - b.pressure || a.id - b.id);
    alive.forEach((seat, index) => {
      seat.place = index + 1;
    });
    this.finish(alive[0] ?? null);
  }

  private finish(winner: Seat | null): void {
    if (this.phase !== 'playing') return;
    if (winner) winner.place = 1;
    const placements: Placement[] = [...this.seats.values()]
      .sort((a, b) => a.id - b.id)
      .map((seat) => ({
        seat: seat.id,
        name: seat.name,
        place: seat.place ?? (seat.alive ? 1 : ROOM_SIZE),
      }));
    this.broadcast({
      type: 'matchEnd',
      winnerSeat: winner?.id ?? null,
      placements,
    });
    this.phase = 'lobby';
    this.countdownEndsAt = null;
    this.lastAnnouncedSecond = null;
    const watching = [...this.spectators.values()];
    this.spectators.clear();
    for (const seat of [...this.seats.values()]) {
      this.seats.delete(seat.id);
      if (seat.bot) continue;
      const stillLinked = this.byLink.get(seat.link) === seat;
      this.byLink.delete(seat.link);
      if (!stillLinked) continue;
      this.retired.set(seat.link, { id: seat.id, name: seat.name, link: seat.link });
    }
    for (const watcher of watching) {
      if (this.humanCount() >= MAX_HUMANS) {
        watcher.link.send({ type: 'error', text: 'Lobby is full' });
        continue;
      }
      const id = this.nextSeatId();
      if (id == null) continue;
      const seat = this.makeHuman(id, watcher.name, watcher.link);
      this.seats.set(id, seat);
      this.byLink.set(watcher.link, seat);
    }
    if (this.humanCount() > 0) this.pushLobby();
  }

  private publishRoster(): void {
    this.broadcast({ type: 'rosterDelta', seats: this.roster(), clock: this.clock() });
    for (const seat of this.seats.values()) {
      seat.hit = false;
      seat.busy = false;
    }
  }

  private pushLobby(): void {
    const seats = this.roster();
    const countdownMs = this.countdownLeft();
    if (countdownMs != null) this.lastAnnouncedSecond = Math.ceil(countdownMs / 1000);
    for (const seat of this.seats.values()) {
      if (seat.bot) continue;
      seat.link.send({ type: 'lobby', you: seat.id, seats, need: ROOM_SIZE, countdownMs });
    }
  }

  private countdownLeft(): number | null {
    if (this.countdownEndsAt == null) return null;
    return Math.max(0, this.countdownEndsAt - this.now());
  }

  private clock(): number {
    if (this.phase !== 'playing') return 0;
    return Math.max(0, (this.now() - this.matchStartedAt) / 1000);
  }

  private roster(): RosterSeat[] {
    return [...this.seats.values()]
      .sort((a, b) => a.id - b.id)
      .map((seat) => ({
        seat: seat.id,
        name: seat.name,
        alive: seat.alive,
        pressure: seat.pressure,
        hit: seat.hit,
        busy: seat.busy,
        bot: seat.bot,
        ready: seat.ready,
        place: seat.place,
      }));
  }

  private broadcast(message: ServerMessage): void {
    for (const seat of this.byLink.values()) seat.link.send(message);
    for (const watcher of this.spectators.values()) watcher.link.send(message);
  }

  private humanCount(): number {
    let count = 0;
    for (const seat of this.seats.values()) if (!seat.bot) count += 1;
    return count;
  }

  private nextSeatId(): number | null {
    for (let id = 1; id <= ROOM_SIZE; id++) {
      if (!this.seats.has(id)) return id;
    }
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
