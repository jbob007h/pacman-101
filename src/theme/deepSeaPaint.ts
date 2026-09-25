import { FRUIT_DRAW_SCALE, SIDE_W, TILE } from '../config';
import { PAC_MODES } from '../gameplay/powerMode';
import type { Dir } from '../shared/types';
import { panelRect } from '../render/layout';
import type { ChaserPose, JammerPose, PlayerPose, ThemePaint, ThemeStrings } from './types';

const FRIGHT = '#8ec8e6';
const FRIGHT_FLASH = '#f7fbff';

/** Coral maze, sea creatures, urchins, and mines. Drawn with canvas paths only. */
export function createDeepSeaPaint(strings: ThemeStrings): ThemePaint {
  return {
    pageBackground(ctx, width, height) {
      fillVertical(ctx, 0, 0, width, height, ['#0a3d4c', '#06202c', '#021018']);
    },
    mazeBackground(ctx, board, time) {
      fillVertical(ctx, board.x, board.y, board.w, board.h, ['#0c4554', '#083044', '#041820']);
      ctx.save();
      ctx.globalAlpha = 0.065;
      ctx.fillStyle = '#d8fff6';
      for (let i = 0; i < 4; i++) {
        const drift = Math.sin(time * 0.18 + i * 1.3) * 16;
        const x = board.x + 36 + i * (board.w / 4) + drift;
        ctx.beginPath();
        ctx.moveTo(x, board.y);
        ctx.lineTo(x + 28, board.y);
        ctx.lineTo(x + 64, board.y + board.h);
        ctx.lineTo(x - 24, board.y + board.h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      for (let i = 0; i < 9; i++) {
        const speed = 12 + (i % 4) * 5;
        const y = board.y + board.h - ((time * speed + i * 52) % (board.h + 20));
        const x = board.x + 12 + ((i * 67 + Math.sin(time * 0.35 + i) * 14) % Math.max(1, board.w - 24));
        ctx.strokeStyle = 'rgba(190, 240, 255, 0.28)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 1.4 + (i % 3), 0, Math.PI * 2);
        ctx.stroke();
      }
    },
    wall(ctx, px, py, fill, flash) {
      const border = fill.w < TILE || fill.h < TILE;
      const hot = flash > 0.05;
      ctx.fillStyle = hot ? (border ? '#ffd0c2' : '#c45a6a') : border ? '#1c746c' : '#16344e';
      roundedRect(ctx, px + fill.x, py + fill.y, fill.w, fill.h, Math.min(4, fill.w / 2, fill.h / 2));
      ctx.fill();
      if (!border) return;
      ctx.fillStyle = hot ? '#fff4ea' : '#b6fff0';
      if (fill.edge.top) ctx.fillRect(px + fill.x, py + fill.y, fill.w, 2);
      if (fill.edge.bottom) ctx.fillRect(px + fill.x, py + fill.y + fill.h - 2, fill.w, 2);
      if (fill.edge.left) ctx.fillRect(px + fill.x, py + fill.y, 2, fill.h);
      if (fill.edge.right) ctx.fillRect(px + fill.x + fill.w - 2, py + fill.y, 2, fill.h);
    },
    door(ctx, px, py, time) {
      ctx.strokeStyle = '#1d6b3c';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(px + 1, py + TILE / 2);
      ctx.lineTo(px + TILE - 1, py + TILE / 2);
      ctx.stroke();
      ctx.strokeStyle = '#3dba6e';
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 5; i++) {
        const x = px + 2 + i * 3;
        const sway = Math.sin(time * 2.2 + i) * 1.6;
        ctx.beginPath();
        ctx.moveTo(x, py + TILE / 2 - 5);
        ctx.quadraticCurveTo(x + sway, py + TILE / 2, x - sway * 0.4, py + TILE / 2 + 5);
        ctx.stroke();
      }
    },
    dot(ctx, cx, cy, time) {
      const twinkle = 0.55 + Math.sin(time * 3 + cx * 0.2 + cy) * 0.2;
      ctx.fillStyle = `rgba(170, 255, 220, ${0.28 * twinkle})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(236, 255, 248, ${0.85 * twinkle})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 1.15, 0, Math.PI * 2);
      ctx.fill();
    },
    pellet(ctx, cx, cy, time) {
      const pulse = 4.2 + Math.sin(time * 6) * 0.8;
      ctx.fillStyle = 'rgba(210, 245, 255, 0.28)';
      ctx.beginPath();
      ctx.arc(cx, cy, pulse + 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d5f2ff';
      ctx.beginPath();
      ctx.arc(cx, cy, pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f7fdff';
      ctx.beginPath();
      ctx.arc(cx - pulse * 0.28, cy - pulse * 0.28, pulse * 0.38, 0, Math.PI * 2);
      ctx.fill();
    },
    player(ctx, pose) {
      drawFish(ctx, pose);
    },
    chaser(ctx, pose) {
      drawCreature(ctx, pose);
    },
    jammer(ctx, pose) {
      drawHazard(ctx, pose);
    },
    fruit(ctx, cx, cy, time) {
      drawStarfish(ctx, cx, cy, time);
    },
    panel(ctx, sim, time) {
      drawReefPanel(ctx, sim, time);
    },
    boardChrome(ctx, board, slow, time) {
      ctx.strokeStyle = slow > 0 ? 'rgba(160, 220, 255, 0.95)' : '#1e4e5c';
      ctx.lineWidth = slow > 0 ? 4 : 2;
      ctx.strokeRect(board.x + 1, board.y + 1, board.w - 2, board.h - 2);
      if (slow > 0) {
        const alpha = 0.05 + 0.04 * Math.abs(Math.sin(time * 9));
        ctx.fillStyle = `rgba(90, 170, 220, ${alpha})`;
        ctx.fillRect(board.x, board.y, board.w, board.h);
      }
    },
    bolt(ctx, x, y, scale) {
      ctx.fillStyle = 'rgba(160, 240, 255, 0.35)';
      ctx.beginPath();
      ctx.arc(x, y, 7 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(230, 255, 255, 0.9)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(x, y, 3.4 * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#f4fff8';
      ctx.beginPath();
      ctx.arc(x - scale, y - scale, 1.3 * scale, 0, Math.PI * 2);
      ctx.fill();
    },
    incoming(ctx, sx, sy, x, y) {
      ctx.strokeStyle = 'rgba(170, 240, 230, 0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(230, 255, 255, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 120, 110, 0.9)';
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    },
    particle(ctx, x, y, alpha) {
      ctx.strokeStyle = `rgba(210, 245, 255, ${alpha})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, y, 2.2 + (1 - alpha) * 2.4, 0, Math.PI * 2);
      ctx.stroke();
    },
    mazeFlash(ctx, board, flash) {
      ctx.fillStyle = `rgba(255, 196, 170, ${flash * 0.32})`;
      ctx.fillRect(board.x, board.y, board.w, board.h);
    },
    eatScore(ctx, text, sx, sy) {
      ctx.fillStyle = '#b7fff0';
      ctx.font = 'bold 13px "Trebuchet MS", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(text, sx, sy);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    },
    callout(ctx, text, fill) {
      ctx.font = 'bold 26px "Trebuchet MS", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#042028';
      ctx.strokeText(text, 0, 0);
      ctx.fillStyle = fill;
      ctx.fillText(text, 0, 0);
    },
    calloutFill: { speed: '#ffe09a', ko: '#ff5a62', eat: '#d8fff4' },
    powerModes(ctx, input) {
      const x = 6;
      const y = 6;
      const row = 16;
      const w = SIDE_W - 12;
      const h = 8 + PAC_MODES.length * row + 6;
      ctx.save();
      ctx.fillStyle = 'rgba(4, 24, 32, 0.74)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(150, 230, 214, 0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.font = '12px "Trebuchet MS", "Segoe UI", sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      for (let i = 0; i < PAC_MODES.length; i++) {
        const mode = PAC_MODES[i];
        if (!mode) continue;
        const active = input.powerActive === mode.id;
        const queued = input.powerQueued === mode.id && input.powerQueued !== input.powerActive;
        const ry = y + 6 + i * row;
        if (active) {
          ctx.fillStyle = 'rgba(255, 214, 140, 0.38)';
          ctx.fillRect(x + 3, ry, w - 6, row - 2);
        } else if (queued) {
          ctx.strokeStyle = 'rgba(140, 230, 255, 0.95)';
          ctx.strokeRect(x + 4, ry + 1, w - 8, row - 4);
        }
        ctx.fillStyle = active ? '#ffe09a' : queued ? '#c8f4ff' : 'rgba(230, 248, 244, 0.92)';
        ctx.textAlign = 'left';
        ctx.fillText(`${mode.key}  ${strings.modes[mode.id]}`, x + 8, ry + (row - 2) / 2);
        const tag = active ? strings.modeActive : queued ? strings.modeNext : '';
        if (tag) {
          ctx.textAlign = 'right';
          ctx.fillText(tag, x + w - 8, ry + (row - 2) / 2);
        }
      }
      ctx.restore();
    },
    pelletClock(ctx, cx, cy, fill) {
      ctx.save();
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, 30, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(210, 245, 255, 0.22)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 30, -Math.PI / 2, -Math.PI / 2 + fill * Math.PI * 2);
      ctx.strokeStyle = '#f4fbff';
      ctx.stroke();
      ctx.restore();
    },
  };
}

function fillVertical(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, stops: string[]): void {
  const gradient = ctx.createLinearGradient?.(x, y, x, y + h);
  if (gradient && typeof gradient.addColorStop === 'function') {
    stops.forEach((color, i) => gradient.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), color));
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = stops[stops.length - 1] ?? '#041820';
  }
  ctx.fillRect(x, y, w, h);
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawFish(ctx: CanvasRenderingContext2D, pose: PlayerPose): void {
  const { sx, sy, radius, mouth, facing, death, slow, anim, time } = pose;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(facing);
  ctx.globalAlpha *= 1 - death * 0.9;
  const r = radius;
  const body = slow ? '#9fd4ff' : '#ff9a1f';
  const belly = slow ? '#e7f6ff' : '#ffe14a';
  const fin = slow ? '#7ec8f0' : '#ff6a12';
  ctx.fillStyle = body;
  oval(ctx, -r * 0.02, 0, r * 1.02, r * 0.7);
  ctx.fillStyle = belly;
  oval(ctx, r * 0.08, r * 0.16, r * 0.55, r * 0.34);
  ctx.save();
  ctx.translate(-r * 0.92, 0);
  ctx.rotate(Math.sin(time * 14 + anim * 2.2) * 0.4);
  ctx.fillStyle = fin;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-r * 0.62, -r * 0.42);
  ctx.lineTo(-r * 0.48, 0);
  ctx.lineTo(-r * 0.62, r * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = fin;
  ctx.beginPath();
  ctx.moveTo(-r * 0.05, -r * 0.55);
  ctx.lineTo(r * 0.18, -r * 0.95);
  ctx.lineTo(r * 0.28, -r * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3a2208';
  ctx.beginPath();
  ctx.moveTo(r * 0.2, 0);
  ctx.arc(r * 0.15, 0, r * 0.5, -mouth * 0.95, mouth * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(r * 0.28, -r * 0.2, r * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a237e';
  ctx.beginPath();
  ctx.arc(r * 0.33, -r * 0.2, r * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (death <= 0) return;
  ctx.save();
  ctx.translate(sx, sy);
  for (let i = 0; i < 5; i++) {
    const rise = death * (18 + i * 7);
    const spread = Math.sin(time * 6 + i) * 8;
    ctx.globalAlpha = Math.max(0, 0.85 - death * 0.7);
    ctx.strokeStyle = '#e7fbff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(spread + (i - 2) * 5, -rise, 1.6 + i * 0.45, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCreature(ctx: CanvasRenderingContext2D, pose: ChaserPose): void {
  const { sx, sy, s, dir } = pose;
  const r = 7 * s;
  ctx.save();
  ctx.globalAlpha = pose.alpha;
  if (pose.eyesOnly) {
    ctx.strokeStyle = 'rgba(214, 244, 255, 0.9)';
    ctx.lineWidth = Math.max(1, 1.4 * s);
    ctx.beginPath();
    ctx.arc(sx, sy, r * 0.95, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(180, 230, 255, 0.16)';
    ctx.fill();
    drawLookEyes(ctx, sx, sy, dir, s, true);
    ctx.restore();
    return;
  }
  const frightened = pose.mode === 'frightened';
  const fill = frightened ? (pose.flash ? FRIGHT_FLASH : FRIGHT) : pose.color;
  const angle = Math.atan2(dir.y, dir.x);
  ctx.translate(sx, sy);
  ctx.rotate(angle);
  if (pose.species === 1) drawJelly(ctx, r, fill, pose.time, pose.homeX);
  else if (pose.species === 2) drawSquid(ctx, r, fill, pose.time, pose.homeX);
  else if (pose.species === 3) drawAngler(ctx, r, fill, pose.time);
  else drawShark(ctx, r, fill, pose.time, pose.homeX);
  if (frightened) drawScaredFace(ctx, r, pose.flash);
  else drawLocalEye(ctx, r);
  ctx.restore();
}

function drawShark(ctx: CanvasRenderingContext2D, r: number, fill: string, time: number, phase: number): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(r * 1.2, 0);
  ctx.quadraticCurveTo(r * 0.35, -r * 0.72, -r * 0.45, -r * 0.38);
  ctx.lineTo(-r * 1.05, -r * 0.62 + Math.sin(time * 10 + phase) * r * 0.08);
  ctx.lineTo(-r * 0.62, 0);
  ctx.lineTo(-r * 1.05, r * 0.62 + Math.sin(time * 10 + phase) * r * 0.08);
  ctx.lineTo(-r * 0.45, r * 0.38);
  ctx.quadraticCurveTo(r * 0.35, r * 0.72, r * 1.2, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-r * 0.05, -r * 0.4);
  ctx.lineTo(r * 0.12, -r * 1.02);
  ctx.lineTo(r * 0.42, -r * 0.32);
  ctx.fill();
}

function drawJelly(ctx: CanvasRenderingContext2D, r: number, fill: string, time: number, phase: number): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(r * 0.15, 0, r * 0.72, Math.PI * 0.5, Math.PI * 1.5);
  ctx.quadraticCurveTo(r * 0.15, -r * 0.15, -r * 0.05, -r * 0.42);
  ctx.quadraticCurveTo(-r * 0.2, -r * 0.1, -r * 0.05, 0);
  ctx.quadraticCurveTo(-r * 0.2, r * 0.1, -r * 0.05, r * 0.42);
  ctx.quadraticCurveTo(r * 0.15, r * 0.15, r * 0.15, r * 0.72);
  ctx.fill();
  ctx.save();
  ctx.strokeStyle = fill;
  ctx.lineWidth = Math.max(1, r * 0.07);
  ctx.globalAlpha *= 0.9;
  for (let i = -2; i <= 2; i++) {
    const y = i * r * 0.22;
    const wave = Math.sin(time * 6 + phase + i) * r * 0.16;
    ctx.beginPath();
    ctx.moveTo(-r * 0.05, y);
    ctx.quadraticCurveTo(-r * 0.55, y + wave, -r * 1.15, y - wave);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSquid(ctx: CanvasRenderingContext2D, r: number, fill: string, time: number, phase: number): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(r * 0.95, 0);
  ctx.quadraticCurveTo(r * 0.2, -r * 0.85, -r * 0.35, -r * 0.45);
  ctx.quadraticCurveTo(-r * 0.15, 0, -r * 0.35, r * 0.45);
  ctx.quadraticCurveTo(r * 0.2, r * 0.85, r * 0.95, 0);
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.strokeStyle = fill;
  for (let i = -2; i <= 2; i++) {
    const y = i * r * 0.18;
    const wave = Math.sin(time * 7 + phase + i * 0.8) * r * 0.12;
    ctx.beginPath();
    ctx.moveTo(-r * 0.25, y * 0.7);
    ctx.quadraticCurveTo(-r * 0.7, y + wave, -r * 1.1, y * 1.1 - wave);
    ctx.stroke();
  }
}

function drawAngler(ctx: CanvasRenderingContext2D, r: number, fill: string, time: number): void {
  ctx.fillStyle = fill;
  oval(ctx, -r * 0.05, 0, r * 0.95, r * 0.78);
  ctx.beginPath();
  ctx.moveTo(r * 0.35, -r * 0.15);
  ctx.lineTo(r * 1.15, -r * 0.28);
  ctx.lineTo(r * 1.15, r * 0.22);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = fill;
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.beginPath();
  ctx.moveTo(r * 0.1, -r * 0.7);
  ctx.quadraticCurveTo(r * 0.45, -r * 1.15, r * 0.15, -r * 1.35);
  ctx.stroke();
  const glow = 0.65 + Math.sin(time * 5) * 0.35;
  ctx.fillStyle = `rgba(255, 244, 180, ${glow})`;
  ctx.beginPath();
  ctx.arc(r * 0.15, -r * 1.4, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff8d0';
  ctx.beginPath();
  ctx.arc(r * 0.1, -r * 1.46, r * 0.08, 0, Math.PI * 2);
  ctx.fill();
}

function drawLocalEye(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(r * 0.35, -r * 0.16, r * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#14233a';
  ctx.beginPath();
  ctx.arc(r * 0.42, -r * 0.16, r * 0.07, 0, Math.PI * 2);
  ctx.fill();
}

function drawScaredFace(ctx: CanvasRenderingContext2D, r: number, flash: boolean): void {
  const eye = flash ? '#1a2744' : '#f7fbff';
  const pupil = flash ? '#f7fbff' : '#1a2744';
  for (const side of [-0.22, 0.22]) {
    ctx.fillStyle = eye;
    oval(ctx, r * 0.28, side * r, r * 0.16, r * 0.2);
    ctx.fillStyle = pupil;
    ctx.beginPath();
    ctx.arc(r * 0.3, side * r + r * 0.05, r * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = eye;
  ctx.lineWidth = Math.max(1, r * 0.07);
  ctx.beginPath();
  ctx.arc(r * 0.42, r * 0.28, r * 0.16, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
}

function drawLookEyes(ctx: CanvasRenderingContext2D, sx: number, sy: number, dir: Dir, s: number, eyesOnly: boolean): void {
  const dx = dir.x * 1.6 * s;
  const dy = dir.y * 1.6 * s;
  for (const side of [-2.3 * s, 2.3 * s]) {
    const ex = sx + side;
    const ey = sy - 1.2 * s;
    ctx.fillStyle = eyesOnly ? '#e7f6ff' : '#fff';
    ctx.beginPath();
    ctx.arc(ex, ey, (eyesOnly ? 3.1 : 2.3) * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a237e';
    ctx.beginPath();
    ctx.arc(ex + dx, ey + dy, 1.15 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHazard(ctx: CanvasRenderingContext2D, pose: JammerPose): void {
  const { kind, frozen, s } = pose;
  const mine = kind === 'red';
  const body = frozen ? '#b7e6ff' : mine ? '#e4232e' : '#f4f7f2';
  const spike = frozen ? '#e8f7ff' : mine ? '#ffd0d4' : '#c5ddd4';
  const count = mine ? 12 : 16;
  const inner = (mine ? 5.4 : 5.8) * s;
  const outer = (mine ? 10.4 : 8.2) * s;
  ctx.fillStyle = frozen ? 'rgba(170, 220, 255, 0.4)' : mine ? 'rgba(255, 40, 50, 0.35)' : 'rgba(230, 255, 245, 0.4)';
  ctx.beginPath();
  ctx.arc(0, 0, 11 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = spike;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (mine ? 0.12 : 0);
    const spread = mine ? 0.16 : 0.09;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a - spread) * inner, Math.sin(a - spread) * inner);
    ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
    ctx.lineTo(Math.cos(a + spread) * inner, Math.sin(a + spread) * inner);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, inner, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = frozen ? '#f4fbff' : mine ? '#ffd8dc' : '#9ec8bc';
  ctx.lineWidth = 1.4 * s;
  ctx.stroke();
  if (mine && !frozen) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, 0, 1.5 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawStarfish(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.sin(time * 1.4) * 0.08);
  ctx.scale(FRUIT_DRAW_SCALE, FRUIT_DRAW_SCALE);
  ctx.fillStyle = '#ffb03a';
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    const b = a + Math.PI / 5;
    const outer = i === 0 ? 7.2 : 6.6;
    ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
    ctx.lineTo(Math.cos(b) * 2.6, Math.sin(b) * 2.6);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffe0a0';
  ctx.beginPath();
  ctx.arc(0, 0, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawReefPanel(
  ctx: CanvasRenderingContext2D,
  sim: {
    id: number;
    name: string;
    alive: boolean;
    pressure: number;
    heat: number;
    busy: number;
    relief: number;
    phase: number;
    showName: boolean;
    koByYou: boolean;
  },
  time: number,
): void {
  const rect = panelRect(sim.id);
  const press = sim.alive ? Math.min(1, sim.pressure / 100) : 0;
  ctx.fillStyle = sim.alive ? '#072636' : '#121816';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  if (sim.alive && press > 0) {
    ctx.fillStyle = `rgba(180, 24, 40, ${0.2 + press * 0.55})`;
    ctx.fillRect(rect.x, rect.y + rect.h * (1 - press), rect.w, rect.h * press);
  }
  if (sim.alive) {
    ctx.strokeStyle = '#1c5a66';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const y = rect.y + 12 + i * 8;
      ctx.beginPath();
      ctx.moveTo(rect.x + 8, y);
      ctx.lineTo(rect.x + rect.w - 8, y);
      ctx.stroke();
    }
    const angle = time * 1.5 + sim.phase;
    ctx.fillStyle = '#ff9a1f';
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
  ctx.strokeStyle = !sim.alive ? '#24302e' : sim.busy > 0.25 ? '#ffd15c' : press > 0.2 ? '#ff5a62' : '#2f6a74';
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  if (sim.koByYou) {
    ctx.strokeStyle = '#ff2a36';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(rect.x + 8, rect.y + 8);
    ctx.lineTo(rect.x + rect.w - 8, rect.y + rect.h - 8);
    ctx.moveTo(rect.x + rect.w - 8, rect.y + 8);
    ctx.lineTo(rect.x + 8, rect.y + rect.h - 8);
    ctx.stroke();
  }
  ctx.fillStyle = sim.alive ? '#dff8f2' : '#6a7a78';
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

function oval(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(Math.max(0.001, rx), Math.max(0.001, ry));
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
