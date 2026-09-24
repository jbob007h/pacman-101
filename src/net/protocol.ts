/**
 * Wire messages. The server owns targets, pressure, and eliminations.
 * `earnAttack` never carries a target. Only `ghost` is applied. `dots` and `clear` are ignored.
 *
 * N2b: one room of {@link ROOM_SIZE}. At most {@link MAX_HUMANS} play.
 * The first Ready starts {@link LOBBY_COUNTDOWN_MS}, then bots pad the rest.
 */

/** Playing seats once a match starts, humans plus CPU fillers. */
export const ROOM_SIZE = 101;
/** Humans who can take a playing seat in the lobby. */
export const MAX_HUMANS = 16;
/**
 * Wait after the first Ready before bots pad the room and `matchStart` goes out.
 * More humans may join and Ready during this window. Tune this one constant.
 */
export const LOBBY_COUNTDOWN_MS = 10_000;
export const DEFAULT_PORT = 8787;
/** Dev client default. Production builds use `VITE_WS_URL` via `resolveSocketUrl`. */
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
  /** Server-side CPU filler. Humans are false. */
  bot: boolean;
  /** Lobby ready flag. Bots are ready once the match starts. */
  ready: boolean;
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
  | { type: 'lobby'; you: number; seats: RosterSeat[]; need: number; countdownMs: number | null }
  | { type: 'matchStart'; you: number; roster: RosterSeat[]; grace: number }
  /** Roster-only admission while a match is already in play. No maze, no playing seat. */
  | { type: 'spectate'; roster: RosterSeat[]; clock: number }
  | { type: 'jammerInbound'; fromSeat: number; fromName: string; strength: number; attack: AttackKind }
  | { type: 'rosterDelta'; seats: RosterSeat[]; clock?: number }
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
