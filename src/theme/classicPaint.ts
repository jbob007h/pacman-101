import { FRUIT_DRAW_SCALE, SIDE_W, TILE } from '../config';
import { PAC_MODES } from '../gameplay/powerMode';
import type { GhostMode } from '../gameplay/ghosts';
import type { Dir } from '../shared/types';
import { panelRect } from '../render/layout';
import type { ChaserPose, JammerPose, ThemePaint, ThemeStrings } from './types';

/** The maze, actors, and HUD as they look today. */
export function createClassicPaint(strings: ThemeStrings): ThemePaint {
  return {
    pageBackground(ctx, width, height) {
      ctx.fillStyle = '#070b14';
      ctx.fillRect(0, 0, width, height);
    },
    mazeBackground(ctx, board) {
      ctx.fillStyle = '#00000c';
      ctx.fillRect(board.x, board.y, board.w, board.h);
    },
    wall(ctx, px, py, fill, flash) {
      const border = fill.w < TILE || fill.h < TILE;
      ctx.fillStyle = wallColor(border, flash);
      ctx.fillRect(px + fill.x, py + fill.y, fill.w, fill.h);
      if (!border) return;
      ctx.fillStyle = '#8eabff';
      if (fill.edge.top) ctx.fillRect(px + fill.x, py + fill.y, fill.w, 2);
      if (fill.edge.bottom) ctx.fillRect(px + fill.x, py + fill.y + fill.h - 2, fill.w, 2);
      if (fill.edge.left) ctx.fillRect(px + fill.x, py + fill.y, 2, fill.h);
      if (fill.edge.right) ctx.fillRect(px + fill.x + fill.w - 2, py + fill.y, 2, fill.h);
    },
    door(ctx, px, py) {
      ctx.fillStyle = '#ffb4cc';
      ctx.fillRect(px, py + TILE / 2 - 2, TILE, 4);
    },
    dot(ctx, cx, cy) {
      ctx.fillStyle = '#ffc2a8';
      ctx.beginPath();
      ctx.arc(cx, cy, 1.7, 0, Math.PI * 2);
      ctx.fill();
    },
    pellet(ctx, cx, cy, time) {
      const pulse = 4.2 + Math.sin(time * 6) * 0.8;
      ctx.fillStyle = 'rgba(255, 214, 120, 0.28)';
      ctx.beginPath();
      ctx.arc(cx, cy, pulse + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffe14a';
      ctx.beginPath();
      ctx.arc(cx, cy, pulse, 0, Math.PI * 2);
      ctx.fill();
    },
    player(ctx, pose) {
      ctx.fillStyle = pose.slow ? '#9fd4ff' : '#ffe14a';
      ctx.beginPath();
      ctx.moveTo(pose.sx, pose.sy);
      ctx.arc(pose.sx, pose.sy, pose.radius, pose.facing + pose.mouth, pose.facing + Math.PI * 2 - pose.mouth);
      ctx.closePath();
      ctx.fill();
    },
    chaser(ctx, pose) {
      drawClassicChaser(ctx, pose);
    },
    jammer(ctx, pose) {
      drawClassicJammer(ctx, pose);
    },
    fruit(ctx, cx, cy) {
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
    },
    panel(ctx, sim, time) {
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
    },
    boardChrome(ctx, board, slow, time) {
      ctx.strokeStyle = slow > 0 ? 'rgba(140, 190, 255, 0.9)' : '#243058';
      ctx.lineWidth = slow > 0 ? 4 : 2;
      ctx.strokeRect(board.x + 1, board.y + 1, board.w - 2, board.h - 2);
      if (slow > 0) {
        const alpha = 0.05 + 0.04 * Math.abs(Math.sin(time * 9));
        ctx.fillStyle = `rgba(80, 140, 255, ${alpha})`;
        ctx.fillRect(board.x, board.y, board.w, board.h);
      }
    },
    bolt(ctx, x, y, scale) {
      ctx.fillStyle = 'rgba(255, 196, 40, 0.35)';
      ctx.beginPath();
      ctx.arc(x, y, 7 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff4c4';
      ctx.beginPath();
      ctx.arc(x, y, 3.2 * scale, 0, Math.PI * 2);
      ctx.fill();
    },
    incoming(ctx, sx, sy, x, y) {
      ctx.strokeStyle = 'rgba(255, 236, 170, 0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
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
    },
    particle(ctx, x, y, alpha) {
      ctx.fillStyle = `rgba(255, 214, 120, ${alpha})`;
      ctx.fillRect(x - 2, y - 2, 4, 4);
    },
    mazeFlash(ctx, board, flash) {
      ctx.fillStyle = `rgba(255, 70, 90, ${flash * 0.34})`;
      ctx.fillRect(board.x, board.y, board.w, board.h);
    },
    eatScore(ctx, text, sx, sy) {
      ctx.fillStyle = '#9fd4ff';
      ctx.font = 'bold 13px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(text, sx, sy);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    },
    callout(ctx, text, fill) {
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
    },
    calloutFill: { speed: '#ffe14a', ko: '#ff2a36', eat: '#ffe14a' },
    powerModes(ctx, input) {
      const x = 6;
      const y = 6;
      const row = 16;
      const w = SIDE_W - 12;
      const h = 8 + PAC_MODES.length * row + 6;
      ctx.save();
      ctx.fillStyle = 'rgba(7, 11, 20, 0.72)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(186, 206, 255, 0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.font = '12px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      for (let i = 0; i < PAC_MODES.length; i++) {
        const mode = PAC_MODES[i];
        if (!mode) continue;
        const active = input.powerActive === mode.id;
        const queued = input.powerQueued === mode.id && input.powerQueued !== input.powerActive;
        const ry = y + 6 + i * row;
        if (active) {
          ctx.fillStyle = 'rgba(255, 214, 74, 0.38)';
          ctx.fillRect(x + 3, ry, w - 6, row - 2);
        } else if (queued) {
          ctx.strokeStyle = 'rgba(120, 210, 255, 0.95)';
          ctx.strokeRect(x + 4, ry + 1, w - 8, row - 4);
        }
        ctx.fillStyle = active ? '#ffe14a' : queued ? '#b7e6ff' : 'rgba(236, 240, 255, 0.92)';
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
    },
  };
}

function wallColor(border: boolean, flash: number): string {
  if (flash <= 0.05) return border ? '#2c4bff' : '#16267a';
  return border ? '#ff6d88' : '#8a2452';
}

function drawClassicChaser(ctx: CanvasRenderingContext2D, pose: ChaserPose): void {
  const { sx, sy, dir, mode, eyesOnly, flash, s } = pose;
  const body = mode === 'frightened' ? (flash ? '#f4f6ff' : '#2228e6') : pose.color;
  ctx.save();
  ctx.globalAlpha = pose.alpha;
  if (!eyesOnly) {
    const r = 7 * s;
    const wobble = Math.sin(pose.time * 14 + pose.homeX) > 0;
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
  drawEyes(ctx, sx, sy, dir, mode, eyesOnly, flash, s);
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

function drawClassicJammer(ctx: CanvasRenderingContext2D, pose: JammerPose): void {
  const { kind, frozen, s } = pose;
  const color = frozen ? '#8fd0ff' : kind === 'red' ? '#ff2a36' : '#ffffff';
  const ring = frozen ? '#e8f6ff' : kind === 'red' ? '#ffd2d6' : '#1a2748';
  const glow = frozen ? 'rgba(140, 210, 255, 0.45)' : kind === 'red' ? 'rgba(255, 40, 54, 0.45)' : 'rgba(255, 255, 255, 0.55)';
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, 11 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, 6.4 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ring;
  ctx.lineWidth = 2 * s;
  ctx.stroke();
  ctx.strokeStyle = kind === 'red' ? '#fff' : '#ff2a36';
  ctx.lineWidth = 1.6 * s;
  ctx.beginPath();
  if (kind === 'red') {
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
}
