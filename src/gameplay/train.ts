import { COLLIDE_DISTANCE } from '../config';
import type { Dir, GhostId } from '../shared/types';
import { DIR_LEFT } from '../shared/types';
import type { Ghost } from './ghosts';
import type { Maze } from './maze';
import type { Mover } from './movement';

/** Followers behind the leader, not counting the leader. 33 total with the leader. */
export const TRAIN_MAX_FOLLOWERS = 32;
/** Tiles between train members in open corridors. */
export const TRAIN_SPACING = 1;
/** Tiles between train members while the member ahead is in a side tunnel. */
export const TRAIN_TUNNEL_SPACING = 0.5;
/**
 * Wake flight, in tiles per second. A sleeper flies in a straight line to its
 * slot, through walls, much faster than chase (about 6–12) or eyes (16.2).
 * Joined followers use {@link TRAIN_CATCHUP} instead.
 */
export const TRAIN_JOIN_SPEED = 48;
/** How fast a follower already in the train slides into a slot that moved. Tiles per second. */
export const TRAIN_CATCHUP = 18;
/**
 * A woken ghost is eatable once it is this close to its slot at the back.
 * Until then it is only joining, including on the frame Pac touches the sleeper.
 */
export const TRAIN_JOINED = 0.08;
/**
 * Gaps this long or shorter glide once a follower has joined. Anything farther
 * snaps into formation so a ghost already in the train does not cut through walls.
 * The wake flight does not use this: it always interpolates in a straight line.
 */
export const TRAIN_SNAP = 1.75;
/** Drawn opacity of a follower that is not frightened. */
export const TRAIN_ALPHA = 0.7;

/**
 * Vertical corridor that crosses each side tunnel (column 6 on the left, 21 on the right).
 * Four tiles above the tunnel row and four below. The tunnel row itself stays empty
 * so the wrap lane is not a wall of sleepers.
 */
export const SLEEPER_LEFT_X = 6;
export const SLEEPER_RIGHT_X = 21;
export const SLEEPER_ROWS = [10, 11, 12, 13, 15, 16, 17, 18] as const;

export interface Sleeper {
  id: number;
  /** Tile center. */
  x: number;
  y: number;
  awake: boolean;
}

export interface TrainFollower extends Mover {
  id: number;
  centerKey: number;
  reversePending: boolean;
  /** False while this ghost is still traveling into the train. */
  joined: boolean;
  /** Tile where this ghost woke. */
  wakeX: number;
  wakeY: number;
}

interface PathPoint {
  x: number;
  y: number;
}

/**
 * Sleeping ghosts and the single train they join. The four main ghosts stay in
 * {@link ./ghosts.ts}; this module only follows one of them.
 *
 * Leader rule: the first wake picks the closest of the four main ghosts, in
 * tile units, and every follower lines up behind that ghost. House, eyes,
 * leaving, and frightened do not change the pick and do not let the sleeper
 * lead a train of its own. Later wakes append to the same leader.
 */
export class GhostTrain {
  readonly sleepers: Sleeper[];
  followers: TrainFollower[] = [];
  /** Main ghost this train is attached to. Null when nobody has been woken. */
  leaderId: GhostId | null = null;
  private path: PathPoint[] = [];
  private pathSource = '';
  /**
   * After a leader handoff, followers stay on the tiles they already occupy
   * until this body actually moves. That blocks the eat from reforming the line.
   */
  private holdUntilMove: PathPoint | null = null;

  constructor() {
    this.sleepers = sleeperTiles().map((tile, id) => ({ id, x: tile.x, y: tile.y, awake: false }));
  }

  /**
   * Fresh round of sleepers. Every follower was born from a sleeper, so the
   * train is dissolved and all 16 go back to sleep on their original tiles.
   * The four main ghosts are not part of this reset: a board advance calls
   * this and leaves their position, mode, and identity alone. Match restart
   * uses the same call, then replaces the mains itself.
   */
  reset(): void {
    const tiles = sleeperTiles();
    for (const sleeper of this.sleepers) {
      const tile = tiles[sleeper.id];
      if (tile) {
        sleeper.x = tile.x;
        sleeper.y = tile.y;
      }
      sleeper.awake = false;
    }
    this.followers = [];
    this.leaderId = null;
    this.path = [];
    this.pathSource = '';
    this.holdUntilMove = null;
  }

  asleep(): { x: number; y: number }[] {
    return this.sleepers.filter((sleeper) => !sleeper.awake).map((sleeper) => ({ x: sleeper.x, y: sleeper.y }));
  }

  /** `main` while a real main ghost is the leader. Followers never lead the train. */
  headKind(ghosts: readonly Ghost[]): 'main' | 'none' {
    if (this.followers.length === 0 || !this.leaderId) return 'none';
    const leader = ghosts.find((ghost) => ghost.id === this.leaderId);
    if (!leader || !isMainGhost(leader)) return 'none';
    return 'main';
  }

  /**
   * Wake every sleeper Pac is touching. Returns how many woke.
   * At {@link TRAIN_MAX_FOLLOWERS} a touch does nothing and the sleeper stays down.
   */
  touch(pacX: number, pacY: number, ghosts: readonly Ghost[], maze: Maze): number {
    const hits = this.sleepers.filter(
      (sleeper) => !sleeper.awake && Math.hypot(sleeper.x - pacX, sleeper.y - pacY) < COLLIDE_DISTANCE,
    );
    hits.sort(
      (a, b) => Math.hypot(a.x - pacX, a.y - pacY) - Math.hypot(b.x - pacX, b.y - pacY),
    );
    let woke = 0;
    for (const sleeper of hits) {
      if (this.followers.length >= TRAIN_MAX_FOLLOWERS) break;
      if (ghosts.length === 0) break;
      if (this.followers.length === 0) {
        const leader = closestMain(sleeper.x, sleeper.y, ghosts, maze);
        if (!leader) break;
        this.leaderId = leader.id;
        this.path = [];
        this.pathSource = '';
        this.holdUntilMove = null;
      }
      sleeper.awake = true;
      this.followers.push({
        id: sleeper.id,
        x: sleeper.x,
        y: sleeper.y,
        dir: { ...DIR_LEFT },
        queued: null,
        centerKey: -1,
        reversePending: false,
        joined: false,
        wakeX: sleeper.x,
        wakeY: sleeper.y,
      });
      woke += 1;
    }
    return woke;
  }

  /**
   * Pac ate the train leader. That main ghost does not become eyes.
   * The next follower's body becomes that ghost: same id, color, scatter corner,
   * and home, standing where that follower already was, still frightened.
   * Everyone else keeps the tile they occupied. Indices shift (old 3rd is now
   * 2nd) and the breadcrumb is cut so it ends on the promoted body — it is not
   * cleared, so the next step cannot stack the line onto the leader.
   * Returns false when `leader` is not the train leader or the train has no
   * follower. The caller then sends that ghost home as eyes, the usual respawn.
   */
  handoffLeader(leader: Ghost, maze: Maze): boolean {
    if (this.leaderId !== leader.id) return false;
    const next = this.followers[0];
    if (!next) return false;
    leader.x = next.x;
    leader.y = next.y;
    leader.dir = { ...next.dir };
    leader.queued = next.queued ? { ...next.queued } : null;
    leader.mode = 'frightened';
    leader.reversePending = false;
    leader.centerKey = -1;
    leader.stuck = 0;
    this.followers.shift();
    if (this.followers.length === 0) {
      this.leaderId = null;
      this.path = [];
      this.pathSource = '';
      this.holdUntilMove = null;
      return true;
    }
    this.pathSource = `main:${leader.id}`;
    this.cutPathTo(leader.x, leader.y, maze);
    this.holdUntilMove = { x: leader.x, y: leader.y };
    return true;
  }

  /** Remove a follower Pac just ate. The ones behind keep their positions and slide up next update. */
  removeFollower(id: number): void {
    this.followers = this.followers.filter((follower) => follower.id !== id);
    if (this.followers.length === 0) {
      this.leaderId = null;
      this.path = [];
      this.pathSource = '';
      this.holdUntilMove = null;
    }
  }

  closestFollower(pacX: number, pacY: number): TrainFollower | null {
    let best: TrainFollower | null = null;
    let bestD = COLLIDE_DISTANCE;
    for (const follower of this.followers) {
      if (!follower.joined) continue;
      const dist = Math.hypot(follower.x - pacX, follower.y - pacY);
      if (dist < bestD) {
        bestD = dist;
        best = follower;
      }
    }
    return best;
  }

  update(dt: number, ghosts: readonly Ghost[], maze: Maze): void {
    if (dt < 0) return;
    if (this.followers.length === 0) {
      this.leaderId = null;
      this.path = [];
      this.pathSource = '';
      this.holdUntilMove = null;
      return;
    }
    const leader = ghosts.find((ghost) => ghost.id === this.leaderId);
    if (!leader || !isMainGhost(leader)) {
      this.followers = [];
      this.leaderId = null;
      this.path = [];
      this.pathSource = '';
      this.holdUntilMove = null;
      return;
    }
    this.usePath(`main:${leader.id}`);
    this.pushPath(leader.x, leader.y, maze);
    this.pullFollowers(dt, maze, 0);
  }

  private usePath(source: string): void {
    if (this.pathSource === source) return;
    this.pathSource = source;
    this.path = [];
  }

  private pushPath(x: number, y: number, maze: Maze): void {
    const last = this.path[this.path.length - 1];
    if (last) {
      const dx = unwrapDelta(last.x, x, last.y, y, maze.cols, maze.tunnelRow);
      if (Math.hypot(dx, y - last.y) < 0.03) return;
    }
    this.path.push({ x, y });
    trimPath(this.path, 48, maze.cols, maze.tunnelRow);
  }

  /**
   * End the trail on the promoted body and drop the eaten leader's lead.
   * A missing trail is seeded with the tiles people already stand on, so a
   * later follow step does not invent a stack on the leader.
   */
  private cutPathTo(x: number, y: number, maze: Maze): void {
    if (this.path.length === 0) {
      const seeded: PathPoint[] = [];
      for (let i = this.followers.length - 1; i >= 0; i--) {
        const follower = this.followers[i];
        if (follower) seeded.push({ x: follower.x, y: follower.y });
      }
      seeded.push({ x, y });
      this.path = seeded;
      return;
    }
    let best = this.path.length - 1;
    let bestD = Infinity;
    for (let i = 0; i < this.path.length; i++) {
      const point = this.path[i];
      if (!point) continue;
      const dx = unwrapDelta(point.x, x, point.y, y, maze.cols, maze.tunnelRow);
      const dist = Math.hypot(dx, y - point.y);
      if (dist < bestD) {
        bestD = dist;
        best = i;
      }
    }
    this.path.length = best + 1;
    const last = this.path[this.path.length - 1];
    if (last) {
      last.x = x;
      last.y = y;
    }
  }

  private pullFollowers(dt: number, maze: Maze, fromIndex: number): void {
    if (this.holdUntilMove) {
      const head = this.path[this.path.length - 1];
      const held = this.holdUntilMove;
      const moved = head
        ? Math.hypot(unwrapDelta(held.x, head.x, held.y, head.y, maze.cols, maze.tunnelRow), head.y - held.y)
        : 0;
      if (moved < 0.2) return;
      this.holdUntilMove = null;
    }
    const count = this.followers.length - fromIndex;
    if (count <= 0) return;
    const slots = slotsBehind(
      this.path,
      count,
      (x, y) => (maze.inSideTunnel(x, y) ? TRAIN_TUNNEL_SPACING : TRAIN_SPACING),
      maze.cols,
      maze.tunnelRow,
    );
    for (let i = fromIndex; i < this.followers.length; i++) {
      const follower = this.followers[i];
      const slot = slots[i - fromIndex];
      if (!follower || !slot) continue;
      if (dt <= 0) continue;
      const left = follower.joined
        ? glideToward(follower, slot, dt, maze.cols, maze.tunnelRow)
        : flyStraight(follower, slot, dt, TRAIN_JOIN_SPEED);
      if (left <= TRAIN_JOINED) follower.joined = true;
    }
  }
}

const MAIN_IDS: readonly GhostId[] = ['blinky', 'pinky', 'inky', 'clyde'];

function isMainGhost(ghost: Ghost): boolean {
  return MAIN_IDS.includes(ghost.id);
}

/**
 * Tile-unit gap between two actors. Positions are already in tiles, not pixels.
 * A ghost mid-wrap on the tunnel row is folded back onto the board, and two
 * points on that row use the short way around.
 */
export function mainGhostDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cols: number,
  tunnelRow: number,
): number {
  const x0 = tunnelX(ax, ay, cols, tunnelRow);
  const x1 = tunnelX(bx, by, cols, tunnelRow);
  const dx = unwrapDelta(x0, x1, ay, by, cols, tunnelRow);
  return Math.hypot(dx, by - ay);
}

export function sleeperTiles(): { x: number; y: number }[] {
  const tiles: { x: number; y: number }[] = [];
  for (const x of [SLEEPER_LEFT_X, SLEEPER_RIGHT_X]) {
    for (const y of SLEEPER_ROWS) tiles.push({ x, y });
  }
  return tiles;
}

/** Cyan at the front of the train, magenta at the tail. */
export function trainMemberColor(index: number, total: number): string {
  const t = total <= 1 ? 0 : index / (total - 1);
  const hue = 168 + t * 152;
  const light = 78 - t * 16;
  return `hsl(${hue} 88% ${light}%)`;
}

/**
 * Points one spacing behind the head, then one spacing behind that, and so on.
 * `path` is oldest first. A short trail stacks extras on the oldest point.
 */
export function slotsBehind(
  path: readonly PathPoint[],
  count: number,
  gapAt: (x: number, y: number) => number,
  cols: number,
  tunnelRow: number,
): PathPoint[] {
  const out: PathPoint[] = [];
  if (count <= 0) return out;
  const head = path[path.length - 1];
  if (!head) return out;
  let seg = path.length - 1;
  let cx = head.x;
  let cy = head.y;
  for (let n = 0; n < count; n++) {
    let need = gapAt(cx, cy);
    while (need > 1e-5 && seg > 0) {
      const prev = path[seg - 1];
      if (!prev) break;
      const dx = unwrapDelta(cx, prev.x, cy, prev.y, cols, tunnelRow);
      const dy = prev.y - cy;
      const len = Math.hypot(dx, dy);
      if (len <= 1e-6) {
        seg -= 1;
        cx = prev.x;
        cy = prev.y;
        continue;
      }
      if (len <= need) {
        need -= len;
        cx = prev.x;
        cy = prev.y;
        seg -= 1;
      } else {
        const t = need / len;
        cx += dx * t;
        cy += dy * t;
        cx = wrapTunnel(cx, cy, cols, tunnelRow);
        need = 0;
      }
    }
    out.push({ x: cx, y: cy });
  }
  return out;
}

/**
 * Straight-line wake flight. No maze, no tunnel wrap, no snap. Returns tiles still left.
 */
export function flyStraight(
  member: { x: number; y: number; dir: Dir },
  target: PathPoint,
  dt: number,
  speed: number,
): number {
  const dx = target.x - member.x;
  const dy = target.y - member.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.001) {
    member.x = target.x;
    member.y = target.y;
    return 0;
  }
  const step = Math.min(dist, Math.max(0, speed) * dt);
  member.x += (dx / dist) * step;
  member.y += (dy / dist) * step;
  if (Math.abs(dx) >= Math.abs(dy)) member.dir = { x: dx > 0 ? 1 : -1, y: 0 };
  else member.dir = { x: 0, y: dy > 0 ? 1 : -1 };
  return dist - step;
}

/** Move `member` toward `target`. Short hops glide; long ones snap. Returns tiles still left. */
export function glideToward(
  member: { x: number; y: number; dir: Dir },
  target: PathPoint,
  dt: number,
  cols: number,
  tunnelRow: number,
): number {
  const dx = unwrapDelta(member.x, target.x, member.y, target.y, cols, tunnelRow);
  const dy = target.y - member.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.001) {
    member.x = target.x;
    member.y = target.y;
    return 0;
  }
  if (dist > TRAIN_SNAP) {
    member.x = target.x;
    member.y = target.y;
    if (Math.abs(dx) >= Math.abs(dy)) member.dir = { x: dx > 0 ? 1 : -1, y: 0 };
    else member.dir = { x: 0, y: dy > 0 ? 1 : -1 };
    return 0;
  }
  const step = Math.min(dist, TRAIN_CATCHUP * dt);
  member.x += (dx / dist) * step;
  member.y += (dy / dist) * step;
  member.x = wrapTunnel(member.x, member.y, cols, tunnelRow);
  if (Math.abs(dx) >= Math.abs(dy)) member.dir = { x: dx > 0 ? 1 : -1, y: 0 };
  else member.dir = { x: 0, y: dy > 0 ? 1 : -1 };
  return dist - step;
}

/** Closest main ghost. Ties keep the earlier one, so Blinky wins a dead heat. Mode is ignored. */
function closestMain(x: number, y: number, ghosts: readonly Ghost[], maze: Maze): Ghost | null {
  let best: Ghost | null = null;
  let bestD = Infinity;
  for (const ghost of ghosts) {
    if (!isMainGhost(ghost)) continue;
    const dist = mainGhostDistance(x, y, ghost.x, ghost.y, maze.cols, maze.tunnelRow);
    if (dist < bestD) {
      bestD = dist;
      best = ghost;
    }
  }
  return best;
}

function tunnelX(x: number, y: number, cols: number, tunnelRow: number): number {
  if (Math.round(y) !== tunnelRow) return x;
  let col = x;
  while (col < -0.5) col += cols;
  while (col > cols - 0.5) col -= cols;
  return col;
}

/** Delta from `x0` to `x1`, unwrapped when both points sit on the tunnel row. */
function unwrapDelta(x0: number, x1: number, y0: number, y1: number, cols: number, tunnelRow: number): number {
  let dx = x1 - x0;
  if (Math.round(y0) === tunnelRow && Math.round(y1) === tunnelRow && Math.abs(dx) > cols / 2) {
    dx += dx > 0 ? -cols : cols;
  }
  return dx;
}

function wrapTunnel(x: number, y: number, cols: number, tunnelRow: number): number {
  if (Math.round(y) !== tunnelRow) return x;
  if (x < -0.5) return x + cols;
  if (x > cols - 0.5) return x - cols;
  return x;
}

function trimPath(path: PathPoint[], maxLen: number, cols: number, tunnelRow: number): void {
  let len = 0;
  for (let i = path.length - 1; i > 0; i--) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;
    len += Math.hypot(unwrapDelta(a.x, b.x, a.y, b.y, cols, tunnelRow), b.y - a.y);
    if (len > maxLen) {
      path.splice(0, i);
      return;
    }
  }
}
