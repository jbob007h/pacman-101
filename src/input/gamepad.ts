import type { PacMode } from '../gameplay/powerMode';
import { DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP, type Dir } from '../shared/types';

/**
 * Standard Gamepad layout (W3C). Face buttons follow Xbox / PlayStation names:
 * 0 A/Cross, 1 B/Circle, 2 X/Square, 3 Y/Triangle, 9 Start.
 * D-pad is 12 up, 13 down, 14 left, 15 right. Axes 0 and 1 are the left stick.
 *
 * In a match those face buttons queue power modes: Y Standard, X Stronger,
 * A Speed, B Train. Menus keep A as activate and B as back.
 */
export const GAMEPAD_BUTTON = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  start: 9,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
} as const;

export const GAMEPAD_AXIS = {
  leftX: 0,
  leftY: 1,
} as const;

/** Stick deflection at or below this is neutral. Dominant axis wins past it. */
export const STICK_DEADZONE = 0.4;

/** Hold a menu direction this long before the first repeat, then every {@link FOCUS_REPEAT_MS}. */
export const FOCUS_INITIAL_MS = 350;
export const FOCUS_REPEAT_MS = 120;

/** In-match only. Menu activate/back does not use this table. */
const FACE_MODES: Partial<Record<number, PacMode>> = {
  [GAMEPAD_BUTTON.y]: 'standard',
  [GAMEPAD_BUTTON.x]: 'stronger',
  [GAMEPAD_BUTTON.a]: 'speed',
  [GAMEPAD_BUTTON.b]: 'train',
};

export type NavDir = 'up' | 'down' | 'left' | 'right';

export type MenuScreen = 'title' | 'lobby' | 'win' | 'standings';

export interface PadButtonState {
  pressed?: boolean;
  value?: number;
}

export interface PadLike {
  index?: number;
  connected?: boolean;
  mapping?: string;
  buttons: readonly PadButtonState[];
  axes: readonly number[];
}

export interface GamepadEdges {
  a: boolean;
  b: boolean;
  x: boolean;
  y: boolean;
  start: boolean;
}

export interface GamepadSample {
  connected: boolean;
  padIndex: number | null;
  /** Cardinal direction from the d-pad, or the left stick when the d-pad is neutral. */
  move: Dir | null;
  /** A menu step to apply this sample. Null when the direction is held inside the repeat gap. */
  nav: NavDir | null;
  edges: GamepadEdges;
}

export interface FocusSlot {
  id: string;
  row: number;
  col: number;
  disabled?: boolean;
  /** Omit from the highlight order. Still available as a back action. */
  focusable?: boolean;
}

export interface MenuControl extends FocusSlot {
  primary?: boolean;
  back?: boolean;
  /** A and Start run the screen primary instead of editing this control. */
  proceed?: boolean;
}

export interface NavRepeatState {
  dir: NavDir | null;
  heldMs: number;
  sinceRepeatMs: number;
  repeating: boolean;
}

const EMPTY_EDGES: GamepadEdges = { a: false, b: false, x: false, y: false, start: false };

export function modeFromFaceButton(index: number): PacMode | null {
  return FACE_MODES[index] ?? null;
}

export function buttonDown(button: PadButtonState | undefined): boolean {
  if (!button) return false;
  if (button.pressed) return true;
  return (button.value ?? 0) >= 0.5;
}

/**
 * Left stick to one cardinal direction.
 * Magnitudes at or below `deadzone` are neutral. When both axes clear it, the
 * larger magnitude wins. An exact tie prefers horizontal so the result is stable.
 * Axis y is negative toward up, matching the Gamepad API.
 */
export function stickDirection(x: number, y: number, deadzone = STICK_DEADZONE): Dir | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax <= deadzone && ay <= deadzone) return null;
  if (ax >= ay) {
    if (ax <= deadzone) return null;
    return x < 0 ? DIR_LEFT : DIR_RIGHT;
  }
  if (ay <= deadzone) return null;
  return y < 0 ? DIR_UP : DIR_DOWN;
}

/** One d-pad axis. Opposites cancel. A diagonal is ignored so the stick can break the tie. */
export function dpadDirection(buttons: readonly boolean[]): Dir | null {
  const up = buttons[GAMEPAD_BUTTON.dpadUp] === true;
  const down = buttons[GAMEPAD_BUTTON.dpadDown] === true;
  const left = buttons[GAMEPAD_BUTTON.dpadLeft] === true;
  const right = buttons[GAMEPAD_BUTTON.dpadRight] === true;
  const x = (right ? 1 : 0) - (left ? 1 : 0);
  const y = (down ? 1 : 0) - (up ? 1 : 0);
  if (x !== 0 && y !== 0) return null;
  if (x < 0) return DIR_LEFT;
  if (x > 0) return DIR_RIGHT;
  if (y < 0) return DIR_UP;
  if (y > 0) return DIR_DOWN;
  return null;
}

/** D-pad wins when it has a cardinal direction. Otherwise the left stick. */
export function moveDirection(dpad: Dir | null, stick: Dir | null): Dir | null {
  return dpad ?? stick;
}

export function dirToNav(dir: Dir | null): NavDir | null {
  if (!dir) return null;
  if (dir.x < 0) return 'left';
  if (dir.x > 0) return 'right';
  if (dir.y < 0) return 'up';
  if (dir.y > 0) return 'down';
  return null;
}

export function idleNavRepeat(): NavRepeatState {
  return { dir: null, heldMs: 0, sinceRepeatMs: 0, repeating: false };
}

/**
 * Menu key-repeat. The first sample of a direction fires immediately.
 * The next fire waits `initialMs`, then fires every `repeatMs` while held.
 */
export function stepNavRepeat(
  state: NavRepeatState,
  dir: NavDir | null,
  dtMs: number,
  initialMs = FOCUS_INITIAL_MS,
  repeatMs = FOCUS_REPEAT_MS,
): { state: NavRepeatState; fire: boolean } {
  if (dir == null) return { state: idleNavRepeat(), fire: false };
  if (dir !== state.dir) return { state: { dir, heldMs: 0, sinceRepeatMs: 0, repeating: false }, fire: true };
  const heldMs = state.heldMs + nonNegative(dtMs);
  if (!state.repeating) {
    if (heldMs >= initialMs) return { state: { dir, heldMs, sinceRepeatMs: 0, repeating: true }, fire: true };
    return { state: { dir, heldMs, sinceRepeatMs: 0, repeating: false }, fire: false };
  }
  const since = state.sinceRepeatMs + nonNegative(dtMs);
  if (since >= repeatMs) {
    return { state: { dir, heldMs, sinceRepeatMs: since - repeatMs, repeating: true }, fire: true };
  }
  return { state: { dir, heldMs, sinceRepeatMs: since, repeating: true }, fire: false };
}

/**
 * After a screen change, ignore a direction that is already held until the
 * stick and d-pad return to neutral. That keeps the auto-focused primary put.
 */
export function suppressHeldNav(armed: boolean, moving: boolean, fire: boolean): { armed: boolean; accept: boolean } {
  if (!moving) return { armed: true, accept: false };
  if (!armed) return { armed: false, accept: false };
  return { armed: true, accept: fire };
}

export function risingEdge(previous: boolean, next: boolean): boolean {
  return next && !previous;
}

function focusableSlots(slots: readonly FocusSlot[]): FocusSlot[] {
  return slots.filter((slot) => slot.focusable !== false && !slot.disabled);
}

/**
 * Move a highlight through a row/column grid.
 * Left and right stay on the row. Up and down pick the closest column on the
 * neighboring row. The highlight stays put at the edge. Disabled slots are skipped.
 * An empty or unknown current id lands on the first focusable slot.
 */
export function moveFocus(slots: readonly FocusSlot[], currentId: string | null, dir: NavDir): string | null {
  const enabled = focusableSlots(slots);
  if (enabled.length === 0) return null;
  const current = currentId == null ? undefined : slots.find((slot) => slot.id === currentId && slot.focusable !== false);
  if (!current) return enabled[0]?.id ?? null;
  if (dir === 'left' || dir === 'right') {
    const row = enabled.filter((slot) => slot.row === current.row).sort((a, b) => a.col - b.col);
    const index = row.findIndex((slot) => slot.id === current.id);
    if (index < 0) {
      const toward = dir === 'left' ? row.filter((slot) => slot.col < current.col).at(-1) : row.find((slot) => slot.col > current.col);
      return toward?.id ?? current.id;
    }
    const next = dir === 'left' ? row[index - 1] : row[index + 1];
    return next?.id ?? current.id;
  }
  const rows = [...new Set(enabled.map((slot) => slot.row))].sort((a, b) => a - b);
  const rowIndex = rows.indexOf(current.row);
  const nextRow = rows[rowIndex + (dir === 'up' ? -1 : 1)];
  if (nextRow == null) return current.id;
  const candidates = enabled.filter((slot) => slot.row === nextRow);
  let best = candidates[0];
  if (!best) return current.id;
  let bestDist = Math.abs(best.col - current.col);
  for (const candidate of candidates.slice(1)) {
    const dist = Math.abs(candidate.col - current.col);
    if (dist < bestDist || (dist === bestDist && candidate.col < best.col)) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best.id;
}

/**
 * Highlight the primary control when it can be activated.
 * A disabled primary (Ready already sent) falls back to Start, then the first
 * real button, so the highlight never opens on the name field.
 */
export function defaultMenuFocus(controls: readonly MenuControl[]): string | null {
  const enabled = focusableSlots(controls);
  const primary = enabled.find((control) => (control as MenuControl).primary);
  if (primary) return primary.id;
  const start = enabled.find((control) => control.id === 'start');
  if (start) return start.id;
  const button = enabled.find((control) => !(control as MenuControl).proceed);
  return button?.id ?? enabled[0]?.id ?? null;
}

export interface MenuOptions {
  readyDisabled?: boolean;
  endMatch?: boolean;
}

/**
 * Focus order for each client screen. Rows run top to bottom, columns left to right.
 * Lobby adds Ready and a non-focusable leave action. Standings prepends End match
 * when that button is on screen, and that button becomes the primary.
 */
export function menuControls(screen: MenuScreen, options: MenuOptions = {}): MenuControl[] {
  if (screen === 'title' || screen === 'lobby') {
    const controls: MenuControl[] = [
      { id: 'name', row: 0, col: 0, proceed: true },
      { id: 'theme-classic', row: 1, col: 0 },
      { id: 'theme-deep-sea', row: 1, col: 1 },
      { id: 'start', row: 2, col: 0, primary: screen === 'title' },
      { id: 'online', row: 2, col: 1 },
    ];
    if (screen === 'lobby') {
      controls.push({
        id: 'ready',
        row: 2,
        col: 2,
        primary: true,
        disabled: options.readyDisabled === true,
      });
      controls.push({ id: 'leave-lobby', row: 0, col: 0, back: true, focusable: false });
    }
    controls.push({ id: 'mute-menu', row: 3, col: 0 });
    return controls;
  }
  if (screen === 'win') {
    return [
      { id: 'overlay-continue', row: 0, col: 0, primary: true, back: true },
      { id: 'overlay-menu', row: 0, col: 1 },
    ];
  }
  const controls: MenuControl[] = [];
  let col = 0;
  if (options.endMatch) {
    controls.push({ id: 'ranking-end', row: 0, col: col, primary: true });
    col += 1;
  }
  controls.push({ id: 'ranking-restart', row: 0, col, primary: !options.endMatch });
  col += 1;
  controls.push({ id: 'ranking-menu', row: 0, col, back: true });
  return controls;
}

export function choosePad(pads: readonly (PadLike | null | undefined)[], stickIndex: number | null): PadLike | null {
  const connected = pads.filter((pad): pad is PadLike => Boolean(pad && pad.connected !== false && pad.buttons));
  if (stickIndex != null) {
    const current = connected.find((pad) => pad.index === stickIndex);
    if (current) return current;
  }
  return connected.find((pad) => pad.mapping === 'standard') ?? connected[0] ?? null;
}

/**
 * Samples one pad. Button edges rise once per press. Menu navigation repeats
 * while a cardinal direction is held. Call from the sim heartbeat so a hidden
 * tab, whose animation frames are paused, still reads the controller.
 */
export class GamepadReader {
  private index: number | null = null;
  private previous: boolean[] = [];
  private nav: NavRepeatState = idleNavRepeat();
  private lastMs: number | null = null;

  resetNav(): void {
    this.nav = idleNavRepeat();
  }

  sample(pads: readonly (PadLike | null | undefined)[], nowMs: number): GamepadSample {
    const dt = this.lastMs == null ? 0 : nonNegative(nowMs - this.lastMs);
    this.lastMs = Number.isFinite(nowMs) ? nowMs : this.lastMs;
    const pad = choosePad(pads, this.index);
    if (!pad) {
      this.index = null;
      this.previous = [];
      this.nav = idleNavRepeat();
      return { connected: false, padIndex: null, move: null, nav: null, edges: { ...EMPTY_EDGES } };
    }
    if (pad.index !== this.index) {
      this.previous = [];
      this.nav = idleNavRepeat();
      this.index = pad.index ?? null;
    }
    const down = readButtons(pad);
    const edges = edgeButtons(this.previous, down);
    this.previous = down;
    const move = moveDirection(
      dpadDirection(down),
      stickDirection(axis(pad, GAMEPAD_AXIS.leftX), axis(pad, GAMEPAD_AXIS.leftY)),
    );
    const stepped = stepNavRepeat(this.nav, dirToNav(move), dt);
    this.nav = stepped.state;
    return {
      connected: true,
      padIndex: this.index,
      move,
      nav: stepped.fire ? dirToNav(move) : null,
      edges,
    };
  }
}

function readButtons(pad: PadLike): boolean[] {
  const count = Math.max(pad.buttons.length, GAMEPAD_BUTTON.dpadRight + 1);
  const down: boolean[] = [];
  for (let index = 0; index < count; index++) down.push(buttonDown(pad.buttons[index]));
  return down;
}

function edgeButtons(previous: readonly boolean[], next: readonly boolean[]): GamepadEdges {
  const rose = (index: number): boolean => risingEdge(previous[index] === true, next[index] === true);
  return {
    a: rose(GAMEPAD_BUTTON.a),
    b: rose(GAMEPAD_BUTTON.b),
    x: rose(GAMEPAD_BUTTON.x),
    y: rose(GAMEPAD_BUTTON.y),
    start: rose(GAMEPAD_BUTTON.start),
  };
}

function axis(pad: PadLike, index: number): number {
  const value = pad.axes[index];
  return typeof value === 'number' ? value : 0;
}

function nonNegative(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}
