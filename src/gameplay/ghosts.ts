import {
  ELROY2_MULT,
  GHOST_DOOR_SPEED,
  GHOST_EATEN_SPEED,
  GHOST_HOUSE_SPEED,
  INCOMING_GHOST_MULT,
  TUNNEL_GHOST_MULT,
  type BoardSpeeds,
} from '../config';
import type { Rng } from '../shared/rng';
import type { Dir, GhostId, Passer, Vec } from '../shared/types';
import { DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP, opposite } from '../shared/types';
import type { Maze } from './maze';
import { advanceMover, nearCenter, type Mover } from './movement';

export type GhostMode = 'house' | 'leaving' | 'entering' | 'scatter' | 'chase' | 'frightened' | 'eaten';

export interface Ghost extends Mover {
  id: GhostId;
  color: string;
  mode: GhostMode;
  scatter: Vec;
  releaseAt: number;
  reversePending: boolean;
  centerKey: number;
  homeX: number;
  homeY: number;
  stuck: number;
}

export interface GhostWorld {
  dt: number;
  time: number;
  maze: Maze;
  wave: 'chase' | 'scatter';
  frightenedLeft: number;
  incoming: boolean;
  speeds: BoardSpeeds;
  pacX: number;
  pacY: number;
  pacDir: Dir;
  blinkyX: number;
  blinkyY: number;
  rng: Rng;
  /** Blinky's Cruise Elroy stage for the pellets still on this board. */
  elroy: 0 | 1 | 2;
  /**
   * Board Pac pace before any full-clear Speed bonus.
   * Elroy 1 matches this base. Elroy 2 is faster. A Speed Up does not change it.
   */
  pacPace: number;
}

export function createGhosts(): Ghost[] {
  return [
    ghost('blinky', '#ff3b30', 14, 11, DIR_LEFT, { x: 25, y: -3 }, 0, 'chase'),
    ghost('pinky', '#ffb8ff', 13, 14, DIR_UP, { x: 2, y: -3 }, 4, 'house'),
    ghost('inky', '#46f0ff', 11, 14, DIR_UP, { x: 27, y: 33 }, 8, 'house'),
    ghost('clyde', '#ffb852', 15, 14, DIR_DOWN, { x: 0, y: 33 }, 12, 'house'),
  ];
}

function ghost(
  id: GhostId,
  color: string,
  x: number,
  y: number,
  dir: Dir,
  scatter: Vec,
  releaseAt: number,
  mode: GhostMode,
): Ghost {
  return {
    id,
    color,
    x,
    y,
    dir: { ...dir },
    queued: null,
    mode,
    scatter,
    releaseAt,
    reversePending: false,
    centerKey: -1,
    homeX: x,
    homeY: y,
    stuck: 0,
  };
}

export function ghostSpeed(mode: GhostMode, incoming: boolean, speeds: BoardSpeeds): number {
  const boost = incoming ? INCOMING_GHOST_MULT : 1;
  switch (mode) {
    case 'eaten':
      return GHOST_EATEN_SPEED;
    case 'frightened':
      return speeds.fright;
    case 'house':
      return GHOST_HOUSE_SPEED;
    case 'leaving':
    case 'entering':
      return GHOST_DOOR_SPEED;
    default:
      return speeds.ghost * boost;
  }
}

/**
 * Chase/scatter speed for Blinky once Elroy is on.
 * `pacPace` is the board's Pac pace with no clear bonus. Elroy 1 matches that base.
 * Elroy 2 is {@link ELROY2_MULT} times it. Other modes keep the normal ghost speed.
 */
export function elroyMoveSpeed(level: 0 | 1 | 2, pacPace: number, fallback: number): number {
  if (level === 2) return pacPace * ELROY2_MULT;
  if (level === 1) return Math.max(pacPace, fallback);
  return fallback;
}

/** Slows chase, scatter, and frightened ghosts while they are in a side tunnel. Eyes stay fast. */
export function ghostMoveSpeed(
  mode: GhostMode,
  incoming: boolean,
  speeds: BoardSpeeds,
  inTunnel: boolean,
  elroy: 0 | 1 | 2 = 0,
  pacPace = speeds.pac,
): number {
  const base = ghostSpeed(mode, incoming, speeds);
  const cruise = mode === 'chase' || mode === 'scatter' ? elroyMoveSpeed(elroy, pacPace, base) : base;
  if (!inTunnel) return cruise;
  if (mode === 'chase' || mode === 'scatter' || mode === 'frightened') return cruise * TUNNEL_GHOST_MULT;
  return cruise;
}

export function frightenedFlash(left: number, time: number): boolean {
  if (left <= 0 || left > 2) return false;
  return Math.floor(time * 8) % 2 === 0;
}

export function updateGhost(ghostActor: Ghost, world: GhostWorld): void {
  const { dt, time, maze } = world;
  if (ghostActor.mode === 'house') {
    if (time >= ghostActor.releaseAt) {
      ghostActor.mode = 'leaving';
    } else {
      bounceInHouse(ghostActor, dt);
      return;
    }
  }
  if (ghostActor.mode === 'leaving') {
    leaveHouse(ghostActor, world);
    return;
  }
  if (ghostActor.mode === 'entering') {
    enterHouse(ghostActor, world);
    return;
  }
  if (ghostActor.mode === 'eaten' && Math.hypot(ghostActor.x - 14, ghostActor.y - 11) < 0.4) {
    ghostActor.mode = 'entering';
    ghostActor.x = 14;
    ghostActor.y = 11;
    ghostActor.dir = { ...DIR_DOWN };
    return;
  }

  const who: Passer = ghostActor.mode === 'eaten' ? 'eyes' : 'ghost';
  const elroy = ghostActor.id === 'blinky' ? world.elroy : 0;
  const speed = ghostMoveSpeed(
    ghostActor.mode,
    world.incoming,
    world.speeds,
    maze.inSideTunnel(ghostActor.x, ghostActor.y),
    elroy,
    world.pacPace,
  );
  const traveled = advanceMover(
    ghostActor,
    dt,
    speed,
    (x, y) => maze.blocks(x, y, who),
    maze.tunnelRow,
    maze.cols,
    () => steer(ghostActor, world, who),
  );
  if (traveled < 0.01) {
    ghostActor.stuck += dt;
    if (ghostActor.stuck > 0.7) {
      ghostActor.reversePending = true;
      ghostActor.centerKey = -1;
      ghostActor.stuck = 0;
    }
  } else {
    ghostActor.stuck = 0;
  }
}

function bounceInHouse(ghostActor: Ghost, dt: number): void {
  const speed = GHOST_HOUSE_SPEED;
  ghostActor.y += ghostActor.dir.y * speed * dt;
  if (ghostActor.y < 13.2) {
    ghostActor.y = 13.2;
    ghostActor.dir = { x: 0, y: 1 };
  } else if (ghostActor.y > 14.8) {
    ghostActor.y = 14.8;
    ghostActor.dir = { x: 0, y: -1 };
  }
}

function leaveHouse(ghostActor: Ghost, world: GhostWorld): void {
  const speed = GHOST_DOOR_SPEED * world.dt;
  const doorX = ghostActor.x >= 14 ? 14 : 13;
  if (ghostActor.y > 12.05) {
    if (Math.abs(ghostActor.x - doorX) > 0.04) {
      const sign = doorX > ghostActor.x ? 1 : -1;
      ghostActor.x += sign * speed;
      if ((sign > 0 && ghostActor.x > doorX) || (sign < 0 && ghostActor.x < doorX)) ghostActor.x = doorX;
      ghostActor.dir = { x: sign as Dir['x'], y: 0 };
      return;
    }
    ghostActor.x = doorX;
  }
  ghostActor.x = doorX;
  ghostActor.y -= speed;
  ghostActor.dir = { ...DIR_UP };
  if (ghostActor.y <= 11) {
    ghostActor.y = 11;
    ghostActor.mode = world.frightenedLeft > 0 ? 'frightened' : world.wave;
    ghostActor.dir = { ...DIR_LEFT };
    ghostActor.centerKey = -1;
    ghostActor.reversePending = false;
  }
}

function enterHouse(ghostActor: Ghost, world: GhostWorld): void {
  const speed = GHOST_DOOR_SPEED * world.dt;
  ghostActor.x = 14;
  ghostActor.y += speed;
  ghostActor.dir = { ...DIR_DOWN };
  if (ghostActor.y >= 14) {
    ghostActor.y = 14;
    ghostActor.mode = 'house';
    ghostActor.dir = { ...DIR_UP };
    ghostActor.releaseAt = world.time + 1.4;
    ghostActor.centerKey = -1;
  }
}

function steer(ghostActor: Ghost, world: GhostWorld, who: Passer): void {
  if (!nearCenter(ghostActor)) return;
  const tx = Math.round(ghostActor.x);
  const ty = Math.round(ghostActor.y);
  const key = ty * world.maze.cols + tx;
  if (ghostActor.centerKey === key && !ghostActor.reversePending) return;

  const blocked = (d: Dir) => world.maze.blocks(tx + d.x, ty + d.y, who);
  if (ghostActor.reversePending) {
    const rev = opposite(ghostActor.dir);
    ghostActor.reversePending = false;
    if ((rev.x !== 0 || rev.y !== 0) && !blocked(rev)) {
      ghostActor.dir = rev;
      ghostActor.centerKey = key;
      ghostActor.x = tx;
      ghostActor.y = ty;
      return;
    }
  }

  const options = [DIR_LEFT, DIR_RIGHT, DIR_UP, DIR_DOWN].filter((dir) => {
    if (dir.x === -ghostActor.dir.x && dir.y === -ghostActor.dir.y && (ghostActor.dir.x !== 0 || ghostActor.dir.y !== 0)) {
      return false;
    }
    return !blocked(dir);
  });
  const fallback = options.length > 0 ? options : [DIR_LEFT, DIR_RIGHT, DIR_UP, DIR_DOWN].filter((dir) => !blocked(dir));
  if (fallback.length === 0) {
    ghostActor.centerKey = key;
    return;
  }

  let next = fallback[0] ?? DIR_LEFT;
  if (ghostActor.mode === 'frightened') {
    next = fallback[Math.floor(world.rng() * fallback.length)] ?? next;
  } else {
    const target = chaseTarget(ghostActor, world);
    let best = Infinity;
    for (const dir of fallback) {
      const nx = tx + dir.x;
      const ny = ty + dir.y;
      const score = (nx - target.x) ** 2 + (ny - target.y) ** 2;
      if (score < best) {
        best = score;
        next = dir;
      }
    }
  }
  ghostActor.dir = { ...next };
  ghostActor.centerKey = key;
  ghostActor.x = tx;
  ghostActor.y = ty;
}

function chaseTarget(ghostActor: Ghost, world: GhostWorld): Vec {
  if (ghostActor.mode === 'eaten') return { x: 14, y: 11 };
  if (ghostActor.id === 'blinky' && world.elroy > 0) {
    return { x: Math.round(world.pacX), y: Math.round(world.pacY) };
  }
  if (ghostActor.mode === 'scatter' || world.wave === 'scatter') return ghostActor.scatter;
  const px = Math.round(world.pacX);
  const py = Math.round(world.pacY);
  switch (ghostActor.id) {
    case 'blinky':
      return { x: px, y: py };
    case 'pinky':
      return { x: px + world.pacDir.x * 4, y: py + world.pacDir.y * 4 };
    case 'inky': {
      const ax = px + world.pacDir.x * 2;
      const ay = py + world.pacDir.y * 2;
      return { x: ax + (ax - world.blinkyX), y: ay + (ay - world.blinkyY) };
    }
    case 'clyde': {
      const dist = Math.hypot(ghostActor.x - px, ghostActor.y - py);
      return dist > 8 ? { x: px, y: py } : ghostActor.scatter;
    }
    default:
      return { x: px, y: py };
  }
}
