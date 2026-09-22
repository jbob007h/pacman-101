import { VIEW_H, VIEW_W } from './config';
import { Game } from './game';
import { dirFromKey, type Dir } from './shared/types';
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#view');
const aliveEl = document.querySelector<HTMLElement>('#alive');
const scoreEl = document.querySelector<HTMLElement>('#score');
const boardEl = document.querySelector<HTMLElement>('#board');
const speedEl = document.querySelector<HTMLElement>('#speed');
const timeEl = document.querySelector<HTMLElement>('#time');
const statusEl = document.querySelector<HTMLElement>('#status');
const overlayEl = document.querySelector<HTMLElement>('#overlay');
const overlayTitle = document.querySelector<HTMLElement>('#overlay-title');
const overlayBody = document.querySelector<HTMLElement>('#overlay-body');
const titleEl = document.querySelector<HTMLElement>('#title');
const startButton = document.querySelector<HTMLButtonElement>('#start');
const restartButtons = document.querySelectorAll<HTMLButtonElement>('#restart, #overlay-restart');
const muteButtons = document.querySelectorAll<HTMLButtonElement>('#mute, #mute-menu');

if (!canvas || !aliveEl || !scoreEl || !boardEl || !speedEl || !timeEl || !statusEl || !overlayEl || !overlayTitle || !overlayBody || !titleEl || !startButton || muteButtons.length < 2) {
  throw new Error('101 is missing required DOM nodes');
}

const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Canvas 2D is unavailable');

const game = new Game();
game.showTitle();
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
  boardEl!.textContent = String(hud.board);
  speedEl!.textContent = String(hud.speed);
  timeEl!.textContent = hud.time;
  statusEl!.textContent = hud.status;
  document.body.dataset.phase = game.inMatch ? hud.phase : 'menu';
  document.body.dataset.remaining = String(hud.remaining);
  titleEl!.hidden = game.inMatch;
  if (hud.overlay) {
    overlayTitle!.textContent = hud.overlay.title;
    overlayBody!.textContent = hud.overlay.body;
    overlayEl!.hidden = false;
  } else {
    overlayEl!.hidden = true;
  }
}

function syncMute(): void {
  const muted = game.sfx.muted;
  for (const button of muteButtons) {
    button.textContent = muted ? 'Muted' : 'Sound on';
    button.setAttribute('aria-pressed', muted ? 'true' : 'false');
  }
}

function begin(): void {
  direction = null;
  game.startMatch();
  syncHud();
}

function restart(): void {
  direction = null;
  if (!game.inMatch) begin();
  else {
    game.restart();
    syncHud();
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'm' || event.key === 'M') {
    event.preventDefault();
    game.toggleMute();
    syncMute();
    return;
  }
  if (!game.inMatch) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      begin();
    }
    return;
  }
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
startButton.addEventListener('click', begin);
for (const button of restartButtons) button.addEventListener('click', restart);
for (const button of muteButtons) {
  button.addEventListener('click', () => {
    game.toggleMute();
    syncMute();
  });
}
window.addEventListener('resize', resize);
resize();
syncHud();
syncMute();

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
