/** Shared tunables. Gameplay and systems both read this leaf module. */

import type { Dir } from './shared/types';

export const MAZE_COLS = 28;
export const MAZE_ROWS = 31;
export const TUNNEL_ROW = 14;
export const TILE = 16;

/**
 * Opening pose in the bottom start corridor.
 * x 13.5 is the boundary between columns 13 and 14: the horizontal center of
 * that corridor (and of the 28-column maze). y 23 is the corridor's row.
 */
export const PAC_START = { x: 13.5, y: 23 };

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

export const GHOST_EATEN_SPEED = 16.2;
/** Bobbing inside the house while waiting to leave. */
export const GHOST_HOUSE_SPEED = 4.32;
/**
 * Walking out of the house, across the door, and onto the maze.
 * Slower than every board's chase speed (the slowest chase is 5.47) so the
 * exit is deliberate. Eyes still come home at {@link GHOST_DOOR_SPEED}.
 */
export const GHOST_LEAVE_SPEED = 3.24;
/** Eyes dropping back into the house. Not used for the exit. */
export const GHOST_DOOR_SPEED = 7.02;
/**
 * Fallback denominator for {@link pelletFill} when a caller does not pass the pellet's own duration.
 * Live pellets use {@link frightSecondsForBoard}, not this constant.
 */
export const FRIGHT_SECONDS = 9;

/**
 * Power-pellet fright time in seconds, by 1-based board number
 * (the same numbering as `speedsForBoard(index).board` on boards 1–6).
 * Boards past the pace table are not clamped. From board 19 on, only every
 * 4th board starting at 22 (22, 26, 30, …) lasts 2 seconds; the rest last 0.
 * A 0 second pellet does not turn ghosts blue.
 * How fast a frightened ghost walks is {@link FRIGHT_GHOST_SPEED}, not this duration.
 */
const FRIGHT_DURATION_BY_BOARD: readonly number[] = [
  6, 5, 4, 3, 2, 5, 3, 2, 1, 5, 2, 1.5, 1, 3, 1, 1, 0, 2,
];

/** Fright seconds for a 1-based board number. Does not follow the 6-row pace cap. */
export function frightSecondsForBoard(board: number): number {
  const n = Math.floor(board);
  if (!Number.isFinite(n) || n < 1) return FRIGHT_DURATION_BY_BOARD[0] ?? 6;
  if (n <= FRIGHT_DURATION_BY_BOARD.length) return FRIGHT_DURATION_BY_BOARD[n - 1] ?? 0;
  return n >= 22 && (n - 22) % 4 === 0 ? 2 : 0;
}

/**
 * Scales a pellet's duration by match time. 1 before 90s, then −0.1 every 30s, floored at 0.1.
 * Applied to every mode except Stronger, which stays a flat 4 seconds. A 0s board stays 0.
 */
export function frightTimeModifier(matchElapsedSeconds: number): number {
  if (matchElapsedSeconds < 90) return 1;
  const steps = 1 + Math.floor((matchElapsedSeconds - 90) / 30);
  return Math.max(0.1, 1 - 0.1 * steps);
}
/** Classic-style freeze after eating a frightened ghost, in seconds. The first eat in a chain. */
export const EAT_GHOST_PAUSE = 0.5;
/**
 * Each ghost eat in a chain multiplies the pause by this. Chain index n (1-based) pauses for
 * `max(EAT_PAUSE_FLOOR, EAT_GHOST_PAUSE * EAT_PAUSE_DECAY ^ (n - 1))`.
 */
export const EAT_PAUSE_DECAY = 0.55;
/** Shortest post-eat freeze, so a long train still registers each bite. */
export const EAT_PAUSE_FLOOR = 0.08;
/**
 * Active seconds without eating a ghost before the pause chain resets.
 * Time spent inside the eat pause itself does not count.
 */
export const EAT_CHAIN_RESET = 0.75;
/** Eating a ghost with strictly less than this much pellet time left adds {@link PELLET_EXTEND_SECONDS}. */
export const PELLET_EXTEND_THRESHOLD = 1.5;
export const PELLET_EXTEND_SECONDS = 1.5;

/** Pause after the n-th ghost eat in the current chain. n starts at 1. */
export function eatPauseForChain(chain: number): number {
  const n = Math.max(1, chain);
  const scaled = EAT_GHOST_PAUSE * EAT_PAUSE_DECAY ** (n - 1);
  return Math.max(EAT_PAUSE_FLOOR, scaled);
}

/**
 * 1 when a pellet was just eaten, 0 when frightened time is gone.
 * The denominator is that pellet's duration, so the ring drains at 1/duration per second.
 * Extra time from an extension refills the ring in proportion and clamps at full.
 */
export function pelletFill(remaining: number, duration = FRIGHT_SECONDS): number {
  if (remaining <= 0 || duration <= 0) return 0;
  return Math.min(1, remaining / duration);
}

/** Logic rate. Drawing may follow the display; simulation steps are this long. */
export const SIM_FPS = 60;
export const SIM_FRAME_SEC = 1 / SIM_FPS;
/** Catch-up cap so a stalled tab cannot run the maze in a burst. */
export const MAX_SIM_STEPS = 5;
/** Frames Pac stands still after eating a normal dot. Counted in simulation steps. */
export const DOT_STOP_FRAMES = 1;
/** Frames Pac stands still after eating a power pellet. */
export const POWER_STOP_FRAMES = 3;

/**
 * Opening beats, in order. Each one lasts {@link COUNTDOWN_BEAT_FRAMES}
 * simulation frames, which is one second when the loop steps at 60Hz.
 * The last beat releases Pac; the earlier beats hold him still.
 */
export const COUNTDOWN_BEATS = ['Ready…', '3…', '2…', '1…', 'Hit it!'] as const;
export const COUNTDOWN_BEAT_FRAMES = SIM_FPS;
/** Spawn facing. A still Pac is drawn facing left, and this is the way he leaves the start tile. */
export const PAC_LAUNCH_DIR: Dir = { x: -1, y: 0 };

/**
 * Bonus spot in the corridor under the ghost house. Fruit appears here once half the pellets are gone.
 * House interior is rows 13–15, columns 11–16; the open corridor below the house is row 17.
 * x 13.5 is the boundary between columns 13 and 14, the same horizontal center as {@link PAC_START}.
 */
export const FRUIT_TILE = { x: 13.5, y: 17 };
/** Drawn cherry is this many times the original sprite. */
export const FRUIT_DRAW_SCALE = 2;
export const FRUIT_SCORE = 100;

/**
 * Tiles per second added to Pac for each full pellet clear this match.
 * The Speed readout also goes up by 1 on that same clear. 0.75 is Pac only
 * (was 1.125, two thirds of that step). Ghost chase, fright, and Elroy do
 * not add this. Elroy uses the board Pac pace below, before this bonus.
 * Even-board fruit still adds a readout point without adding this bonus.
 * Speed mode adds the same step once per temporary level.
 */
export const CLEAR_SPEED_BONUS = 0.75;
/** How long the "Speed Up!" callout stays on Pac after a full clear. */
export const SPEED_POPUP_SECONDS = 1.35;

/** Chase, scatter, and frightened ghosts use this fraction of their speed in the side tunnels. */
export const TUNNEL_GHOST_MULT = 0.55;

/**
 * Frightened ghosts walk at this speed for the whole match, on every board.
 * Fruit, a later board, the clear bonus, the scatter bump, Elroy, and the
 * incoming-ghost multiplier do not raise it. The side-tunnel multiplier still
 * slows them. This is the new board-1 value; it is under half of board 1's
 * chase speed (5.47).
 */
export const FRIGHT_GHOST_SPEED = 2.49;

/**
 * Tiles per second. Board 1 is about 10% under the two-thirds opening row
 * (8.64 / 6.075 → 7.78 / 5.47). Every later row is that same absolute drop
 * (pac −0.86, ghost −0.605) off the two-thirds table, so those steps stay two thirds
 * of the previous ramp. Eating the fruit advances one row. Past the last row
 * the pace stays capped. The `fright` column is {@link FRIGHT_GHOST_SPEED}
 * on every row. These columns do not include {@link CLEAR_SPEED_BONUS} or
 * {@link GHOST_SCATTER_BUMP}. Elroy is a multiple of the `pac` column, not of
 * Pac's accumulated clears. Inbound jammers scale off Pac's unslowed pace,
 * so they slow with this table.
 */
const BOARD_PACE: readonly { pac: number; ghost: number; fright: number }[] = [
  { pac: 7.78, ghost: 5.47, fright: FRIGHT_GHOST_SPEED },
  { pac: 8.23, ghost: 5.98, fright: FRIGHT_GHOST_SPEED },
  { pac: 8.68, ghost: 6.52, fright: FRIGHT_GHOST_SPEED },
  { pac: 9.13, ghost: 7.06, fright: FRIGHT_GHOST_SPEED },
  { pac: 9.55, ghost: 7.6, fright: FRIGHT_GHOST_SPEED },
  { pac: 9.94, ghost: 8.11, fright: FRIGHT_GHOST_SPEED },
];

export interface BoardSpeeds {
  /** 1-based board number. */
  board: number;
  pac: number;
  ghost: number;
  fright: number;
}

/**
 * Pellets still on the board (dots and power pellets) when Blinky becomes Cruise Elroy.
 * Counts drop as the board is eaten and reset when the fruit refills the maze.
 * Later boards trip sooner. Board 5 and after stay at 60 / 20.
 *
 * | Board | Elroy 1 | Elroy 2 |
 * | --- | --- | --- |
 * | 1 | 20 | 10 |
 * | 2 | 30 | 15 |
 * | 3 | 40 | 20 |
 * | 4 | 50 | 20 |
 * | 5+ | 60 | 20 |
 */
const ELROY_TABLE: readonly { elroy1: number; elroy2: number }[] = [
  { elroy1: 20, elroy2: 10 },
  { elroy1: 30, elroy2: 15 },
  { elroy1: 40, elroy2: 20 },
  { elroy1: 50, elroy2: 20 },
  { elroy1: 60, elroy2: 20 },
];

export function elroyThresholds(boardIndex: number): { elroy1: number; elroy2: number } {
  const index = Math.max(0, Math.min(Math.floor(boardIndex), ELROY_TABLE.length - 1));
  return ELROY_TABLE[index] ?? { elroy1: 20, elroy2: 10 };
}

/** 0 off, 1 when pellets are at or under the first threshold, 2 under the second. */
export function elroyLevel(boardIndex: number, pelletsRemaining: number): 0 | 1 | 2 {
  const { elroy1, elroy2 } = elroyThresholds(boardIndex);
  if (pelletsRemaining <= elroy2) return 2;
  if (pelletsRemaining <= elroy1) return 1;
  return 0;
}

export function speedsForBoard(boardIndex: number): BoardSpeeds {
  const index = Math.max(0, Math.min(Math.floor(boardIndex), BOARD_PACE.length - 1));
  const row = BOARD_PACE[index] ?? BOARD_PACE[0];
  return {
    board: index + 1,
    pac: row?.pac ?? 7.78,
    ghost: row?.ghost ?? 5.47,
    fright: FRIGHT_GHOST_SPEED,
  };
}
export const INCOMING_GHOST_MULT = 1.28;

/**
 * Tiles per second added to chase and scatter, permanently, each time the
 * wave schedule enters scatter after the opening wave. The match-start scatter does not.
 * Two thirds of the previous bump (0.765 → 0.51).
 * Fright, eyes, and the house do not take this. Elroy still uses Pac's pace.
 */
export const GHOST_SCATTER_BUMP = 0.51;

/** Match seconds before inbound jammers may chase. Until then they sit and still touch. */
export const JAMMER_CHASE_GATE = 60;

export const SIM_COUNT = 100;
export const KILL_PRESSURE = 100;
/**
 * Older per-bite ghost pressure. Live ghost attacks no longer use these.
 * A frightened-ghost chain batches for {@link GHOST_ATTACK_WINDOW} and sends
 * one jammer per ghost eaten in that window.
 */
export const GHOST_PRESSURE_BASE = 48;
export const GHOST_PRESSURE_STEP = 22;
/** Sim seconds that collect ghost eats into one attack. The next eat opens a new window. */
export const GHOST_ATTACK_WINDOW = 2;
/** Kept for older notes. Dot milestones and board clears do not send attacks. */
export const DOT_MILESTONE = 50;
export const DOT_PRESSURE = 22;
export const CLEAR_PRESSURE = 42;
export const CLEAR_TARGETS = 8;
/**
 * Each living CPU attacks on its own clock. The first shot is the
 * {@link SIM_ATTACK_MIN}–{@link SIM_ATTACK_MAX} roll shifted out of
 * {@link SIM_ATTACK_GRACE}, and each later shot rolls that range again.
 * There is no shared ticker and no multi-shot burst.
 * One shot rolls {@link SIM_JAMMER_MIN}–{@link SIM_JAMMER_MAX} jammers, then
 * {@link cpuCancelPercent} may cancel it or scale that roll down. The target
 * is one living seat (every other living sim, plus the human) with equal odds.
 * A hit on the human spawns that many inbound sprites. A hit on a sim adds
 * that much pressure.
 * Player attacks are still ghost eats only, batched for {@link GHOST_ATTACK_WINDOW}.
 * Dots and clears never attack.
 * Passive recovery is {@link PRESSURE_RECOVERY} per second after {@link PRESSURE_LOCK}.
 * Every {@link SIM_RELIEF_INTERVAL}, {@link SIM_RELIEFS_PER_TICK} living sims
 * shed pressure: usually a pellet ({@link SIM_PELLET_RELIEF}), sometimes a
 * board clear ({@link SIM_CLEAR_RELIEF} when the roll is under
 * {@link SIM_CLEAR_RELIEF_CHANCE}).
 */
export const SIM_ATTACK_MIN = 5;
export const SIM_ATTACK_MAX = 15;
export const SIM_JAMMER_MIN = 1;
export const SIM_JAMMER_MAX = 16;
/**
 * CPU/bot cancel chance at match time 0. Drops by {@link CPU_CANCEL_DROP} every
 * {@link CPU_CANCEL_STEP} seconds of match time until it hits 0.
 */
export const CPU_CANCEL_START = 50;
export const CPU_CANCEL_STEP = 3;
export const CPU_CANCEL_DROP = 1;
/**
 * Occasional CPU "mistake" deaths, before the cancel ramp reaches full pressure.
 * The ramp ({@link CPU_CANCEL_START} / {@link CPU_CANCEL_STEP}) hits 0 at 150s.
 * No mistakes during the 15s grace, and none at or after {@link CPU_MISTAKE_END}.
 * {@link CPU_MISTAKE_EXPECTED} is the field total if all {@link SIM_COUNT} CPUs
 * stay alive for the whole window. The per-CPU hazard is that total divided by
 * `SIM_COUNT * (END - START)` per second (~9.5 deaths after survival depletion,
 * inside the 8–12 band).
 */
export const CPU_MISTAKE_START = 15;
export const CPU_MISTAKE_END = 150;
export const CPU_MISTAKE_EXPECTED = 10;
/**
 * No CPU or bot attack lands before this many seconds. The opening 5–15s roll
 * is shifted so its earliest land is this grace. Later shots stay on 5–15s.
 * Local sims and server bots share that opening roll. It is not a clock that
 * starts when the grace ends.
 */
export const SIM_ATTACK_GRACE = 10;
export const SIM_RELIEF_INTERVAL = 2.5;
export const SIM_RELIEFS_PER_TICK = 4;
export const SIM_PELLET_RELIEF = 34;
export const SIM_CLEAR_RELIEF = 68;
export const SIM_CLEAR_RELIEF_CHANCE = 0.2;

/** Most inbound sprites that can sit on the maze at once, including ones still fading in or dying. */
export const JAMMER_CAP = 16;
/**
 * Seconds a jammer spends pulsing in. It cannot touch Pac during this window.
 * Longer than the old 0.7s fade so there is time to react.
 */
export const JAMMER_SPAWN_SECONDS = 1.6;
/** Elroy 2 tiles/sec as a multiple of the board Pac pace, before clear bonuses. Elroy 1 matches that pace. */
export const ELROY2_MULT = 1.1;
export const JAMMER_DEATH_SECONDS = 0.38;
/**
 * Center distance that counts as a hit. Matches the drawn bodies:
 * Pac radius 7.1px plus jammer radius 6.4px is 0.84 tiles. The old 0.48
 * check let those circles overlap without a collision.
 */
export const JAMMER_HIT_DISTANCE = 0.86;
/** White chasers, as a fraction of Pac's unslowed speed. Faster than reds. */
export const WHITE_CHASE_MULT = 0.86;
/** Red chasers, as a fraction of Pac's unslowed speed. Slower than whites. */
export const RED_CHASE_MULT = 0.42;

/**
 * How many inbound jammers one attack tries to spawn, before the board cap.
 * Strength 8 → 1, 12 → 2, 24 → 3, and anything past 64 stays at 8.
 * Overflow past {@link JAMMER_CAP} is dropped, not queued.
 */
export function inboundCount(strength: number): number {
  if (strength <= 0) return 0;
  return Math.min(8, Math.max(1, Math.ceil(strength / 8)));
}
/** Pressure shed per second once the post-hit lock has expired. */
export const PRESSURE_RECOVERY = 0.6;
/** Seconds after a hit before passive recovery starts. Relief ignores this lock. */
export const PRESSURE_LOCK = 1;

export const DOT_SCORE = 10;
export const PELLET_SCORE = 50;
export const GHOST_SCORE_BASE = 200;

export const COLLIDE_DISTANCE = 0.56;
