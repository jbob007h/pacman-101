import { TILE } from '../config';
import type { Ghost } from '../gameplay/ghosts';
import { frightenedFlash } from '../gameplay/ghosts';
import type { InboundJammer } from '../gameplay/inbound';
import type { Maze } from '../gameplay/maze';
import { Tile } from '../gameplay/maze';
import type { Pac } from '../gameplay/board';
import type { Sim } from '../systems/sims';
import type { Bolt } from './fx';
import { boardRect, panelRect } from './layout';

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
  frightened: number;
  deathTime: number;
  time: number;
  eatPause: number;
  eatPoints: number;
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

export function drawFrame(ctx: CanvasRenderingContext2D, input: DrawInput): void {
  const view = ctx.canvas;
  const width = view.width / (ctx.getTransform().a || 1);
  const height = view.height / (ctx.getTransform().d || 1);
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, width, height);

  for (const sim of input.sims) drawPanel(ctx, sim, input.time);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const board = boardRect();
  ctx.save();
  ctx.beginPath();
  ctx.rect(board.x, board.y, board.w, board.h);
  ctx.clip();
  ctx.fillStyle = '#00000c';
  ctx.fillRect(board.x, board.y, board.w, board.h);
  drawMaze(ctx, input.maze, board.x, board.y, input.time);
  if (input.fruit) drawFruit(ctx, input.fruit, board.x, board.y);
  for (const ghost of input.ghosts) drawGhost(ctx, ghost, input, board.x, board.y);
  drawPac(ctx, input, board.x, board.y);
  for (const jammer of input.jammers) drawJammer(ctx, jammer, input.maze, board.x, board.y, input.frightened > 0);
  drawEatScore(ctx, input, board.x, board.y);
  ctx.restore();

  ctx.strokeStyle = input.slow > 0 ? 'rgba(140, 190, 255, 0.9)' : '#243058';
  ctx.lineWidth = input.slow > 0 ? 4 : 2;
  ctx.strokeRect(board.x + 1, board.y + 1, board.w - 2, board.h - 2);
  if (input.slow > 0) {
    const alpha = 0.05 + 0.04 * Math.abs(Math.sin(input.time * 9));
    ctx.fillStyle = `rgba(80, 140, 255, ${alpha})`;
    ctx.fillRect(board.x, board.y, board.w, board.h);
  }

  drawBolts(ctx, input.bolts);
}

function drawMaze(ctx: CanvasRenderingContext2D, maze: Maze, ox: number, oy: number, time: number): void {
  for (let y = 0; y < maze.rows; y++) {
    for (let x = 0; x < maze.cols; x++) {
      const tile = maze.tile(x, y);
      const px = ox + x * TILE;
      const py = oy + y * TILE;
      if (tile === Tile.Wall) {
        const fill = wallFill(maze, x, y);
        const border = fill.w < TILE || fill.h < TILE;
        ctx.fillStyle = border ? '#2c4bff' : '#16267a';
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

function drawGhost(ctx: CanvasRenderingContext2D, ghost: Ghost, input: DrawInput, ox: number, oy: number): void {
  const flash = ghost.mode === 'frightened' && frightenedFlash(input.frightened, input.time);
  const body = ghost.mode === 'frightened' ? (flash ? '#f4f6ff' : '#2228e6') : ghost.color;
  const eyesOnly = ghost.mode === 'eaten';
  const s = SPRITE_SCALE;
  for (const point of spritePoints(ghost.x, ghost.y, input.maze)) {
    const sx = ox + point.x * TILE + TILE / 2;
    const sy = oy + point.y * TILE + TILE / 2;
    if (!eyesOnly) {
      const r = 7 * s;
      const wobble = Math.sin(input.time * 14 + ghost.homeX) > 0;
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
    drawEyes(ctx, sx, sy, ghost, eyesOnly, flash);
  }
}

function drawEyes(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ghost: Ghost,
  eyesOnly: boolean,
  flash: boolean,
): void {
  const s = SPRITE_SCALE;
  const dx = ghost.dir.x * 1.6 * s;
  const dy = ghost.dir.y * 1.6 * s;
  for (const side of [-2.3 * s, 2.3 * s]) {
    const ex = sx + side;
    const ey = sy - 1.5 * s;
    if (ghost.mode === 'frightened' && !eyesOnly) {
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
  ctx.fillText(String(sim.id), rect.x + rect.w - 4, rect.y + 3);
}

function drawBolts(ctx: CanvasRenderingContext2D, bolts: readonly Bolt[]): void {
  for (const bolt of bolts) {
    const eased = bolt.t * bolt.t * (3 - 2 * bolt.t);
    const x = bolt.sx + (bolt.tx - bolt.sx) * eased;
    const y = bolt.sy + (bolt.ty - bolt.sy) * eased;
    ctx.fillStyle = 'rgba(255, 196, 40, 0.35)';
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff4c4';
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
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
  ctx.strokeStyle = '#3d8f3a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 2);
  ctx.quadraticCurveTo(cx + 4, cy - 8, cx + 6, cy - 7);
  ctx.stroke();
  ctx.fillStyle = '#e23b3b';
  ctx.beginPath();
  ctx.arc(cx - 2.5, cy + 1, 4.2, 0, Math.PI * 2);
  ctx.arc(cx + 2.2, cy + 1.4, 4.2, 0, Math.PI * 2);
  ctx.fill();
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
