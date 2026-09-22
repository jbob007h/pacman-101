import type { Dir } from '../shared/types';
import { isOpposite, sameDir } from '../shared/types';

export interface Mover {
  x: number;
  y: number;
  dir: Dir;
  queued: Dir | null;
}

const CENTER = 0.2;
const STEP = 0.08;

export function nearCenter(mover: Mover): boolean {
  return Math.abs(mover.x - Math.round(mover.x)) <= CENTER && Math.abs(mover.y - Math.round(mover.y)) <= CENTER;
}

/**
 * Grid movement in tile units (integer = tile center).
 * Reversals are instant. Other turns commit near a tile center.
 * `onCenter` is polled while the mover is on a center so ghosts can steer.
 * Returns tiles actually traveled.
 */
export function advanceMover(
  mover: Mover,
  dt: number,
  speed: number,
  blocked: (x: number, y: number) => boolean,
  tunnelRow: number,
  cols: number,
  onCenter?: () => void,
): number {
  let budget = Math.max(0, speed * dt);
  let traveled = 0;
  let guard = 0;
  while (budget > 1e-4 && guard++ < 80) {
    onCenter?.();
    const dir = mover.dir;
    if (dir.x === 0 && dir.y === 0) break;
    alignLane(mover);

    const cx = Math.round(mover.x);
    const cy = Math.round(mover.y);
    const aheadBlocked = blocked(cx + dir.x, cy + dir.y);
    const along = dir.x !== 0 ? (mover.x - cx) * dir.x : (mover.y - cy) * dir.y;
    if (aheadBlocked && along >= -0.02) {
      mover.x = cx;
      mover.y = cy;
      break;
    }

    const step = Math.min(STEP, budget);
    const nx = mover.x + dir.x * step;
    const ny = mover.y + dir.y * step;
    if (aheadBlocked) {
      const alongNext = dir.x !== 0 ? (nx - cx) * dir.x : (ny - cy) * dir.y;
      if (alongNext > 0) {
        mover.x = cx;
        mover.y = cy;
        break;
      }
    }

    mover.x = nx;
    mover.y = ny;
    if (Math.round(mover.y) === tunnelRow || cy === tunnelRow) {
      if (mover.x < -0.5) mover.x += cols;
      else if (mover.x > cols - 0.5) mover.x -= cols;
    }
    budget -= step;
    traveled += step;
  }
  return traveled;
}

/** Apply a buffered turn. Safe to call every substep. */
export function applyQueuedTurn(mover: Mover, blocked: (x: number, y: number) => boolean): void {
  const queued = mover.queued;
  if (!queued) return;
  if (sameDir(queued, mover.dir)) return;
  if (isOpposite(queued, mover.dir) && (queued.x !== 0 || queued.y !== 0)) {
    mover.dir = { x: queued.x, y: queued.y };
    return;
  }
  if (!nearCenter(mover)) return;
  const cx = Math.round(mover.x);
  const cy = Math.round(mover.y);
  if (!blocked(cx + queued.x, cy + queued.y)) {
    mover.x = cx;
    mover.y = cy;
    mover.dir = { x: queued.x, y: queued.y };
  }
}

function alignLane(mover: Mover): void {
  if (mover.dir.x !== 0 && Math.abs(mover.y - Math.round(mover.y)) < 0.12) {
    mover.y = Math.round(mover.y);
  }
  if (mover.dir.y !== 0 && Math.abs(mover.x - Math.round(mover.x)) < 0.12) {
    mover.x = Math.round(mover.x);
  }
}
