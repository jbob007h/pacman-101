import { MAZE_COLS, MAZE_ROWS, TUNNEL_ROW } from '../config';
import type { Passer } from '../shared/types';

export const Tile = {
  Wall: 0,
  Empty: 1,
  Dot: 2,
  Pellet: 3,
  Door: 4,
} as const;

export type TileId = (typeof Tile)[keyof typeof Tile];

/**
 * Classic-proportion 28×31 maze.
 * `#` wall, `.` dot, `o` power pellet, `-` ghost door, space empty.
 * Row 14 is the wrap tunnel. The ghost house interior is forced empty.
 */
const RAW_ROWS: readonly string[] = [
  '############################',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#o####.#####.##.#####.####o#',
  '#.####.#####.##.#####.####.#',
  '#..........................#',
  '#.####.##.########.##.####.#',
  '#.####.##.########.##.####.#',
  '#......##....##....##......#',
  '######.#####.##.#####.######',
  '######.#####.##.#####.######',
  '######.##..........##.######',
  '######.##.###--###.##.######',
  '######.##.#      #.##.######',
  '..........#      #..........',
  '######.##.#      #.##.######',
  '######.##.########.##.######',
  '######.##..........##.######',
  '######.#####.##.#####.######',
  '######.#####.##.#####.######',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#.####.#####.##.#####.####.#',
  '#o..##................##..o#',
  '###.##.##.########.##.##.###',
  '###.##.##.########.##.##.###',
  '#......##....##....##......#',
  '#.##########.##.##########.#',
  '#.##########.##.##########.#',
  '#..........................#',
  '############################',
];

const CHAR_TO_TILE: Record<string, TileId> = {
  '#': Tile.Wall,
  ' ': Tile.Empty,
  '.': Tile.Dot,
  o: Tile.Pellet,
  '-': Tile.Door,
};

export class Maze {
  readonly cols = MAZE_COLS;
  readonly rows = MAZE_ROWS;
  readonly tunnelRow = TUNNEL_ROW;
  private readonly initial: Uint8Array;
  private readonly cells: Uint8Array;
  private left = 0;

  constructor(rows: readonly string[] = RAW_ROWS) {
    if (rows.length !== MAZE_ROWS) {
      throw new Error(`Maze must have ${MAZE_ROWS} rows, got ${rows.length}`);
    }
    this.initial = new Uint8Array(MAZE_COLS * MAZE_ROWS);
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y] ?? '';
      if (row.length !== MAZE_COLS) {
        throw new Error(`Maze row ${y} must be ${MAZE_COLS} wide, got ${row.length}`);
      }
      for (let x = 0; x < MAZE_COLS; x++) {
        const tile = CHAR_TO_TILE[row[x] ?? ''];
        if (tile === undefined) {
          throw new Error(`Unknown tile '${row[x]}' at ${x},${y}`);
        }
        this.initial[y * MAZE_COLS + x] = tile;
      }
    }
    this.openGhostHouse(this.initial);
    this.cells = new Uint8Array(this.initial);
    this.left = this.countConsumables(this.cells);
    const issues = collectMazeIssues(this);
    if (issues.length > 0) {
      throw new Error(`Maze is not playable:\n${issues.join('\n')}`);
    }
  }

  tile(x: number, y: number): TileId {
    if (y < 0 || y >= this.rows || x < 0 || x >= this.cols) return Tile.Wall;
    return this.cells[y * this.cols + x] as TileId;
  }

  blocks(x: number, y: number, who: Passer): boolean {
    if (y < 0 || y >= this.rows) return true;
    let xx = x;
    if (xx < 0 || xx >= this.cols) {
      if (y !== this.tunnelRow) return true;
      xx = ((xx % this.cols) + this.cols) % this.cols;
    }
    const tile = this.cells[y * this.cols + xx] as TileId;
    if (tile === Tile.Wall) return true;
    if (tile === Tile.Door) return who !== 'eyes';
    return false;
  }

  consume(x: number, y: number): 'dot' | 'pellet' | null {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return null;
    const index = y * this.cols + x;
    const tile = this.cells[index] as TileId;
    if (tile === Tile.Dot) {
      this.cells[index] = Tile.Empty;
      this.left -= 1;
      return 'dot';
    }
    if (tile === Tile.Pellet) {
      this.cells[index] = Tile.Empty;
      this.left -= 1;
      return 'pellet';
    }
    return null;
  }

  remaining(): number {
    return this.left;
  }

  pelletCount(): number {
    return this.countKind(this.cells, Tile.Pellet);
  }

  dotCount(): number {
    return this.countKind(this.cells, Tile.Dot);
  }

  resetDots(): void {
    this.cells.set(this.initial);
    this.left = this.countConsumables(this.cells);
  }

  private openGhostHouse(cells: Uint8Array): void {
    for (let y = 13; y <= 15; y++) {
      for (let x = 11; x <= 16; x++) {
        const index = y * MAZE_COLS + x;
        const tile = cells[index];
        if (tile === Tile.Dot || tile === Tile.Empty) cells[index] = Tile.Empty;
      }
    }
  }

  private countConsumables(cells: Uint8Array): number {
    let n = 0;
    for (const tile of cells) {
      if (tile === Tile.Dot || tile === Tile.Pellet) n += 1;
    }
    return n;
  }

  private countKind(cells: Uint8Array, kind: TileId): number {
    let n = 0;
    for (const tile of cells) if (tile === kind) n += 1;
    return n;
  }
}

export function collectMazeIssues(maze: Maze): string[] {
  const issues: string[] = [];
  if (maze.pelletCount() !== 4) issues.push(`expected 4 power pellets, found ${maze.pelletCount()}`);
  for (const [x, y] of [
    [13, 12],
    [14, 12],
  ] as const) {
    if (maze.tile(x, y) !== Tile.Door) issues.push(`missing ghost door at ${x},${y}`);
  }
  for (let y = 13; y <= 15; y++) {
    for (let x = 11; x <= 16; x++) {
      if (maze.tile(x, y) !== Tile.Empty) issues.push(`ghost house blocked at ${x},${y}`);
    }
  }
  if (maze.blocks(0, maze.tunnelRow, 'pac') || maze.blocks(maze.cols - 1, maze.tunnelRow, 'pac')) {
    issues.push('tunnel mouths are walled in');
  }
  if (maze.blocks(-1, maze.tunnelRow, 'pac')) issues.push('tunnel does not wrap');
  if (!maze.blocks(-1, maze.tunnelRow - 1, 'pac')) issues.push('wrap leaked off the tunnel row');

  const start = { x: 14, y: 23 };
  if (maze.blocks(start.x, start.y, 'pac')) issues.push('pac start is blocked');
  const reachable = flood(maze, start.x, start.y, 'pac');
  for (let y = 0; y < maze.rows; y++) {
    for (let x = 0; x < maze.cols; x++) {
      const tile = maze.tile(x, y);
      if ((tile === Tile.Dot || tile === Tile.Pellet) && !reachable.has(key(x, y))) {
        issues.push(`unreachable consumable at ${x},${y}`);
      }
    }
  }
  const ghostReach = flood(maze, 14, 11, 'ghost');
  if (!ghostReach.has(key(start.x, start.y))) issues.push('ghosts cannot reach pac start');
  return issues;
}

function key(x: number, y: number): number {
  return y * MAZE_COLS + x;
}

function flood(maze: Maze, sx: number, sy: number, who: Passer): Set<number> {
  const seen = new Set<number>();
  const stack = [key(sx, sy)];
  seen.add(key(sx, sy));
  while (stack.length > 0) {
    const current = stack.pop() ?? 0;
    const x = current % MAZE_COLS;
    const y = (current - x) / MAZE_COLS;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      let nx = x + dx;
      const ny = y + dy;
      if (ny === maze.tunnelRow && (nx < 0 || nx >= maze.cols)) {
        nx = ((nx % maze.cols) + maze.cols) % maze.cols;
      }
      const id = key(nx, ny);
      if (seen.has(id)) continue;
      if (maze.blocks(nx, ny, who)) continue;
      seen.add(id);
      stack.push(id);
    }
  }
  return seen;
}
