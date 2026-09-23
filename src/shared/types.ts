export interface Dir {
  x: -1 | 0 | 1;
  y: -1 | 0 | 1;
}

export interface Vec {
  x: number;
  y: number;
}

export type GhostId = 'blinky' | 'pinky' | 'inky' | 'clyde';

export type Passer = 'pac' | 'ghost' | 'eyes';

export const DIR_LEFT: Dir = { x: -1, y: 0 };
export const DIR_RIGHT: Dir = { x: 1, y: 0 };
export const DIR_UP: Dir = { x: 0, y: -1 };
export const DIR_DOWN: Dir = { x: 0, y: 1 };
export const DIR_NONE: Dir = { x: 0, y: 0 };

export function opposite(dir: Dir): Dir {
  return { x: (-dir.x) as Dir['x'], y: (-dir.y) as Dir['y'] };
}

export function sameDir(a: Dir, b: Dir): boolean {
  return a.x === b.x && a.y === b.y;
}

export function isOpposite(a: Dir, b: Dir): boolean {
  return a.x === -b.x && a.y === -b.y;
}

export function dirFromKey(key: string): Dir | null {
  switch (key.toLowerCase()) {
    case 'arrowleft':
    case 'a':
      return DIR_LEFT;
    case 'arrowright':
    case 'd':
      return DIR_RIGHT;
    case 'arrowup':
    case 'w':
      return DIR_UP;
    case 'arrowdown':
    case 's':
      return DIR_DOWN;
    default:
      return null;
  }
}
