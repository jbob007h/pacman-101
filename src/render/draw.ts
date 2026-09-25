import { pelletFill, SPEED_POPUP_SECONDS, TILE } from '../config';
import type { PacMode } from '../gameplay/powerMode';
import type { Ghost, GhostMode } from '../gameplay/ghosts';
import { frightenedFlash } from '../gameplay/ghosts';
import { TRAIN_CALM_SCALE, type TrainFollower } from '../gameplay/train';
import type { Dir, GhostId } from '../shared/types';
import type { InboundJammer } from '../gameplay/inbound';
import type { Maze } from '../gameplay/maze';
import { Tile } from '../gameplay/maze';
import type { Pac } from '../gameplay/board';
import type { Sim } from '../systems/sims';
import type { Bolt, IncomingShot, Particle } from './fx';
import { boardRect, ghostHouseCenter } from './layout';
import { SPRITE_SCALE } from './sprite';
import { wallFill } from './walls';
import { activeTheme } from '../theme';

export { SPRITE_SCALE } from './sprite';
export { wallFill } from './walls';
export type { WallFill } from './walls';

/** Classic callout. Themes may restyle it; the words stay on the theme string table. */
export const SPEED_POPUP_TEXT = 'Speed Up!';

const SPECIES: Record<GhostId, number> = { blinky: 0, pinky: 1, inky: 2, clyde: 3 };

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
  /** Duration of the pellet that started {@link frightened}. The ring drains against this. */
  pelletDuration: number;
  powerActive: PacMode;
  powerQueued: PacMode;
  deathTime: number;
  time: number;
  eatPause: number;
  eatPoints: number;
  /** Seconds remaining on the full-clear "Speed Up!" callout. 0 hides it. */
  speedPopup: number;
  /** Seconds remaining on the single ghost-eat count. 0 hides it. */
  eatPopup: number;
  /** Seconds remaining on the "K.O." callout. 0 hides it. Drawn above the side grids. */
  koPopup?: number;
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

/** Tests tag actors here so a theme can change the silhouette without breaking layer checks. */
function markActor(ctx: CanvasRenderingContext2D, actor: string): void {
  const tagged = ctx as CanvasRenderingContext2D & { markActor?: (actor: string) => void };
  tagged.markActor?.(actor);
}

export function drawFrame(ctx: CanvasRenderingContext2D, input: DrawInput): void {
  const split = openSplit(ctx);
  const theme = activeTheme();
  if (split) {
    const t = copyTransform(ctx, split.panels);
    copyTransform(ctx, split.maze);
    copyTransform(ctx, split.overlay);
    paintScene(split.panels, split.maze, split.overlay, input, false);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    theme.paint.pageBackground(ctx, ctx.canvas.width, ctx.canvas.height);
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
    activeTheme().paint.pageBackground(panelCtx, width, height);
  }
  shake(panelCtx, () => {
    for (const sim of input.sims) {
      if (sim.parked) continue;
      activeTheme().paint.panel(panelCtx, sim, input.time);
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
  const theme = activeTheme();
  ctx.save();
  ctx.beginPath();
  ctx.rect(board.x, board.y, board.w, board.h);
  ctx.clip();
  theme.paint.mazeBackground(ctx, board, input.time);
  drawMaze(ctx, input.maze, board.x, board.y, input.time, input.mazeFlash);
  if (input.fruit) theme.paint.fruit(ctx, board.x + input.fruit.x * TILE + TILE / 2, board.y + input.fruit.y * TILE + TILE / 2, input.time);
  for (const sleeper of input.sleepers) {
    drawChaser(ctx, input, board.x, board.y, {
      x: sleeper.x,
      y: sleeper.y,
      dir: { x: 0, y: 1 },
      color: theme.sleeperColor,
      mode: 'chase',
      homeX: sleeper.x + sleeper.y,
      scale: 0.62,
      alpha: 1,
      species: Math.abs(Math.round(sleeper.x) + Math.round(sleeper.y) * 3) % 4,
    });
  }
  // Jammers sit under the board's own ghosts so the four chasers
  // (frightened and eaten eyes included) stay readable when a jammer overlaps them.
  for (const jammer of input.jammers) drawJammer(ctx, jammer, input.maze, board.x, board.y, input.frightened > 0, input.time);
  for (const ghost of input.ghosts) drawGhost(ctx, ghost, input, board.x, board.y);
  const leader = input.ghosts.find((ghost) => ghost.id === input.trainLeaderId);
  const trainFright = leader?.mode === 'frightened';
  const look = trainFollowerLook(trainFright);
  input.train.forEach((follower, index) => {
    drawChaser(ctx, input, board.x, board.y, {
      x: follower.x,
      y: follower.y,
      dir: follower.dir,
      color: theme.trainColor(index, input.train.length),
      mode: look.mode,
      homeX: follower.id,
      scale: look.scale,
      alpha: 1,
      species: index % 4,
    });
  });
  drawPac(ctx, input, board.x, board.y);
  const fill = pelletFill(input.frightened, input.pelletDuration);
  if (fill > 0) {
    const house = ghostHouseCenter();
    theme.paint.pelletClock(ctx, house.x, house.y, fill);
  }
  ctx.restore();
}

function drawBoardChrome(
  ctx: CanvasRenderingContext2D,
  input: DrawInput,
  board: { x: number; y: number; w: number; h: number },
): void {
  activeTheme().paint.boardChrome(ctx, board, input.slow, input.time);
}

/** Bolts, impacts, and the hit flash. Drawn after the grids so they cross the gutters. */
function drawPlayfieldFx(
  ctx: CanvasRenderingContext2D,
  input: DrawInput,
  board: { x: number; y: number; w: number; h: number },
): void {
  const paint = activeTheme().paint;
  for (const bolt of input.bolts) {
    const eased = bolt.t * bolt.t * (3 - 2 * bolt.t);
    const x = bolt.sx + (bolt.tx - bolt.sx) * eased;
    const y = bolt.sy + (bolt.ty - bolt.sy) * eased;
    markActor(ctx, 'bolt');
    paint.bolt(ctx, x, y, bolt.scale);
  }
  for (const shot of input.incoming) {
    const eased = shot.t * shot.t * (3 - 2 * shot.t);
    const x = shot.sx + (shot.tx - shot.sx) * eased;
    const y = shot.sy + (shot.ty - shot.sy) * eased;
    paint.incoming(ctx, shot.sx, shot.sy, x, y);
  }
  for (const particle of input.particles) {
    const alpha = Math.max(0, particle.life / particle.max);
    paint.particle(ctx, particle.x, particle.y, alpha);
  }
  if (input.mazeFlash > 0) paint.mazeFlash(ctx, board, input.mazeFlash);
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
  const theme = activeTheme();
  if (input.eatPause > 0 && input.eatPoints > 0) {
    const pac = input.pac;
    theme.paint.eatScore(
      ctx,
      String(input.eatPoints),
      board.x + pac.x * TILE + TILE / 2,
      board.y + pac.y * TILE + TILE / 2 - 14 * SPRITE_SCALE,
    );
  }
  if (input.speedPopup > 0) {
    const pac = input.pac;
    drawBouncingCallout(
      ctx,
      theme.strings.speedUp,
      board.x + pac.x * TILE + TILE / 2,
      board.y + pac.y * TILE + TILE / 2,
      speedPopupPose(input.speedPopup),
      theme.paint.calloutFill.speed,
    );
  }
  if (input.eatPopup > 0 && input.eatPopupCount > 0) {
    drawBouncingCallout(
      ctx,
      String(input.eatPopupCount),
      board.x + input.eatPopupX * TILE + TILE / 2,
      board.y + input.eatPopupY * TILE + TILE / 2,
      speedPopupPose(input.eatPopup),
      theme.paint.calloutFill.eat,
    );
  }
  const ko = input.koPopup ?? 0;
  if (ko > 0) {
    drawBouncingCallout(
      ctx,
      theme.strings.koCallout,
      board.x + board.w / 2,
      board.y + 28,
      speedPopupPose(ko),
      theme.paint.calloutFill.ko,
    );
  }
  theme.paint.powerModes(ctx, input);
}

function drawMaze(ctx: CanvasRenderingContext2D, maze: Maze, ox: number, oy: number, time: number, flash: number): void {
  const paint = activeTheme().paint;
  for (let y = 0; y < maze.rows; y++) {
    for (let x = 0; x < maze.cols; x++) {
      const tile = maze.tile(x, y);
      const px = ox + x * TILE;
      const py = oy + y * TILE;
      if (tile === Tile.Wall) {
        paint.wall(ctx, px, py, wallFill(maze, x, y), flash);
        continue;
      }
      if (tile === Tile.Door) {
        paint.door(ctx, px, py, time);
        continue;
      }
      if (tile === Tile.Dot) paint.dot(ctx, px + TILE / 2, py + TILE / 2, time);
      else if (tile === Tile.Pellet) paint.pellet(ctx, px + TILE / 2, py + TILE / 2, time);
    }
  }
}

function drawPac(ctx: CanvasRenderingContext2D, input: DrawInput, ox: number, oy: number): void {
  const pac = input.pac;
  const death = pac.alive ? 0 : Math.min(1, input.deathTime / 0.9);
  const radius = 7.1 * SPRITE_SCALE * (1 - death * 0.85);
  const mouth = pac.alive ? 0.08 + Math.abs(Math.sin(pac.anim * 2.2)) * 0.42 : 0.9;
  const facing = (pac.dir.x === 0 && pac.dir.y === 0 ? Math.PI : Math.atan2(pac.dir.y, pac.dir.x)) + death * Math.PI * 2;
  const paint = activeTheme().paint;
  for (const point of spritePoints(pac.x, pac.y, input.maze)) {
    markActor(ctx, 'pac');
    paint.player(ctx, {
      sx: ox + point.x * TILE + TILE / 2,
      sy: oy + point.y * TILE + TILE / 2,
      radius,
      mouth,
      facing,
      death,
      slow: input.slow > 0,
      anim: pac.anim,
      time: input.time,
    });
  }
}

function drawJammer(
  ctx: CanvasRenderingContext2D,
  jammer: InboundJammer,
  maze: Maze,
  ox: number,
  oy: number,
  frightened: boolean,
  time: number,
): void {
  let scale = 1;
  let alpha = 1;
  if (jammer.phase === 'spawn') scale = jammerSpawnScale(jammer.anim);
  else if (jammer.phase === 'dying') {
    scale = 1 - 0.75 * jammer.anim;
    alpha = 1 - jammer.anim;
  }
  const frozen = jammer.kind === 'red' && frightened && jammer.phase === 'live';
  const paint = activeTheme().paint;
  for (const point of spritePoints(jammer.x, jammer.y, maze)) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(ox + point.x * TILE + TILE / 2, oy + point.y * TILE + TILE / 2);
    ctx.scale(scale, scale);
    markActor(ctx, 'jammer');
    paint.jammer(ctx, { kind: jammer.kind, frozen, s: SPRITE_SCALE, time });
    ctx.restore();
  }
}

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
  activeTheme().paint.callout(ctx, text, fill);
  ctx.restore();
}

interface ChaserSprite {
  x: number;
  y: number;
  dir: Dir;
  color: string;
  mode: GhostMode;
  homeX: number;
  scale: number;
  alpha: number;
  species: number;
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
  drawChaser(ctx, input, ox, oy, {
    x: ghost.x,
    y: ghost.y,
    dir: ghost.dir,
    color: activeTheme().ghostColor(ghost.id),
    mode: ghostDrawMode(ghost.mode, ghost.skipFright, input.frightened),
    homeX: ghost.homeX,
    scale: 1,
    alpha: 1,
    species: SPECIES[ghost.id],
  });
}

function drawChaser(
  ctx: CanvasRenderingContext2D,
  input: DrawInput,
  ox: number,
  oy: number,
  sprite: ChaserSprite,
): void {
  const flash = sprite.mode === 'frightened' && frightenedFlash(input.frightened, input.time);
  const eyesOnly = sprite.mode === 'eaten';
  const paint = activeTheme().paint;
  for (const point of spritePoints(sprite.x, sprite.y, input.maze)) {
    markActor(ctx, eyesOnly ? 'eyes' : 'ghost');
    paint.chaser(ctx, {
      sx: ox + point.x * TILE + TILE / 2,
      sy: oy + point.y * TILE + TILE / 2,
      dir: sprite.dir,
      color: sprite.color,
      mode: sprite.mode,
      flash,
      eyesOnly,
      s: SPRITE_SCALE * sprite.scale,
      homeX: sprite.homeX,
      time: input.time,
      species: sprite.species,
      alpha: sprite.alpha,
    });
  }
}

function spritePoints(x: number, y: number, maze: Maze): { x: number; y: number }[] {
  const points = [{ x, y }];
  if (Math.round(y) !== maze.tunnelRow) return points;
  if (x < 1) points.push({ x: x + maze.cols, y });
  if (x > maze.cols - 2) points.push({ x: x - maze.cols, y });
  return points;
}
