import { VIEW_H, VIEW_W } from './config';
import { Game } from './game';
import { dirFromKey, type Dir } from './shared/types';
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#view');
const aliveEl = document.querySelector<HTMLElement>('#alive');
const scoreEl = document.querySelector<HTMLElement>('#score');
const statusEl = document.querySelector<HTMLElement>('#status');
const overlayEl = document.querySelector<HTMLElement>('#overlay');
const overlayTitle = document.querySelector<HTMLElement>('#overlay-title');
const overlayBody = document.querySelector<HTMLElement>('#overlay-body');
const restartButtons = document.querySelectorAll<HTMLButtonElement>('#restart, #overlay-restart');

if (!canvas || !aliveEl || !scoreEl || !statusEl || !overlayEl || !overlayTitle || !overlayBody) {
  throw new Error('101 is missing required DOM nodes');
}

const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Canvas 2D is unavailable');

const game = new Game();
let direction: Dir | null = null;

function resize(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas!.width = Math.round(VIEW_W * dpr);
  canvas!.height = Math.round(VIEW_H * dpr);
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function syncHud(): void {
  const hud = game.hud();
  aliveEl!.textContent = String(hud.remaining);
  scoreEl!.textContent = String(hud.score);
  statusEl!.textContent = hud.status;
  document.body.dataset.phase = hud.phase;
  document.body.dataset.remaining = String(hud.remaining);
  if (hud.overlay) {
    overlayTitle!.textContent = hud.overlay.title;
    overlayBody!.textContent = hud.overlay.body;
    overlayEl!.hidden = false;
  } else {
    overlayEl!.hidden = true;
  }
}

function restart(): void {
  direction = null;
  game.restart();
  syncHud();
}

function onKeyDown(event: KeyboardEvent): void {
  const next = dirFromKey(event.key);
  if (next) {
    event.preventDefault();
    direction = next;
    return;
  }
  if (event.key === 'r' || event.key === 'R') {
    event.preventDefault();
    restart();
  }
}

window.addEventListener('keydown', onKeyDown);
for (const button of restartButtons) button.addEventListener('click', restart);
window.addEventListener('resize', resize);
resize();
syncHud();

let last = performance.now();
function frame(now: number): void {
  const dt = document.hidden ? 0 : Math.min(0.05, (now - last) / 1000);
  last = now;
  game.setDirection(direction);
  game.update(dt);
  game.draw(ctx!);
  syncHud();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
