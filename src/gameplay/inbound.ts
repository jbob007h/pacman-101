import {
  inboundCount,
  JAMMER_CAP,
  JAMMER_DEATH_SECONDS,
  JAMMER_HIT_DISTANCE,
  JAMMER_SPAWN_SECONDS,
  MAZE_COLS,
  MAZE_ROWS,
  RED_CHASE_MULT,
  WHITE_CHASE_MULT,
} from '../config';
import type { Rng } from '../shared/rng';
import type { Dir } from '../shared/types';
import { DIR_DOWN, DIR_LEFT, DIR_NONE, DIR_RIGHT, DIR_UP, isOpposite, opposite } from '../shared/types';
import type { Maze } from './maze';
import { advanceMover, nearCenter, type Mover } from './movement';

export type JammerKind = 'white' | 'red';
export type JammerPhase = 'spawn' | 'live' | 'dying';

export interface InboundJammer extends Mover {
  kind: JammerKind;
  phase: JammerPhase;
  /** 0–1 progress of the spawn or death animation. */
  anim: number;
  centerKey: number;
  prevX: number;
  prevY: number;
}

const DIRS: readonly Dir[] = [DIR_LEFT, DIR_RIGHT, DIR_UP, DIR_DOWN];
const RED_START = 90;
const RED_ONLY = 420;
const RED_DENOM = 12;

/**
 * Red share of each inbound attack, out of 12, by match time.
 * The first attack at or after 1:30 ignores this row and is exactly one red
 * plus white for the rest of that attack.
 *
 * | Elapsed   | Red / 12 |
 * | --- | --- |
 * | 0:00–1:30 | 0 (white only) |
 * | 1:30–2:00 | 1 |
 * | 2:00–2:30 | 2 |
 * | 2:30–3:00 | 3 |
 * | 3:00–3:30 | 4 |
 * | 3:30–4:00 | 5 |
 * | 4:00–4:30 | 6 |
 * | 4:30–5:00 | 7 |
 * | 5:00–5:30 | 8 |
 * | 5:30–6:00 | 9 |
 * | 6:00–6:30 | 10 |
 * | 6:30–7:00 | 11 |
 * | 7:00+     | 12 (red only) |
 */
const RED_WEIGHTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

export function quadrantOf(x: number, y: number): number {
  const col = x < MAZE_COLS / 2 ? 0 : 1;
  const row = y < MAZE_ROWS / 2 ? 0 : 1;
  return row * 2 + col;
}

/** Red weight out of 12 for this match time. 0 before 1:30, 12 from 7:00 on. */
export function redWeight(elapsed: number): number {
  if (elapsed < RED_START) return 0;
  if (elapsed >= RED_ONLY) return RED_DENOM;
  const step = Math.floor((elapsed - RED_START) / 30);
  return RED_WEIGHTS[Math.min(step, RED_WEIGHTS.length - 1)] ?? RED_DENOM;
}

export function splitJammerColors(
  elapsed: number,
  count: number,
  firstRedPending: boolean,
): { red: number; white: number; usedFirstRed: boolean } {
  if (count <= 0) return { red: 0, white: 0, usedFirstRed: false };
  if (elapsed < RED_START) return { red: 0, white: count, usedFirstRed: false };
  if (firstRedPending) return { red: 1, white: count - 1, usedFirstRed: true };
  const weight = redWeight(elapsed);
  const red = weight >= RED_DENOM ? count : Math.min(count, Math.round((count * weight) / RED_DENOM));
  return { red, white: count - red, usedFirstRed: false };
}

/**
 * White slow starts at 0.6s and 42% speed, then grows by 0.12s every 30s of
 * match time, capped at the 7:00 step. Red jammers do not slow Pac; they kill him.
 */
export function slowProfile(elapsed: number): { seconds: number; factor: number } {
  const steps = Math.min(14, Math.floor(Math.max(0, elapsed) / 30));
  return { seconds: 0.6 + steps * 0.12, factor: 0.42 };
}

export function formatMatchTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Inbound jammers on the main maze. Spawned from `incomingJammer` on the
 * composition root. Systems never import this module.
 */
export class InboundField {
  jammers: InboundJammer[] = [];
  /** Seconds of slow still left on Pac. */
  slow = 0;
  /** Multiplier applied to Pac's speed while {@link slow} is positive. */
  slowFactor = 1;
  private firstRedPending = true;

  get count(): number {
    return this.jammers.length;
  }

  /**
   * Spawn up to the attack's count. Anything that would pass {@link JAMMER_CAP}
   * is negated. Returns how many sprites were actually created.
   */
  spawn(
    strength: number,
    elapsed: number,
    maze: Maze,
    pacX: number,
    pacY: number,
    rng: Rng,
    exact = false,
  ): number {
    const wanted = exact ? exactJammerCount(strength) : inboundCount(strength);
    const room = Math.max(0, JAMMER_CAP - this.jammers.length);
    const count = Math.min(wanted, room);
    if (count <= 0) return 0;
    const colors = splitJammerColors(elapsed, count, this.firstRedPending);
    if (colors.usedFirstRed) this.firstRedPending = false;
    const tiles = pickSpawnTiles(maze, pacX, pacY, count, this.jammers, rng);
    let redsLeft = colors.red;
    for (const tile of tiles) {
      const kind: JammerKind = redsLeft > 0 ? 'red' : 'white';
      if (kind === 'red') redsLeft -= 1;
      this.jammers.push(createJammer(kind, tile.x, tile.y, pacX, pacY, maze));
    }
    return tiles.length;
  }

  /**
   * `chase` is false before the match-clock gate. Live jammers still age their
   * spawn and death, and {@link touch} still slows or kills. They do not pathfind.
   */
  update(
    dt: number,
    maze: Maze,
    pacX: number,
    pacY: number,
    chaseSpeed: number,
    freezeReds: boolean,
    chase = true,
  ): void {
    if (this.slow > 0) {
      this.slow = Math.max(0, this.slow - dt);
      if (this.slow <= 0) this.slowFactor = 1;
    }
    const next: InboundJammer[] = [];
    for (const jammer of this.jammers) {
      jammer.prevX = jammer.x;
      jammer.prevY = jammer.y;
      if (jammer.phase === 'spawn') {
        jammer.anim = Math.min(1, jammer.anim + dt / JAMMER_SPAWN_SECONDS);
        if (jammer.anim >= 1) {
          jammer.phase = 'live';
          jammer.anim = 1;
        }
        next.push(jammer);
        continue;
      }
      if (jammer.phase === 'dying') {
        jammer.anim = Math.min(1, jammer.anim + dt / JAMMER_DEATH_SECONDS);
        if (jammer.anim < 1) next.push(jammer);
        continue;
      }
      if (!chase || (jammer.kind === 'red' && freezeReds)) {
        next.push(jammer);
        continue;
      }
      const speed = chaseSpeed * (jammer.kind === 'red' ? RED_CHASE_MULT : WHITE_CHASE_MULT);
      const traveled = advanceMover(
        jammer,
        dt,
        speed,
        (x, y) => maze.blocks(x, y, 'pac'),
        maze.tunnelRow,
        maze.cols,
        () => steer(jammer, maze, pacX, pacY),
      );
      if (traveled < 0.01) jammer.centerKey = -1;
      next.push(jammer);
    }
    this.jammers = next;
  }

  /** Returns true when a live red jammer touches Pac. Spawning jammers never collide. */
  touch(pacX: number, pacY: number, elapsed: number, prevPacX = pacX, prevPacY = pacY): boolean {
    let kill = false;
    for (const jammer of this.jammers) {
      if (jammer.phase !== 'live') continue;
      const hit = sweptHit(jammer.prevX, jammer.prevY, jammer.x, jammer.y, prevPacX, prevPacY, pacX, pacY, JAMMER_HIT_DISTANCE);
      if (!hit) continue;
      if (jammer.kind === 'red') {
        kill = true;
        continue;
      }
      jammer.phase = 'dying';
      jammer.anim = 0;
      this.applySlow(elapsed);
    }
    return kill;
  }

  /** Power pellets wipe every white jammer. Reds stay and hold still while frightened. */
  killWhites(): void {
    for (const jammer of this.jammers) {
      if (jammer.kind !== 'white' || jammer.phase === 'dying') continue;
      jammer.phase = 'dying';
      jammer.anim = 0;
    }
  }

  /**
   * Put live reds back where they started this frame.
   * The pellet is eaten after jammers move, so the eat frame would otherwise
   * still chase for one step.
   */
  holdReds(): void {
    for (const jammer of this.jammers) {
      if (jammer.kind !== 'red' || jammer.phase !== 'live') continue;
      jammer.x = jammer.prevX;
      jammer.y = jammer.prevY;
    }
  }

  /** Eating the fruit clears every red jammer off the board. */
  killReds(): void {
    for (const jammer of this.jammers) {
      if (jammer.kind !== 'red' || jammer.phase === 'dying') continue;
      jammer.phase = 'dying';
      jammer.anim = 0;
    }
  }

  reset(): void {
    this.jammers = [];
    this.slow = 0;
    this.slowFactor = 1;
    this.firstRedPending = true;
  }

  private applySlow(elapsed: number): void {
    const profile = slowProfile(elapsed);
    this.slow = Math.max(this.slow, profile.seconds);
    this.slowFactor = this.slowFactor === 1 ? profile.factor : Math.min(this.slowFactor, profile.factor);
  }
}

function createJammer(kind: JammerKind, x: number, y: number, pacX: number, pacY: number, maze: Maze): InboundJammer {
  const jammer: InboundJammer = {
    kind,
    phase: 'spawn',
    anim: 0,
    centerKey: -1,
    prevX: x,
    prevY: y,
    x,
    y,
    dir: { ...DIR_NONE },
    queued: null,
  };
  const dir = openingToward(maze, x, y, pacX, pacY);
  jammer.dir = { ...dir };
  return jammer;
}

function openingToward(maze: Maze, x: number, y: number, pacX: number, pacY: number): Dir {
  let best: Dir = DIR_LEFT;
  let bestDist = Infinity;
  let found = false;
  for (const dir of DIRS) {
    if (maze.blocks(x + dir.x, y + dir.y, 'pac')) continue;
    const dist = Math.hypot(x + dir.x - pacX, y + dir.y - pacY);
    if (dist < bestDist) {
      bestDist = dist;
      best = dir;
      found = true;
    }
  }
  return found ? best : DIR_LEFT;
}

function steer(jammer: InboundJammer, maze: Maze, pacX: number, pacY: number): void {
  if (!nearCenter(jammer)) return;
  const cx = Math.round(jammer.x);
  const cy = Math.round(jammer.y);
  const key = cy * maze.cols + cx;
  if (jammer.centerKey === key) return;
  jammer.centerKey = key;
  let best: Dir | null = null;
  let bestDist = Infinity;
  for (const dir of DIRS) {
    if (isOpposite(dir, jammer.dir)) continue;
    if (maze.blocks(cx + dir.x, cy + dir.y, 'pac')) continue;
    const dist = Math.hypot(cx + dir.x - pacX, cy + dir.y - pacY);
    if (dist < bestDist) {
      bestDist = dist;
      best = dir;
    }
  }
  if (!best) {
    const back = opposite(jammer.dir);
    if (!maze.blocks(cx + back.x, cy + back.y, 'pac')) best = back;
  }
  if (best) jammer.dir = { ...best };
}

function pickSpawnTiles(
  maze: Maze,
  pacX: number,
  pacY: number,
  count: number,
  existing: readonly InboundJammer[],
  rng: Rng,
): { x: number; y: number }[] {
  const pacQ = quadrantOf(pacX, pacY);
  const taken = new Set(existing.map((jammer) => tileKey(Math.round(jammer.x), Math.round(jammer.y))));
  const strict = collectTiles(maze, pacX, pacY, pacQ, taken, 4);
  const pool = strict.length > 0 ? strict : collectTiles(maze, pacX, pacY, pacQ, taken, 0);
  const picked: { x: number; y: number }[] = [];
  const bag = pool.slice();
  while (picked.length < count && bag.length > 0) {
    const index = Math.floor(rng() * bag.length);
    const tile = bag.splice(index, 1)[0];
    if (!tile) break;
    picked.push(tile);
    taken.add(tileKey(tile.x, tile.y));
  }
  return picked;
}

function collectTiles(
  maze: Maze,
  pacX: number,
  pacY: number,
  pacQ: number,
  taken: Set<number>,
  minDist: number,
): { x: number; y: number }[] {
  const tiles: { x: number; y: number }[] = [];
  for (let y = 0; y < maze.rows; y++) {
    for (let x = 0; x < maze.cols; x++) {
      if (quadrantOf(x, y) === pacQ) continue;
      if (inGhostHouse(x, y)) continue;
      if (maze.blocks(x, y, 'pac')) continue;
      if (taken.has(tileKey(x, y))) continue;
      if (Math.hypot(x - pacX, y - pacY) < minDist) continue;
      tiles.push({ x, y });
    }
  }
  return tiles;
}

function inGhostHouse(x: number, y: number): boolean {
  return x >= 11 && x <= 16 && y >= 13 && y <= 15;
}

function tileKey(x: number, y: number): number {
  return y * MAZE_COLS + x;
}

/** True if the two movement segments come within `radius` of each other. */
function sweptHit(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  radius: number,
): boolean {
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const jx = ax + (bx - ax) * t;
    const jy = ay + (by - ay) * t;
    const px = cx + (dx - cx) * t;
    const py = cy + (dy - cy) * t;
    if (Math.hypot(jx - px, jy - py) <= radius) return true;
  }
  return false;
}

/** Ghost-window attacks spawn one sprite per eaten ghost, still under the board cap. */
function exactJammerCount(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(JAMMER_CAP, Math.round(count));
}
