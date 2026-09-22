import { BOARD_H, BOARD_W, BOARD_X, BOARD_Y, GUTTER, PANEL_GAP, PANEL_H, PANEL_W, SIDE_COLS } from '../config';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function boardRect(): Rect {
  return { x: BOARD_X, y: BOARD_Y, w: BOARD_W, h: BOARD_H };
}

/** Sim ids 1–50 are the left stack, 51–100 the right stack. */
export function panelRect(simId: number): Rect {
  const left = simId <= 50;
  const index = left ? simId - 1 : simId - 51;
  const col = index % SIDE_COLS;
  const row = Math.floor(index / SIDE_COLS);
  const x0 = left ? 0 : BOARD_X + BOARD_W + GUTTER;
  return {
    x: x0 + col * (PANEL_W + PANEL_GAP),
    y: row * (PANEL_H + PANEL_GAP),
    w: PANEL_W,
    h: PANEL_H,
  };
}

export function panelCenter(simId: number): { x: number; y: number } {
  const rect = panelRect(simId);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}
