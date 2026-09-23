/**
 * N1 wire messages. The server owns targets, pressure, and eliminations.
 * `earnAttack` never carries a target. Only `ghost` is applied. `dots` and `clear` are ignored.
 */

export const MATCH_SEATS = 2;
export const DEFAULT_PORT = 8787;
export const DEFAULT_WS_URL = 'ws://localhost:8787';
export const STRENGTH_MIN = 1;
export const STRENGTH_MAX = 200;
/** Accepted earn-attacks per seat in {@link EARN_RATE_WINDOW_MS}. */
export const EARN_RATE_LIMIT = 12;
export const EARN_RATE_WINDOW_MS = 1000;

export type AttackKind = 'ghost' | 'dots' | 'clear';

export interface RosterSeat {
  seat: number;
  name: string;
  alive: boolean;
  pressure: number;
  /** Fresh hit flash for this delta. */
  hit: boolean;
  /** This seat just fired. */
  busy: boolean;
}

export interface Placement {
  seat: number;
  name: string;
  place: number;
}

export type ClientMessage =
  | { type: 'join'; name: string }
  | { type: 'ready' }
  | { type: 'earnAttack'; attack: AttackKind; strength: number }
  | { type: 'deathReport' }
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'lobby'; you: number; seats: RosterSeat[]; need: number }
  | { type: 'matchStart'; you: number; roster: RosterSeat[]; grace: number }
  | { type: 'jammerInbound'; fromSeat: number; fromName: string; strength: number; attack: AttackKind }
  | { type: 'rosterDelta'; seats: RosterSeat[] }
  | { type: 'playerEliminated'; seat: number; place: number; remaining: number }
  | { type: 'matchEnd'; winnerSeat: number | null; placements: Placement[] }
  | { type: 'ping' }
  | { type: 'error'; text: string };

export function isAttackKind(value: unknown): value is AttackKind {
  return value === 'ghost' || value === 'dots' || value === 'clear';
}

/** Same trim as the local name field. Blank becomes Pac. */
export function displayName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Pac';
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, 16);
  return name.length > 0 ? name : 'Pac';
}
