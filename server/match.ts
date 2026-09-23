import { KILL_PRESSURE, SIM_ATTACK_GRACE } from '../src/config';
import {
  EARN_RATE_LIMIT,
  EARN_RATE_WINDOW_MS,
  MAX_HUMANS,
  ROOM_SIZE,
  STRENGTH_MAX,
  STRENGTH_MIN,
  displayName,
  isAttackKind,
  type AttackKind,
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
  bot: boolean;
  ready: boolean;
  alive: boolean;
  pressure: number;
  hit: boolean;
  busy: boolean;
  place: number | null;
  connected: boolean;
  link: SeatLink;
  earns: number[];
  /** Seconds until this bot's next shot. Humans leave it at 0. */
  attackIn: number;
}

export type JoinResult = { ok: true; seat: number } | { ok: false; text: string };

const silentLink: SeatLink = { send() {} };

/**
 * One in-memory match. N2a seats up to {@link MAX_HUMANS} humans and, at the
 * whistle, pads the empty chairs with server-side CPU bots until {@link ROOM_SIZE}.
 * The room picks every victim. Bots are pressure fillers: each has its own
 * 8–12s timer from match start and shoots 1–16 jammers at one other living seat.
 */
export class MatchRoom {
  private readonly seats = new Map<number, Seat>();
  private phase: 'lobby' | 'playing' | 'done' = 'lobby';

  constructor(
    private readonly now: () => number = Date.now,
    private readonly rng: () => number = Math.random,
  ) {}

  join(link: SeatLink, name: unknown): JoinResult {
    if (this.phase === 'done') this.recycle();
    if (this.phase === 'playing') return { ok: false, text: 'Match is full' };
    if (this.humanCount() >= MAX_HUMANS) return { ok: false, text: 'Match is full' };
    const id = this.nextSeatId();
    if (id == null) return { ok: false, text: 'Match is full' };
    const seat = this.makeSeat(id, displayName(name), false, link);
    this.seats.set(id, seat);
    this.pushLobby();
    return { ok: true, seat: id };
  }

  leave(id: number): void {
    const seat = this.seats.get(id);
    if (!seat || seat.bot) return;
    seat.connected = false;
    seat.link = silentLink;
    if (this.phase === 'playing' && seat.alive) {
      this.eliminate(seat);
      return;
    }
    this.seats.delete(id);
    if (this.seats.size === 0) this.phase = 'lobby';
    else if (this.phase === 'lobby') this.maybeStart();
  }

  handle(id: number, raw: unknown): void {
    const seat = this.seats.get(id);
    if (!seat || seat.bot || !isRecord(raw) || typeof raw.type !== 'string') return;
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
    }
  }

  /**
   * Advance bot clocks. `dt` is seconds. The live server calls this on a short
   * interval. Tests call it directly. Grace on `matchStart` is not a gate.
   */
  tick(dt: number): void {
    if (this.phase !== 'playing' || !(dt > 0)) return;
    const bots = [...this.seats.values()].filter((seat) => seat.bot && seat.alive).sort((a, b) => a.id - b.id);
    for (const bot of bots) {
      if (this.phase !== 'playing') return;
      if (!bot.alive) continue;
      bot.attackIn -= dt;
      if (bot.attackIn > 0) continue;
      this.botAttack(bot);
      if (this.phase !== 'playing') return;
      bot.attackIn = rollAttackDelay(this.rng);
    }
  }

  private recycle(): void {
    for (const seat of [...this.seats.values()]) {
      if (seat.bot || !seat.connected) this.seats.delete(seat.id);
    }
    this.phase = 'lobby';
    for (const seat of this.seats.values()) this.fresh(seat);
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

  private makeSeat(id: number, name: string, bot: boolean, link: SeatLink): Seat {
    return {
      id,
      name,
      bot,
      ready: false,
      alive: true,
      pressure: 0,
      hit: false,
      busy: false,
      place: null,
      connected: !bot,
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
    seat.attackIn = 0;
  }

  private markReady(seat: Seat): void {
    if (this.phase !== 'lobby') return;
    seat.ready = true;
    this.maybeStart();
  }

  /** Every human already in the lobby is ready, and there is at least one. Solo ready is enough. */
  private maybeStart(): void {
    if (this.phase !== 'lobby') return;
    const humans = [...this.seats.values()].filter((seat) => !seat.bot);
    if (humans.length === 0) return;
    if (humans.every((seat) => seat.ready)) this.begin();
    else this.pushLobby();
  }

  private begin(): void {
    this.fillBots();
    this.phase = 'playing';
    for (const seat of this.seats.values()) {
      this.fresh(seat);
      seat.ready = true;
      if (seat.bot) seat.attackIn = rollAttackDelay(this.rng);
    }
    const roster = this.roster();
    for (const seat of this.seats.values()) {
      seat.link.send({
        type: 'matchStart',
        you: seat.id,
        roster,
        grace: SIM_ATTACK_GRACE,
      });
    }
  }

  /** Pad empty ids with cute CPU names. No-op when the room is already full of humans. */
  private fillBots(): void {
    let nameIndex = 1;
    while (this.seats.size < ROOM_SIZE) {
      const id = this.nextSeatId();
      if (id == null) break;
      const seat = this.makeSeat(id, cpuName(nameIndex), true, silentLink);
      nameIndex += 1;
      this.seats.set(id, seat);
    }
  }

  private earn(seat: Seat, raw: Record<string, unknown>): void {
    if (this.phase !== 'playing' || !seat.alive) return;
    if ('target' in raw || 'targetId' in raw || 'targetSeat' in raw) return;
    if (!isAttackKind(raw.attack) || raw.attack !== 'ghost') return;
    if (typeof raw.strength !== 'number' || !Number.isFinite(raw.strength)) return;
    const rounded = Math.round(raw.strength);
    // A ghost earn is a sprite count. Zero means the batch was empty; do not
    // clamp that up to one jammer.
    if (rounded < 1) return;
    const strength = Math.min(STRENGTH_MAX, Math.max(STRENGTH_MIN, rounded));
    if (!this.allowEarn(seat)) return;
    const victim = this.pickVictim(seat.id);
    if (!victim) return;
    this.strike(seat, victim, strength, raw.attack);
  }

  private botAttack(bot: Seat): void {
    if (!bot.alive || this.phase !== 'playing') return;
    const jammers = rollJammerCount(this.rng);
    const victim = this.pickVictim(bot.id);
    if (!victim) return;
    this.strike(bot, victim, jammers, 'ghost');
  }

  /** Uniform among other living seats, lowest id first so a zero roll is stable. */
  private pickVictim(attackerId: number): Seat | null {
    const victims = this.livingOthers(attackerId);
    if (victims.length === 0) return null;
    const index = Math.min(victims.length - 1, Math.floor(this.rng() * victims.length));
    return victims[index] ?? null;
  }

  private livingOthers(id: number): Seat[] {
    return [...this.seats.values()]
      .filter((seat) => seat.alive && seat.id !== id)
      .sort((a, b) => a.id - b.id);
  }

  /**
   * Human → bot is pressure and a roster flash only.
   * Bot → human also sends `jammerInbound`.
   * Bot → bot is pressure only.
   */
  private strike(attacker: Seat, victim: Seat, strength: number, attack: AttackKind): void {
    victim.pressure += strength;
    victim.hit = true;
    attacker.busy = true;
    if (!victim.bot) {
      victim.link.send({
        type: 'jammerInbound',
        fromSeat: attacker.id,
        fromName: attacker.name,
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

  private finish(winner: Seat | null): void {
    if (this.phase !== 'playing') return;
    if (winner) winner.place = 1;
    this.phase = 'done';
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
  }

  private publishRoster(): void {
    this.broadcast({ type: 'rosterDelta', seats: this.roster() });
    for (const seat of this.seats.values()) {
      seat.hit = false;
      seat.busy = false;
    }
  }

  private pushLobby(): void {
    const seats = this.roster();
    for (const seat of this.seats.values()) {
      seat.link.send({ type: 'lobby', you: seat.id, seats, need: ROOM_SIZE });
    }
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
      }));
  }

  private broadcast(message: ServerMessage): void {
    for (const seat of this.seats.values()) seat.link.send(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
