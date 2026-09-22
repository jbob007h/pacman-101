/** Shared tunables. Gameplay and systems both read this leaf module. */

export const MAZE_COLS = 28;
export const MAZE_ROWS = 31;
export const TUNNEL_ROW = 14;
export const TILE = 16;

export const PAC_START = { x: 14, y: 23 };

export const SIDE_BOARD_COUNT = 50;
export const SIDE_COLS = 5;
export const SIDE_ROWS = 10;
export const PANEL_W = 52;
export const PANEL_H = 46;
export const PANEL_GAP = 4;
export const GUTTER = 14;

export const SIDE_W = SIDE_COLS * PANEL_W + (SIDE_COLS - 1) * PANEL_GAP;
export const BOARD_W = MAZE_COLS * TILE;
export const BOARD_H = MAZE_ROWS * TILE;
export const BOARD_X = SIDE_W + GUTTER;
export const BOARD_Y = 0;
export const VIEW_W = SIDE_W + GUTTER + BOARD_W + GUTTER + SIDE_W;
export const VIEW_H = BOARD_H;

export const GHOST_EATEN_SPEED = 12;
export const GHOST_HOUSE_SPEED = 3.2;
export const GHOST_DOOR_SPEED = 5.2;
export const FRIGHT_SECONDS = 9;
/** Classic-style freeze after eating a frightened ghost, in seconds. */
export const EAT_GHOST_PAUSE = 0.5;

/**
 * Tile directly under the ghost house. Fruit appears here once half the pellets are gone.
 * House interior is rows 13–15, columns 11–16; the open corridor below the house is row 17.
 */
export const FRUIT_TILE = { x: 14, y: 17 };
export const FRUIT_SCORE = 100;

/**
 * Tiles per second added to Pac for each full pellet clear this match.
 * The on-screen Speed number does not include this bonus.
 */
export const CLEAR_SPEED_BONUS = 0.35;

/** Chase, scatter, and frightened ghosts use this fraction of their speed in the side tunnels. */
export const TUNNEL_GHOST_MULT = 0.55;

/**
 * Tiles per second. Board 1 is the slow, readable pace.
 * Eating the fruit advances one row. Past the last row the pace stays capped.
 * Frightened speed stays under half of that board's chase speed.
 */
const BOARD_PACE: readonly { pac: number; ghost: number; fright: number }[] = [
  { pac: 6.4, ghost: 4.5, fright: 2.05 },
  { pac: 7.15, ghost: 5.35, fright: 2.35 },
  { pac: 7.9, ghost: 6.25, fright: 2.7 },
  { pac: 8.65, ghost: 7.15, fright: 3.05 },
  { pac: 9.35, ghost: 8.05, fright: 3.4 },
  { pac: 10.0, ghost: 8.9, fright: 3.75 },
];

export interface BoardSpeeds {
  /** 1-based board number. */
  board: number;
  pac: number;
  ghost: number;
  fright: number;
}

export function speedsForBoard(boardIndex: number): BoardSpeeds {
  const index = Math.max(0, Math.min(Math.floor(boardIndex), BOARD_PACE.length - 1));
  const row = BOARD_PACE[index] ?? BOARD_PACE[0];
  return {
    board: index + 1,
    pac: row?.pac ?? 6.4,
    ghost: row?.ghost ?? 4.5,
    fright: row?.fright ?? 2.05,
  };
}
export const INCOMING_GHOST_MULT = 1.28;

export const SIM_COUNT = 100;
export const KILL_PRESSURE = 100;
export const GHOST_PRESSURE_BASE = 48;
export const GHOST_PRESSURE_STEP = 22;
export const DOT_MILESTONE = 50;
export const DOT_PRESSURE = 22;
export const CLEAR_PRESSURE = 42;
export const CLEAR_TARGETS = 8;
export const SIM_ATTACK_INTERVAL = 0.5;
export const SIM_ATTACKS_PER_TICK = 2;
export const SIM_PRESSURE = 18;
export const SIM_INCOMING_CHANCE = 0.1;
export const PRESSURE_RECOVERY = 2;
export const PRESSURE_LOCK = 1.6;
export const FOCUS_BIAS = 0.8;

export const DOT_SCORE = 10;
export const PELLET_SCORE = 50;
export const GHOST_SCORE_BASE = 200;

export const COLLIDE_DISTANCE = 0.56;
