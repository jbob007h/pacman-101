import { FRUIT_DRAW_SCALE, pelletFill, SPEED_POPUP_SECONDS, TILE } from '../config';
import type { Ghost, GhostMode } from '../gameplay/ghosts';
import { frightenedFlash } from '../gameplay/ghosts';
import { TRAIN_CALM_SCALE, trainMemberColor, type TrainFollower } from '../gameplay/train';
import type { Dir, GhostId } from '../shared/types';
import type { InboundJammer } from '../gameplay/inbound';
import type { Maze } from '../gameplay/maze';
import { Tile } from '../gameplay/maze';
import type { Pac } from '../gameplay/board';
import type { Sim } from '../systems/sims';
import type { Bolt, IncomingShot, Particle } from './fx';
import { boardRect, ghostHouseCenter, panelRect } from './layout';

/** Visual size only. Collision and movement stay on the 1× tile logic. */
export const SPRITE_SCALE = 2;

/**
 * Spawn pulse. Starts large and swings up and down, then settles at 1
 * as `anim` reaches 1. Six waves across the spawn window.
 */
export function jammerSpawnScale(anim: number): number {
  const t = Math.min(1, Math.max(0, anim));
  const waves = 6;
  const envelope = 1 - t;
  const mid = 1 + envelope * 0.5;
  const amp = envelope * 0.35;
  return mid + Math.sin(t * waves * Math.PI * 2) * amp;
}

export interface DrawInput {
  maze: Maze;
  pac: Pac;
  ghosts: readonly Ghost[];
  sims: readonly Sim[];
  bolts: readonly Bolt[];
  incoming: readonly IncomingShot[];
  particles: readonly Particle[];
  shake: number;
  mazeFlash: number;
  frightened: number;
  deathTime: number;
  time: number;
  eatPause: number;
  eatPoints: number;
  /** Seconds remaining on the full-clear "Speed Up!" callout. 0 hides it. */
  speedPopup: number;
  /** Seconds remaining on the single ghost-eat count. 0 hides it. */
  eatPopup: number;
  eatPopupCount: number;
  eatPopupX: number;
  eatPopupY: number;
  /** Tile-center sleepers that have not woken. */
  sleepers: readonly { x: number; y: number }[];
  /** Awakened followers. The leader is one of {@link ghosts}. */
  train: readonly TrainFollower[];
  trainLeaderId: GhostId | null;
  fruit: { x: number; y: number } | null;
  jammers: readonly InboundJammer[];
  slow: number;
}

export interface WallFill {
  /** Local offset inside the tile, in pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corridor-facing edges of the filled half (for the light rim). */
  edge: { left: boolean; right: boolean; top: boolean; bottom: boolean };
}

/**
 * Wall paint for one tile. Interior solid blocks stay full. A wall next to a
 * walkable corridor is inset toward the blocked side so only half the cell is
 * painted — corridors look wider, collision stays the same.
 */
export function wallFill(maze: Maze, x: number, y: number): WallFill {
  const openL = isWalkable(maze, x - 1, y);
  const openR = isWalkable(maze, x + 1, y);
  const openU = isWalkable(maze, x, y - 1);
  const openD = isWalkable(maze, x, y + 1);
  if (!openL && !openR && !openU && !openD) {
    return { x: 0, y: 0, w: TILE, h: TILE, edge: { left: false, right: false, top: false, bottom: false } };
  }
  let lx = 0;
  let ly = 0;
  let w = TILE;
  let h = TILE;
  if (openL) {
    lx += TILE / 2;
    w -= TILE / 2;
  }
  if (openR) w -= TILE / 2;
  if (openU) {
    ly += TILE / 2;
    h -= TILE / 2;
  }
  if (openD) h -= TILE / 2;
  if (w <= 0 || h <= 0) {
    return {
      x: TILE / 4,
      y: TILE / 4,
      w: TILE / 2,
      h: TILE / 2,
      edge: { left: openL, right: openR, top: openU, bottom: openD },
    };
  }
  return {
    x: lx,
    y: ly,
    w,
    h,
    edge: { left: openL, right: openR, top: openU, bottom: openD },
  };
}

interface SplitLayers {
  panels: CanvasRenderingContext2D;
  maze: CanvasRenderingContext2D;
  overlay: CanvasRenderingContext2D;
}

const splitCache = new WeakMap<object, { panels: HTMLCanvasElement; maze: HTMLCanvasElement; overlay: HTMLCanvasElement }>();

/**
 * Side grids, the clipped maze, and floating callouts are separate bitmaps.
 * The maze clip (and each panel's name clip) cannot hide a callout, because
 * the overlay canvas is never clipped and is blitted last.
 */
function openSplit(ctx: CanvasRenderingContext2D): SplitLayers | null {
  const view = ctx.canvas;
  const doc = view.ownerDocument;
  if (!doc?.createElement) return null;
  let canvases = splitCache.get(view);
  if (!canvases) {
    canvases = {
      panels: doc.createElement('canvas'),
      maze: doc.createElement('canvas'),
      overlay: doc.createElement('canvas'),
    };
    splitCache.set(view, canvases);
  }
  const panels = prepLayer(canvases.panels, view);
  const maze = prepLayer(canvases.maze, view);
  const overlay = prepLayer(canvases.overlay, view);
  if (!panels || !maze || !overlay) return null;
  return { panels, maze, overlay };
}

function prepLayer(canvas: HTMLCanvasElement, view: HTMLCanvasElement): CanvasRenderingContext2D | null {
  if (canvas.width !== view.width || canvas.height !== view.height) {
    canvas.width = view.width;
    canvas.height = view.height;
  }
  const layer = canvas.getContext('2d');
  if (!layer) return null;
  layer.setTransform(1, 0, 0, 1, 0, 0);
  layer.clearRect(0, 0, canvas.width, canvas.height);
  return layer;
}

function copyTransform(from: CanvasRenderingContext2D, to: CanvasRenderingContext2D): DOMMatrix {
  const t = from.getTransform();
  to.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
  return t;
}

export function drawFrame(ctx: CanvasRenderingContext2D, input: DrawInput): void {
  const split = openSplit(ctx);
  if (split) {
    const t = copyTransform(ctx, split.panels);
    copyTransform(ctx, split.maze);
    copyTransform(ctx, split.overlay);
    paintScene(split.panels, split.maze, split.overlay, input, false);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.drawImage(split.panels.canvas, 0, 0);
    ctx.drawImage(split.maze.canvas, 0, 0);
    ctx.drawImage(split.overlay.canvas, 0, 0);
    ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
    return;
  }
  paintScene(ctx, ctx, ctx, input, true);
}

function paintScene(
  panelCtx: CanvasRenderingContext2D,
  mazeCtx: CanvasRenderingContext2D,
  overlayCtx: CanvasRenderingContext2D,
  input: DrawInput,
  fillBackground: boolean,
): void {
  const shake = (layer: CanvasRenderingContext2D, draw: () => void): void => {
    layer.save();
    if (input.shake > 0) {
      const mag = input.shake * 6;
      layer.translate(Math.sin(input.time * 48) * mag, Math.cos(input.time * 37) * mag);
    }
    draw();
    layer.restore();
  };
  if (fillBackground) {
    const view = panelCtx.canvas;
    const width = view.width / (panelCtx.getTransform().a || 1);
    const height = view.height / (panelCtx.getTransform().d || 1);
    panelCtx.fillStyle = '#070b14';
    panelCtx.fillRect(0, 0, width, height);
  }
  shake(panelCtx, () => {
    for (const sim of input.sims) {
      if (sim.parked) continue;
      drawPanel(panelCtx, sim, input.time);
    }
  });
  const board = boardRect();
  shake(mazeCtx, () => drawMazeWorld(mazeCtx, input, board));
  shake(overlayCtx, () => {
    drawBoardChrome(overlayCtx, input, board);
    drawPlayfieldFx(overlayCtx, input, board);
    drawPlayfieldCallouts(overlayCtx, input, board);
  });
}

/** Maze actors stay inside the board. Tunnel wraps must not cover the side grids. */
function drawMazeWorld(ctx: CanvasRenderingContext2D, input: DrawInput, board: { x: number; y: number; w: number; h: number }): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(board.x, board.y, board.w, board.h);
  ctx.clip();
  ctx.fillStyle = '#00000c';
  ctx.fillRect(board.x, board.y, board.w, board.h);
  drawMaze(ctx, input.maze, board.x, board.y, input.time, input.mazeFlash);
  if (input.fruit) drawFruit(ctx, input.fruit, board.x, board.y);
  for (const sleeper of input.sleepers) {
    drawGhostSprite(ctx, input, board.x, board.y, {
      x: sleeper.x,
      y: sleeper.y,
      dir: { x: 0, y: 1 },
      color: '#f7f8ff',
      mode: 'chase',
      homeX: sleeper.x + sleeper.y,
      scale: 0.62,
      alpha: 1,
    });
  }
  for (const ghost of input.ghosts) drawGhost(ctx, ghost, input, board.x, board.y);
  const leader = input.ghosts.find((ghost) => ghost.id === input.trainLeaderId);
  const trainFright = leader?.mode === 'frightened';
  const look = trainFollowerLook(trainFright);
  input.train.forEach((follower, index) => {
    drawGhostSprite(ctx, input, board.x, board.y, {
      x: follower.x,
      y: follower.y,
      dir: follower.dir,
      color: trainMemberColor(index, input.train.length),
      mode: look.mode,
      homeX: follower.id,
      scale: look.scale,
      alpha: 1,
    });
  });
  drawPac(ctx, input, board.x, board.y);
  drawPelletClock(ctx, input.frightened);
  for (const jammer of input.jammers) drawJammer(ctx, jammer, input.maze, board.x, board.y, input.frightened > 0);
  ctx.restore();
}

function drawBoardChrome(
  ctx: CanvasRenderingContext2D,
  input: DrawInput,
  board: { x: number; y: number; w: number; h: number },
): void {
  ctx.strokeStyle = input.slow > 0 ? 'rgba(140, 190, 255, 0.9)' : '#243058';
  ctx.lineWidth = input.slow > 0 ? 4 : 2;
  ctx.strokeRect(board.x + 1, board.y + 1, board.w - 2, board.h - 2);
  if (input.slow > 0) {
    const alpha = 0.05 + 0.04 * Math.abs(Math.sin(input.time * 9));
    ctx.fillStyle = `rgba(80, 140, 255, ${alpha})`;
    ctx.fillRect(board.x, board.y, board.w, board.h);
  }
}

/** Bolts, impacts, and the hit flash. Drawn after the grids so they cross the gutters. */
function drawPlayfieldFx(
  ctx: CanvasRenderingContext2D,
  input: DrawInput,
  board: { x: number; y: number; w: number; h: number },
): void {
  drawBolts(ctx, input.bolts);
  drawIncoming(ctx, input.incoming);
  drawParticles(ctx, input.particles);
  if (input.mazeFlash > 0) {
    ctx.fillStyle = `rgba(255, 70, 90, ${input.mazeFlash * 0.34})`;
    ctx.fillRect(board.x, board.y, board.w, board.h);
  }
}

/**
 * Floating scores and callouts. Not clipped to the maze, so a "Speed Up!"
 * near a tunnel paints over the side grids instead of vanishing behind them.
 */
function drawPlayfieldCallouts(
  ctx: CanvasRenderingContext2D,
  input: DrawInput,
  board: { x: number; y: number; w: number; h: number },
): void {
  drawEatScore(ctx, input, board.x, board.y);
  drawSpeedPopup(ctx, input, board.x, board.y);
  drawEatCountPopup(ctx, input, board.x, board.y);
}

function drawMaze(ctx: CanvasRenderingContext2D, maze: Maze, ox: number, oy: number, time: number, flash: number): void {
  for (let y = 0; y < maze.rows; y++) {
    for (let x = 0; x < maze.cols; x++) {
      const tile = maze.tile(x, y);
      const px = ox + x * TILE;
      const py = oy + y * TILE;
      if (tile === Tile.Wall) {
        const fill = wallFill(maze, x, y);
        const border = fill.w < TILE || fill.h < TILE;
        ctx.fillStyle = wallColor(border, flash);
        ctx.fillRect(px + fill.x, py + fill.y, fill.w, fill.h);
        if (border) {
          ctx.fillStyle = '#8eabff';
          if (fill.edge.top) ctx.fillRect(px + fill.x, py + fill.y, fill.w, 2);
          if (fill.edge.bottom) ctx.fillRect(px + fill.x, py + fill.y + fill.h - 2, fill.w, 2);
          if (fill.edge.left) ctx.fillRect(px + fill.x, py + fill.y, 2, fill.h);
          if (fill.edge.right) ctx.fillRect(px + fill.x + fill.w - 2, py + fill.y, 2, fill.h);
        }
        continue;
      }
      if (tile === Tile.Door) {
        ctx.fillStyle = '#ffb4cc';
        ctx.fillRect(px, py + TILE / 2 - 2, TILE, 4);
        continue;
      }
      if (tile === Tile.Dot) {
        ctx.fillStyle = '#ffc2a8';
        ctx.beginPath();
        ctx.arc(px + TILE / 2, py + TILE / 2, 1.7, 0, Math.PI * 2);
        ctx.fill();
      } else if (tile === Tile.Pellet) {
        const pulse = 4.2 + Math.sin(time * 6) * 0.8;
        ctx.fillStyle = 'rgba(255, 214, 120, 0.28)';
        ctx.beginPath();
        ctx.arc(px + TILE / 2, py + TILE / 2, pulse + 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffe14a';
        ctx.beginPath();
        ctx.arc(px + TILE / 2, py + TILE / 2, pulse, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function drawPac(ctx: CanvasRenderingContext2D, input: DrawInput, ox: number, oy: number): void {
  const pac = input.pac;
  const death = pac.alive ? 0 : Math.min(1, input.deathTime / 0.9);
  const radius = 7.1 * SPRITE_SCALE * (1 - death * 0.85);
  const mouth = pac.alive ? 0.08 + Math.abs(Math.sin(pac.anim * 2.2)) * 0.42 : 0.9;
  const facing =
    (pac.dir.x === 0 && pac.dir.y === 0 ? Math.PI : Math.atan2(pac.dir.y, pac.dir.x)) + death * Math.PI * 2;
  for (const point of spritePoints(pac.x, pac.y, input.maze)) {
    const sx = ox + point.x * TILE + TILE / 2;
    const sy = oy + point.y * TILE + TILE / 2;
    ctx.fillStyle = input.slow > 0 ? '#9fd4ff' : '#ffe14a';
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.arc(sx, sy, radius, facing + mouth, facing + Math.PI * 2 - mouth);
    ctx.closePath();
    ctx.fill();
  }
}

function drawJammer(
  ctx: CanvasRenderingContext2D,
  jammer: InboundJammer,
  maze: Maze,
  ox: number,
  oy: number,
  frightened: boolean,
): void {
  let scale = 1;
  let alpha = 1;
  if (jammer.phase === 'spawn') {
    scale = jammerSpawnScale(jammer.anim);
    alpha = 1;
  } else if (jammer.phase === 'dying') {
    scale = 1 - 0.75 * jammer.anim;
    alpha = 1 - jammer.anim;
  }
  const frozen = jammer.kind === 'red' && frightened && jammer.phase === 'live';
  const color = frozen ? '#8fd0ff' : jammer.kind === 'red' ? '#ff2a36' : '#ffffff';
  const ring = frozen ? '#e8f6ff' : jammer.kind === 'red' ? '#ffd2d6' : '#1a2748';
  const glow = frozen ? 'rgba(140, 210, 255, 0.45)' : jammer.kind === 'red' ? 'rgba(255, 40, 54, 0.45)' : 'rgba(255, 255, 255, 0.55)';
  const s = SPRITE_SCALE;
  for (const point of spritePoints(jammer.x, jammer.y, maze)) {
    const sx = ox + point.x * TILE + TILE / 2;
    const sy = oy + point.y * TILE + TILE / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(sx, sy);
    ctx.scale(scale, scale);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 11 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, 6.4 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ring;
    ctx.lineWidth = 2 * s;
    ctx.stroke();
    ctx.strokeStyle = jammer.kind === 'red' ? '#fff' : '#ff2a36';
    ctx.lineWidth = 1.6 * s;
    ctx.beginPath();
    if (jammer.kind === 'red') {
      ctx.moveTo(-3.2 * s, -3.2 * s);
      ctx.lineTo(3.2 * s, 3.2 * s);
      ctx.moveTo(3.2 * s, -3.2 * s);
      ctx.lineTo(-3.2 * s, 3.2 * s);
    } else {
      ctx.moveTo(-3.4 * s, 0);
      ctx.lineTo(3.4 * s, 0);
      ctx.moveTo(0, -3.4 * s);
      ctx.lineTo(0, 3.4 * s);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function drawEatScore(ctx: CanvasRenderingContext2D, input: DrawInput, ox: number, oy: number): void {
  if (input.eatPause <= 0 || input.eatPoints <= 0) return;
  const pac = input.pac;
  const sx = ox + pac.x * TILE + TILE / 2;
  const sy = oy + pac.y * TILE + TILE / 2;
  ctx.fillStyle = '#9fd4ff';
  ctx.font = 'bold 13px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(String(input.eatPoints), sx, sy - 14 * SPRITE_SCALE);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

export const SPEED_POPUP_TEXT = 'Speed Up!';

export interface SpeedPopupPose {
  /** Pixels added above Pac. Negative is up. */
  dy: number;
  scaleX: number;
  scaleY: number;
  alpha: number;
}

/**
 * Arcade hop for the clear callout. A few decaying bounces, a pop-in scale,
 * then a fade. `remaining` is seconds left of {@link SPEED_POPUP_SECONDS}.
 */
export function speedPopupPose(remaining: number, duration = SPEED_POPUP_SECONDS): SpeedPopupPose {
  if (remaining <= 0 || duration <= 0) return { dy: 0, scaleX: 1, scaleY: 1, alpha: 0 };
  const age = Math.min(1, Math.max(0, 1 - remaining / duration));
  const hop = Math.abs(Math.sin(age * Math.PI * 3));
  const decay = 1 - age;
  const dy = -16 - hop * decay * 30;
  const intro = Math.min(1, age / 0.14);
  const pop = Math.sin((intro * Math.PI) / 2);
  const scale = 0.45 + 0.8 * pop;
  const airborne = hop * decay;
  const landing = (1 - hop) * decay * (age > 0.08 ? 1 : 0);
  const alpha = age < 0.72 ? 1 : Math.max(0, 1 - (age - 0.72) / 0.28);
  return {
    dy,
    scaleX: scale * (1 + landing * 0.2 - airborne * 0.1),
    scaleY: scale * (1 - landing * 0.24 + airborne * 0.28),
    alpha,
  };
}

function drawSpeedPopup(ctx: CanvasRenderingContext2D, input: DrawInput, ox: number, oy: number): void {
  if (input.speedPopup <= 0) return;
  const pac = input.pac;
  drawBouncingCallout(
    ctx,
    SPEED_POPUP_TEXT,
    ox + pac.x * TILE + TILE / 2,
    oy + pac.y * TILE + TILE / 2,
    speedPopupPose(input.speedPopup),
    '#ffe14a',
  );
}

function drawEatCountPopup(ctx: CanvasRenderingContext2D, input: DrawInput, ox: number, oy: number): void {
  if (input.eatPopup <= 0 || input.eatPopupCount <= 0) return;
  drawBouncingCallout(
    ctx,
    String(input.eatPopupCount),
    ox + input.eatPopupX * TILE + TILE / 2,
    oy + input.eatPopupY * TILE + TILE / 2,
    speedPopupPose(input.eatPopup),
    '#ffe14a',
  );
}

function drawBouncingCallout(
  ctx: CanvasRenderingContext2D,
  text: string,
  sx: number,
  sy: number,
  pose: SpeedPopupPose,
  fill: string,
): void {
  if (pose.alpha <= 0.02) return;
  ctx.save();
  ctx.translate(sx, sy - 32 + pose.dy);
  ctx.scale(pose.scaleX, pose.scaleY);
  ctx.globalAlpha = pose.alpha;
  ctx.font = 'bold 26px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#1a0c00';
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = fill;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

interface GhostSprite {
  x: number;
  y: number;
  dir: Dir;
  color: string;
  mode: GhostMode;
  homeX: number;
  scale: number;
  alpha: number;
}

/**
 * House, the walk in, and the walk out can look frightened while a pellet is
 * running. `skipFright` keeps the normal body until that ghost leaves, so an
 * eaten ghost stays lethal-colored for the pellet that ate them. Eyes stay eyes.
 * The real mode is unchanged, so Pac still cannot eat a ghost in the house.
 */
export function ghostDrawMode(mode: GhostMode, skipFright: boolean, frightenedLeft: number): GhostMode {
  if (frightenedLeft <= 0 || skipFright) return mode;
  if (mode === 'house' || mode === 'entering' || mode === 'leaving') return 'frightened';
  return mode;
}

/** Calm followers are half size. A frightened leader makes the whole train full-size blue. */
export function trainFollowerLook(leaderFrightened: boolean): { mode: 'frightened' | 'chase'; scale: number } {
  if (leaderFrightened) return { mode: 'frightened', scale: 1 };
  return { mode: 'chase', scale: TRAIN_CALM_SCALE };
}

function drawGhost(ctx: CanvasRenderingContext2D, ghost: Ghost, input: DrawInput, ox: number, oy: number): void {
  drawGhostSprite(ctx, input, ox, oy, {
    x: ghost.x,
    y: ghost.y,
    dir: ghost.dir,
    color: ghost.color,
    mode: ghostDrawMode(ghost.mode, ghost.skipFright, input.frightened),
    homeX: ghost.homeX,
    scale: 1,
    alpha: 1,
  });
}

function drawGhostSprite(
  ctx: CanvasRenderingContext2D,
  input: DrawInput,
  ox: number,
  oy: number,
  sprite: GhostSprite,
): void {
  const flash = sprite.mode === 'frightened' && frightenedFlash(input.frightened, input.time);
  const body = sprite.mode === 'frightened' ? (flash ? '#f4f6ff' : '#2228e6') : sprite.color;
  const eyesOnly = sprite.mode === 'eaten';
  const s = SPRITE_SCALE * sprite.scale;
  ctx.save();
  ctx.globalAlpha = sprite.alpha;
  for (const point of spritePoints(sprite.x, sprite.y, input.maze)) {
    const sx = ox + point.x * TILE + TILE / 2;
    const sy = oy + point.y * TILE + TILE / 2;
    if (!eyesOnly) {
      const r = 7 * s;
      const wobble = Math.sin(input.time * 14 + sprite.homeX) > 0;
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(sx, sy - 1 * s, r, Math.PI, 0);
      ctx.lineTo(sx + r, sy + r * 0.75);
      ctx.lineTo(sx + r * 0.45, sy + (wobble ? r * 0.25 : r * 0.8));
      ctx.lineTo(sx, sy + (wobble ? r * 0.8 : r * 0.25));
      ctx.lineTo(sx - r * 0.45, sy + (wobble ? r * 0.25 : r * 0.8));
      ctx.lineTo(sx - r, sy + r * 0.75);
      ctx.closePath();
      ctx.fill();
    }
    drawEyes(ctx, sx, sy, sprite.dir, sprite.mode, eyesOnly, flash, s);
  }
  ctx.restore();
}

/**
 * Open ring over the ghost house. Full when a pellet is eaten, empty when the
 * timer ends. The center stays clear so the house shows through. No digits.
 */
function drawPelletClock(ctx: CanvasRenderingContext2D, frightened: number): void {
  const fill = pelletFill(frightened);
  if (fill <= 0) return;
  const { x: cx, y: cy } = ghostHouseCenter();
  const radius = 30;
  const width = 14;
  ctx.save();
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 225, 74, 0.22)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + fill * Math.PI * 2);
  ctx.strokeStyle = '#ffe14a';
  ctx.stroke();
  ctx.restore();
}

function drawEyes(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  dir: Dir,
  mode: GhostMode,
  eyesOnly: boolean,
  flash: boolean,
  s: number,
): void {
  const dx = dir.x * 1.6 * s;
  const dy = dir.y * 1.6 * s;
  for (const side of [-2.3 * s, 2.3 * s]) {
    const ex = sx + side;
    const ey = sy - 1.5 * s;
    if (mode === 'frightened' && !eyesOnly) {
      ctx.fillStyle = flash ? '#222244' : '#f4f6ff';
      ctx.fillRect(ex - 2 * s, ey - 1 * s, 3 * s, 3 * s);
      continue;
    }
    ctx.fillStyle = eyesOnly ? '#d7e4ff' : '#fff';
    ctx.beginPath();
    ctx.arc(ex, ey, (eyesOnly ? 3.1 : 2.3) * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a237e';
    ctx.beginPath();
    ctx.arc(ex + dx, ey + dy, 1.15 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPanel(ctx: CanvasRenderingContext2D, sim: Sim, time: number): void {
  if (sim.parked) return;
  const rect = panelRect(sim.id);
  const press = sim.alive ? Math.min(1, sim.pressure / 100) : 0;
  ctx.fillStyle = sim.alive ? '#101624' : '#141414';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  if (sim.alive && press > 0) {
    ctx.fillStyle = `rgba(180, 24, 40, ${0.2 + press * 0.55})`;
    ctx.fillRect(rect.x, rect.y + rect.h * (1 - press), rect.w, rect.h * press);
  }
  if (sim.alive) {
    ctx.strokeStyle = '#24345c';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const y = rect.y + 12 + i * 8;
      ctx.beginPath();
      ctx.moveTo(rect.x + 8, y);
      ctx.lineTo(rect.x + rect.w - 8, y);
      ctx.stroke();
    }
    const angle = time * 1.5 + sim.phase;
    ctx.fillStyle = '#ffe14a';
    ctx.beginPath();
    ctx.arc(rect.x + rect.w / 2 + Math.cos(angle) * 12, rect.y + rect.h / 2 + Math.sin(angle) * 8, 2.2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = '#6a3030';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rect.x + 16, rect.y + 14);
    ctx.lineTo(rect.x + rect.w - 16, rect.y + rect.h - 14);
    ctx.moveTo(rect.x + rect.w - 16, rect.y + 14);
    ctx.lineTo(rect.x + 16, rect.y + rect.h - 14);
    ctx.stroke();
  }
  if (sim.relief > 0) {
    ctx.fillStyle = `rgba(70, 220, 170, ${sim.relief * 0.55})`;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  if (sim.heat > 0) {
    ctx.fillStyle = `rgba(255, 244, 210, ${sim.heat * 0.72})`;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  ctx.lineWidth = sim.busy > 0.25 ? 2 : 1;
  ctx.strokeStyle = !sim.alive ? '#2a2a2a' : sim.busy > 0.25 ? '#ffd15c' : press > 0.2 ? '#ff5a62' : '#31456f';
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  ctx.fillStyle = sim.alive ? '#d5def0' : '#6a6a6a';
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  if (sim.showName) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x + 2, rect.y + rect.h - 13, rect.w - 4, 11);
    ctx.clip();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText(sim.name, rect.x + 3, rect.y + rect.h - 2);
    ctx.restore();
  } else {
    ctx.fillText(String(sim.id), rect.x + rect.w - 4, rect.y + 3);
  }
}

function wallColor(border: boolean, flash: number): string {
  if (flash <= 0.05) return border ? '#2c4bff' : '#16267a';
  return border ? '#ff6d88' : '#8a2452';
}

function drawIncoming(ctx: CanvasRenderingContext2D, shots: readonly IncomingShot[]): void {
  for (const shot of shots) {
    const eased = shot.t * shot.t * (3 - 2 * shot.t);
    const x = shot.sx + (shot.tx - shot.sx) * eased;
    const y = shot.sy + (shot.ty - shot.sy) * eased;
    ctx.strokeStyle = 'rgba(255, 236, 170, 0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(shot.sx, shot.sy);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.fillStyle = '#fff7d2';
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 90, 70, 0.9)';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, particles: readonly Particle[]): void {
  for (const particle of particles) {
    const alpha = Math.max(0, particle.life / particle.max);
    ctx.fillStyle = `rgba(255, 214, 120, ${alpha})`;
    ctx.fillRect(particle.x - 2, particle.y - 2, 4, 4);
  }
}

function drawBolts(ctx: CanvasRenderingContext2D, bolts: readonly Bolt[]): void {
  for (const bolt of bolts) {
    const eased = bolt.t * bolt.t * (3 - 2 * bolt.t);
    const x = bolt.sx + (bolt.tx - bolt.sx) * eased;
    const y = bolt.sy + (bolt.ty - bolt.sy) * eased;
    const scale = bolt.scale;
    ctx.fillStyle = 'rgba(255, 196, 40, 0.35)';
    ctx.beginPath();
    ctx.arc(x, y, 7 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff4c4';
    ctx.beginPath();
    ctx.arc(x, y, 3.2 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFruit(
  ctx: CanvasRenderingContext2D,
  fruit: { x: number; y: number },
  ox: number,
  oy: number,
): void {
  const cx = ox + fruit.x * TILE + TILE / 2;
  const cy = oy + fruit.y * TILE + TILE / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(FRUIT_DRAW_SCALE, FRUIT_DRAW_SCALE);
  ctx.strokeStyle = '#3d8f3a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.quadraticCurveTo(4, -8, 6, -7);
  ctx.stroke();
  ctx.fillStyle = '#e23b3b';
  ctx.beginPath();
  ctx.arc(-2.5, 1, 4.2, 0, Math.PI * 2);
  ctx.arc(2.2, 1.4, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function spritePoints(x: number, y: number, maze: Maze): { x: number; y: number }[] {
  const points = [{ x, y }];
  if (Math.round(y) !== maze.tunnelRow) return points;
  if (x < 1) points.push({ x: x + maze.cols, y });
  if (x > maze.cols - 2) points.push({ x: x - maze.cols, y });
  return points;
}

function isWalkable(maze: Maze, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= maze.cols || y >= maze.rows) return false;
  return !maze.blocks(x, y, 'pac');
}
