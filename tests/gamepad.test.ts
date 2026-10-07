import { describe, expect, it } from 'vitest';
import { DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP } from '../src/shared/types';
import {
  choosePad,
  defaultMenuFocus,
  dpadDirection,
  FOCUS_INITIAL_MS,
  FOCUS_REPEAT_MS,
  GAMEPAD_BUTTON,
  GamepadReader,
  idleNavRepeat,
  menuControls,
  modeFromFaceButton,
  moveDirection,
  moveFocus,
  risingEdge,
  stepNavRepeat,
  stickDirection,
  STICK_DEADZONE,
  suppressHeldNav,
  type PadLike,
} from '../src/input/gamepad';
import { classicTheme } from '../src/theme/classic';
import { deepSeaTheme } from '../src/theme/deepSea';

describe('gamepad mapping', () => {
  it('maps the standard face buttons onto the four power modes', () => {
    expect(modeFromFaceButton(GAMEPAD_BUTTON.y)).toBe('standard');
    expect(modeFromFaceButton(GAMEPAD_BUTTON.x)).toBe('stronger');
    expect(modeFromFaceButton(GAMEPAD_BUTTON.a)).toBe('speed');
    expect(modeFromFaceButton(GAMEPAD_BUTTON.b)).toBe('train');
    expect(modeFromFaceButton(GAMEPAD_BUTTON.start)).toBeNull();
  });

  it('treats a press as a rising edge and ignores a held button', () => {
    expect(risingEdge(false, true)).toBe(true);
    expect(risingEdge(true, true)).toBe(false);
    expect(risingEdge(true, false)).toBe(false);
    expect(risingEdge(false, false)).toBe(false);
  });
});

describe('stick deadzone', () => {
  it('ignores deflection at or below the deadzone', () => {
    expect(stickDirection(0, 0)).toBeNull();
    expect(stickDirection(STICK_DEADZONE, 0)).toBeNull();
    expect(stickDirection(0, -STICK_DEADZONE)).toBeNull();
    expect(stickDirection(0.2, -0.3)).toBeNull();
    expect(stickDirection(Number.NaN, 1)).toBeNull();
  });

  it('lets the dominant axis win past the deadzone', () => {
    expect(stickDirection(0.41, 0)).toEqual(DIR_RIGHT);
    expect(stickDirection(-0.9, 0.2)).toEqual(DIR_LEFT);
    expect(stickDirection(0.5, -0.9)).toEqual(DIR_UP);
    expect(stickDirection(-0.2, 0.8)).toEqual(DIR_DOWN);
    expect(stickDirection(0.8, 0.8)).toEqual(DIR_RIGHT);
    expect(stickDirection(-0.7, -0.7)).toEqual(DIR_LEFT);
  });
});

describe('d-pad', () => {
  it('reads one cardinal and cancels opposites or diagonals', () => {
    expect(dpadDirection(mask(GAMEPAD_BUTTON.dpadLeft))).toEqual(DIR_LEFT);
    expect(dpadDirection(mask(GAMEPAD_BUTTON.dpadUp))).toEqual(DIR_UP);
    expect(dpadDirection(mask(GAMEPAD_BUTTON.dpadRight, GAMEPAD_BUTTON.dpadLeft))).toBeNull();
    expect(dpadDirection(mask(GAMEPAD_BUTTON.dpadUp, GAMEPAD_BUTTON.dpadRight))).toBeNull();
  });

  it('prefers the d-pad over the stick', () => {
    expect(moveDirection(DIR_LEFT, DIR_RIGHT)).toEqual(DIR_LEFT);
    expect(moveDirection(null, DIR_UP)).toEqual(DIR_UP);
    expect(moveDirection(null, null)).toBeNull();
  });
});

describe('menu repeat', () => {
  it('fires on the press, waits out the initial delay, then repeats', () => {
    let step = stepNavRepeat(idleNavRepeat(), 'down', 16);
    expect(step.fire).toBe(true);
    step = stepNavRepeat(step.state, 'down', 100);
    expect(step.fire).toBe(false);
    step = stepNavRepeat(step.state, 'down', FOCUS_INITIAL_MS - 100);
    expect(step.fire).toBe(true);
    expect(step.state.repeating).toBe(true);
    step = stepNavRepeat(step.state, 'down', FOCUS_REPEAT_MS - 1);
    expect(step.fire).toBe(false);
    step = stepNavRepeat(step.state, 'down', 1);
    expect(step.fire).toBe(true);
  });

  it('restarts the delay when the direction changes or releases', () => {
    let step = stepNavRepeat(idleNavRepeat(), 'left', 0);
    step = stepNavRepeat(step.state, 'left', FOCUS_INITIAL_MS);
    expect(step.fire).toBe(true);
    step = stepNavRepeat(step.state, null, 500);
    expect(step.fire).toBe(false);
    step = stepNavRepeat(step.state, 'left', 0);
    expect(step.fire).toBe(true);
    expect(step.state.heldMs).toBe(0);
    step = stepNavRepeat(step.state, 'right', 0);
    expect(step.fire).toBe(true);
    expect(step.state.dir).toBe('right');
  });
});

describe('held navigation after a screen change', () => {
  it('drops a direction that is already held until the stick returns to center', () => {
    let gate = suppressHeldNav(false, true, true);
    expect(gate).toEqual({ armed: false, accept: false });
    gate = suppressHeldNav(gate.armed, false, false);
    expect(gate).toEqual({ armed: true, accept: false });
    gate = suppressHeldNav(gate.armed, true, true);
    expect(gate).toEqual({ armed: true, accept: true });
  });
});

describe('menu focus', () => {
  const title = menuControls('title');

  it('puts Start first on the title screen and Ready first in the lobby', () => {
    expect(defaultMenuFocus(title)).toBe('start');
    expect(defaultMenuFocus(menuControls('lobby'))).toBe('ready');
    expect(defaultMenuFocus(menuControls('lobby', { readyDisabled: true }))).toBe('start');
    expect(defaultMenuFocus(menuControls('win'))).toBe('overlay-continue');
    expect(defaultMenuFocus(menuControls('standings'))).toBe('ranking-restart');
    expect(defaultMenuFocus(menuControls('standings', { endMatch: true }))).toBe('ranking-end');
  });

  it('moves across the title controls and skips a disabled lobby button', () => {
    expect(moveFocus(title, 'start', 'up')).toBe('theme-classic');
    expect(moveFocus(title, 'theme-classic', 'right')).toBe('theme-deep-sea');
    expect(moveFocus(title, 'theme-deep-sea', 'down')).toBe('online');
    expect(moveFocus(title, 'theme-classic', 'left')).toBe('theme-classic');
    expect(moveFocus(title, 'name', 'down')).toBe('theme-classic');
    expect(moveFocus(title, null, 'down')).toBe('name');

    const lobby = menuControls('lobby', { readyDisabled: true });
    expect(moveFocus(lobby, 'online', 'right')).toBe('online');
    expect(moveFocus(lobby, 'ready', 'left')).toBe('online');
    expect(moveFocus(lobby, 'ready', 'right')).toBe('ready');
    expect(moveFocus(lobby, 'ready', 'down')).toBe('mute-menu');
    expect(lobby.find((control) => control.id === 'leave-lobby')?.back).toBe(true);
    expect(lobby.find((control) => control.id === 'leave-lobby')?.focusable).toBe(false);
  });

  it('closes the win card and the standings with the back control', () => {
    const win = menuControls('win');
    expect(win.find((control) => control.back)?.id).toBe('overlay-continue');
    expect(moveFocus(win, 'overlay-continue', 'right')).toBe('overlay-menu');
    const standings = menuControls('standings', { endMatch: true });
    expect(standings.map((control) => control.id)).toEqual(['ranking-end', 'ranking-restart', 'ranking-menu']);
    expect(standings.find((control) => control.back)?.id).toBe('ranking-menu');
    expect(moveFocus(standings, 'ranking-end', 'right')).toBe('ranking-restart');
  });

  it('treats the name field as proceed-only', () => {
    expect(title.find((control) => control.id === 'name')?.proceed).toBe(true);
  });
});

describe('GamepadReader', () => {
  it('edges face buttons once and keeps the d-pad ahead of the stick', () => {
    const reader = new GamepadReader();
    const first = reader.sample([pad({ a: true, axes: [0.9, 0] })], 1000);
    expect(first.connected).toBe(true);
    expect(first.edges).toEqual({ a: true, b: false, x: false, y: false, start: false });
    expect(first.move).toEqual(DIR_RIGHT);
    expect(first.nav).toBe('right');

    const held = reader.sample([pad({ a: true, dpadLeft: true, axes: [0.9, 0] })], 1016);
    expect(held.edges.a).toBe(false);
    expect(held.move).toEqual(DIR_LEFT);
    expect(held.nav).toBe('left');

    reader.sample([pad({ a: false, axes: [0, 0] })], 1032);
    const pressed = reader.sample([pad({ a: true, axes: [0.2, 0.1] })], 1048);
    expect(pressed.edges.a).toBe(true);
    expect(pressed.move).toBeNull();
    expect(pressed.nav).toBeNull();
  });

  it('repeats menu navigation on the hold timers', () => {
    const reader = new GamepadReader();
    expect(reader.sample([pad({ dpadDown: true })], 0).nav).toBe('down');
    expect(reader.sample([pad({ dpadDown: true })], FOCUS_INITIAL_MS - 1).nav).toBeNull();
    expect(reader.sample([pad({ dpadDown: true })], FOCUS_INITIAL_MS).nav).toBe('down');
    expect(reader.sample([pad({ dpadDown: true })], FOCUS_INITIAL_MS + FOCUS_REPEAT_MS).nav).toBe('down');
  });

  it('keeps the pad it already sampled until that pad disconnects', () => {
    const reader = new GamepadReader();
    const primary = pad({ index: 1, mapping: '' });
    const other = pad({ index: 0, mapping: 'standard', a: true });
    expect(reader.sample([other, primary], 0).padIndex).toBe(0);
    expect(reader.sample([null, primary], 16).padIndex).toBe(1);
    expect(choosePad([primary, other], 1)?.index).toBe(1);
    expect(choosePad([other], null)?.mapping).toBe('standard');
  });
});

describe('controller copy', () => {
  it('names the face buttons beside the keys in both themes', () => {
    for (const theme of [classicTheme, deepSeaTheme]) {
      expect(theme.strings.controllerConnected).toBe('Controller connected');
      expect(theme.strings.modeButtons).toEqual({
        standard: 'Y',
        stronger: 'X',
        speed: 'A',
        train: 'B',
      });
      expect(theme.strings.help).toContain('D-pad');
      expect(theme.strings.help).toContain('Y/Triangle, X/Square, A/Cross, and B/Circle');
      expect(theme.strings.help).toContain('A/Cross activates');
      expect(theme.strings.help).toContain('B/Circle goes back');
      expect(theme.strings.statusMove).toContain('D-pad');
      expect(theme.strings.winHint).toContain('Start');
    }
  });
});

function mask(...indexes: number[]): boolean[] {
  const buttons = Array<boolean>(16).fill(false);
  for (const index of indexes) buttons[index] = true;
  return buttons;
}

function pad(input: {
  index?: number;
  mapping?: string;
  a?: boolean;
  b?: boolean;
  x?: boolean;
  y?: boolean;
  start?: boolean;
  dpadUp?: boolean;
  dpadDown?: boolean;
  dpadLeft?: boolean;
  dpadRight?: boolean;
  axes?: readonly number[];
}): PadLike {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  const press = (index: number, down: boolean | undefined) => {
    if (!down) return;
    const button = buttons[index];
    if (!button) return;
    button.pressed = true;
    button.value = 1;
  };
  press(GAMEPAD_BUTTON.a, input.a);
  press(GAMEPAD_BUTTON.b, input.b);
  press(GAMEPAD_BUTTON.x, input.x);
  press(GAMEPAD_BUTTON.y, input.y);
  press(GAMEPAD_BUTTON.start, input.start);
  press(GAMEPAD_BUTTON.dpadUp, input.dpadUp);
  press(GAMEPAD_BUTTON.dpadDown, input.dpadDown);
  press(GAMEPAD_BUTTON.dpadLeft, input.dpadLeft);
  press(GAMEPAD_BUTTON.dpadRight, input.dpadRight);
  return {
    index: input.index ?? 0,
    connected: true,
    mapping: input.mapping ?? 'standard',
    buttons,
    axes: input.axes ?? [0, 0],
  };
}
