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

export const PAC_SPEED = 8.5;
export const GHOST_CHASE_SPEED = 6.45;
export const GHOST_FRIGHT_SPEED = 4.3;
export const GHOST_EATEN_SPEED = 13;
export const GHOST_HOUSE_SPEED = 3.2;
export const GHOST_DOOR_SPEED = 6;
export const FRIGHT_SECONDS = 9;
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
