import { KILL_PRESSURE, SIM_ATTACK_GRACE } from '../src/config';
import {
  EARN_RATE_LIMIT,
  EARN_RATE_WINDOW_MS,
  MATCH_SEATS,
  STRENGTH_MAX,
  STRENGTH_MIN,
  displayName,
  isAttackKind,
  type Placement,
  type RosterSeat,
  type ServerMessage,
} from '../src/net/protocol';

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
  connected: boolean;
  link: SeatLink;
  earns: number[];
}

export type JoinResult = { ok: true; seat: number } | { ok: false; text: string };

/**
 * One in-memory match. N1 seats two humans. The room picks the victim.
 */
export class MatchRoom {
  private readonly seats = new Map<number, Seat>();
  private phase: 'lobby' | 'playing' | 'done' = 'lobby';

  constructor(
    private readonly now: () => number = Date.now,
    private readonly rng: () => number = Math.random,
  ) {}

  join(link: SeatLink, name: unknown): JoinResult {
    if (this.phase === 'done') {
      for (const seat of [...this.seats.values()]) {
        if (!seat.connected) this.seats.delete(seat.id);
      }
    }
    if (this.seats.size >= MATCH_SEATS) return { ok: false, text: 'Match is full' };
    if (this.phase === 'done') {
      this.phase = 'lobby';
      for (const seat of this.seats.values()) this.fresh(seat);
    }
    const id = this.seats.has(1) ? 2 : 1;
    const seat: Seat = {
      id,
      name: displayName(name),
      ready: false,
      alive: true,
      pressure: 0,
      hit: false,
      busy: false,
      place: null,
      connected: true,
      link,
      earns: [],
    };
    this.seats.set(id, seat);
    this.pushLobby();
    return { ok: true, seat: id };
  }

  leave(id: number): void {
    const seat = this.seats.get(id);
    if (!seat) return;
    seat.connected = false;
    seat.link = { send() {} };
    if (this.phase === 'playing' && seat.alive) {
      this.eliminate(seat);
      return;
    }
    this.seats.delete(id);
    if (this.seats.size === 0) this.phase = 'lobby';
    else if (this.phase === 'lobby') this.pushLobby();
  }

  handle(id: number, raw: unknown): void {
    const seat = this.seats.get(id);
    if (!seat || !isRecord(raw) || typeof raw.type !== 'string') return;
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
    if (this.phase !== 'lobby') return;
    seat.ready = true;
    const all = [...this.seats.values()];
    if (all.length === MATCH_SEATS && all.every((other) => other.ready)) this.begin();
    else this.pushLobby();
  }

  private begin(): void {
    this.phase = 'playing';
    for (const seat of this.seats.values()) this.fresh(seat);
    for (const seat of this.seats.values()) seat.ready = true;
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

  private earn(seat: Seat, raw: Record<string, unknown>): void {
    if (this.phase !== 'playing' || !seat.alive) return;
    if ('target' in raw || 'targetId' in raw || 'targetSeat' in raw) return;
    if (!isAttackKind(raw.attack)) return;
    if (typeof raw.strength !== 'number' || !Number.isFinite(raw.strength)) return;
    const strength = Math.min(STRENGTH_MAX, Math.max(STRENGTH_MIN, Math.round(raw.strength)));
    if (!this.allowEarn(seat)) return;
    const victims = [...this.seats.values()].filter((other) => other.alive && other.id !== seat.id);
    if (victims.length === 0) return;
    const victim = victims[Math.floor(this.rng() * victims.length)];
    if (!victim) return;
    victim.pressure += strength;
    victim.hit = true;
    seat.busy = true;
    victim.link.send({
      type: 'jammerInbound',
      fromSeat: seat.id,
      fromName: seat.name,
      strength,
      attack: raw.attack,
    });
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
    const placements: Placement[] = [...this.seats.values()].map((seat) => ({
      seat: seat.id,
      name: seat.name,
      place: seat.place ?? (seat.alive ? 1 : 2),
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
      seat.link.send({ type: 'lobby', you: seat.id, seats, need: MATCH_SEATS });
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
      }));
  }

  private broadcast(message: ServerMessage): void {
    for (const seat of this.seats.values()) seat.link.send(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
