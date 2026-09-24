import { SIM_FRAME_SEC, VIEW_H, VIEW_W } from './config';
import { Game } from './game';
import { planSimSteps } from './loop';
import { NetSession } from './net/session';
import { resolveSocketUrl } from './net/socketUrl';
import { modeFromKey } from './gameplay/powerMode';
import { dirFromKey, type Dir } from './shared/types';
import type { StandingRow } from './systems/ranking';
import { loadPlayerName, savePlayerName } from './systems/names';
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#view');
const aliveEl = document.querySelector<HTMLElement>('#alive');
const scoreEl = document.querySelector<HTMLElement>('#score');
const koEl = document.querySelector<HTMLElement>('#ko');
const boardEl = document.querySelector<HTMLElement>('#board');
const speedEl = document.querySelector<HTMLElement>('#speed');
const timeEl = document.querySelector<HTMLElement>('#time');
const statusEl = document.querySelector<HTMLElement>('#status');
const overlayEl = document.querySelector<HTMLElement>('#overlay');
const overlayCard = document.querySelector<HTMLElement>('#overlay-card');
const overlayTitle = document.querySelector<HTMLElement>('#overlay-title');
const overlayBody = document.querySelector<HTMLElement>('#overlay-body');
const overlayHint = document.querySelector<HTMLElement>('#overlay-hint');
const overlayContinue = document.querySelector<HTMLButtonElement>('#overlay-continue');
const overlayRestart = document.querySelector<HTMLButtonElement>('#overlay-restart');
const rankingEl = document.querySelector<HTMLElement>('#ranking');
const rankingBlurb = document.querySelector<HTMLElement>('#ranking-blurb');
const rankingList = document.querySelector<HTMLOListElement>('#ranking-list');
const rankingEnd = document.querySelector<HTMLButtonElement>('#ranking-end');
const titleEl = document.querySelector<HTMLElement>('#title');
const countdownEl = document.querySelector<HTMLElement>('#countdown');
const startButton = document.querySelector<HTMLButtonElement>('#start');
const onlineButton = document.querySelector<HTMLButtonElement>('#online');
const readyButton = document.querySelector<HTMLButtonElement>('#ready');
const onlineNoteEl = document.querySelector<HTMLElement>('#online-note');
const nameInput = document.querySelector<HTMLInputElement>('#player-name-input');
const hudName = document.querySelector<HTMLElement>('#hud-name');
const restartButtons = document.querySelectorAll<HTMLButtonElement>('#restart, #overlay-restart, #ranking-restart');
const menuButtons = document.querySelectorAll<HTMLButtonElement>('#overlay-menu, #ranking-menu');
const muteButtons = document.querySelectorAll<HTMLButtonElement>('#mute, #mute-menu');

if (!canvas || !aliveEl || !scoreEl || !koEl || !boardEl || !speedEl || !timeEl || !statusEl || !overlayEl || !overlayCard || !overlayTitle || !overlayBody || !overlayHint || !overlayContinue || !overlayRestart || !rankingEl || !rankingBlurb || !rankingList || !rankingEnd || !titleEl || !countdownEl || !startButton || !onlineButton || !readyButton || !onlineNoteEl || !nameInput || !hudName || muteButtons.length < 2 || menuButtons.length < 2) {
  throw new Error('101 is missing required DOM nodes');
}

const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Canvas 2D is unavailable');

const game = new Game();
game.showTitle();
let direction: Dir | null = null;
let standingsSig = '';
let scrolledToYou = false;
let shownKos = 0;

function commitName(): void {
  const name = savePlayerName(nameInput!.value);
  nameInput!.value = name;
  game.setPlayerName(name);
  hudName!.textContent = name;
}

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
  if (hud.kos !== shownKos) {
    shownKos = hud.kos;
    koEl!.textContent = String(hud.kos);
    koEl!.classList.remove('bump');
    void koEl!.offsetWidth;
    if (hud.kos > 0) koEl!.classList.add('bump');
  }
  boardEl!.textContent = String(hud.board);
  speedEl!.textContent = String(hud.speed);
  timeEl!.textContent = hud.time;
  statusEl!.textContent = hud.status;
  onlineNoteEl!.hidden = game.onlineNote.length === 0;
  onlineNoteEl!.textContent = game.onlineNote;
  readyButton!.hidden = session.phase !== 'lobby';
  readyButton!.disabled = session.hasReadied;
  readyButton!.textContent = session.hasReadied ? 'Waiting…' : 'Ready';
  document.body.dataset.phase = game.inMatch ? hud.phase : 'menu';
  document.body.dataset.remaining = String(hud.remaining);
  titleEl!.hidden = game.inMatch || game.spectating;
  countdownEl!.hidden = !hud.countdown;
  countdownEl!.textContent = hud.countdown ?? '';
  hudName!.textContent = game.playerName;
  if (hud.standings) {
    overlayCard!.hidden = true;
    rankingEl!.hidden = false;
    overlayEl!.hidden = false;
    rankingEnd!.hidden = !hud.canEndMatch;
    renderStandings(hud.standings.rows, hud.standings.yourPlace, hud.standings.stillIn);
  } else if (hud.overlay) {
    rankingEl!.hidden = true;
    overlayCard!.hidden = false;
    overlayCard!.classList.toggle('win-card', hud.phase === 'won');
    overlayTitle!.textContent = hud.overlay.title;
    overlayBody!.textContent = hud.overlay.body;
    overlayHint!.hidden = hud.overlay.hint == null;
    overlayHint!.textContent = hud.overlay.hint ?? '';
    overlayContinue!.hidden = hud.phase !== 'won';
    overlayRestart!.hidden = hud.phase === 'won';
    overlayEl!.hidden = false;
    rankingEnd!.hidden = true;
    standingsSig = '';
    scrolledToYou = false;
  } else {
    overlayCard!.classList.remove('win-card');
    overlayHint!.hidden = true;
    overlayContinue!.hidden = true;
    overlayRestart!.hidden = false;
    overlayEl!.hidden = true;
    rankingEnd!.hidden = true;
    standingsSig = '';
    scrolledToYou = false;
  }
}

function winCardUp(): boolean {
  const hud = game.hud();
  return hud.phase === 'won' && hud.overlay != null;
}

function advanceWin(): void {
  if (!winCardUp()) return;
  game.acknowledgeWin();
  syncHud();
}

function renderStandings(rows: readonly StandingRow[], yourPlace: number | null, stillIn: number): void {
  const sig = `${stillIn}|${yourPlace ?? ''}|${rows.map((row) => `${row.place ?? ''}:${row.name}:${row.state}:${row.kos}:${row.koByYou ? 1 : 0}:${row.koYou ? 1 : 0}`).join(';')}`;
  rankingBlurb!.textContent = game.spectating
    ? `Spectating. ${stillIn} still in. No remote maze — the next lobby opens when this match ends.`
    : yourPlace
    ? stillIn > 0
      ? `You placed ${yourPlace}. ${stillIn} still in — open spots stay blank until they are out.`
      : `You placed ${yourPlace}.`
    : `${stillIn} still in.`;
  if (sig === standingsSig) return;
  const top = rankingList!.scrollTop;
  rankingList!.replaceChildren(...rows.map(renderStandingRow));
  standingsSig = sig;
  if (!scrolledToYou) {
    const you = rankingList!.querySelector('.you');
    if (you instanceof HTMLElement) {
      rankingList!.scrollTop = Math.max(0, you.offsetTop - rankingList!.clientHeight / 2);
      scrolledToYou = true;
    }
  } else {
    rankingList!.scrollTop = top;
  }
}

function renderStandingRow(row: StandingRow): HTMLLIElement {
  const item = document.createElement('li');
  item.className = `rank-row${row.you ? ' you' : ''}${row.state === 'active' ? ' active' : ''}`;
  const place = document.createElement('span');
  place.className = 'place';
  place.textContent = row.place === null ? '' : String(row.place);
  const name = document.createElement('span');
  name.textContent = row.name;
  const marks = document.createElement('span');
  marks.className = 'ko-marks';
  if (row.koByYou) {
    const icon = document.createElement('span');
    icon.className = 'ko-icon';
    icon.textContent = '✕';
    icon.title = 'You knocked them out';
    marks.append(icon);
  }
  if (row.koYou) {
    const icon = document.createElement('span');
    icon.className = 'kod-icon';
    icon.textContent = '◉';
    icon.title = 'Knocked you out';
    marks.append(icon);
  }
  if (row.kos > 0) {
    const total = document.createElement('span');
    total.className = 'ko-total';
    total.textContent = String(row.kos);
    total.title = `${row.kos} KO`;
    marks.append(total);
  }
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = row.you ? 'you' : row.state === 'active' ? 'in' : '';
  item.append(place, name, marks, tag);
  return item;
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
  session.stop();
  game.bindOnline(null);
  game.setOnlineNote('');
  commitName();
  standingsSig = '';
  scrolledToYou = false;
  game.startMatch();
  syncHud();
}

function beginOnline(): void {
  direction = null;
  commitName();
  standingsSig = '';
  scrolledToYou = false;
  game.showTitle();
  const resolved = resolveSocketUrl({
    query: new URLSearchParams(window.location.search).get('ws'),
    dev: import.meta.env.DEV,
    configured: import.meta.env.VITE_WS_URL,
  });
  if (!resolved.ok) {
    session.stop();
    game.bindOnline(null);
    game.setOnlineNote(resolved.reason);
    syncHud();
    return;
  }
  game.bindOnline({
    earn: (attack, strength) => session.sendEarn(attack, strength),
    death: (cause) => session.sendDeath(cause),
    end: () => session.sendEndMatch(),
  });
  session.connect(resolved.url, game.playerName);
  syncHud();
}

function menu(): void {
  direction = null;
  session.stop();
  game.bindOnline(null);
  game.setOnlineNote('');
  standingsSig = '';
  scrolledToYou = false;
  game.showTitle();
  syncHud();
}

function restart(): void {
  direction = null;
  if (session.active || game.online) {
    standingsSig = '';
    scrolledToYou = false;
    game.showTitle();
    session.rejoin();
    syncHud();
    return;
  }
  begin();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.target instanceof HTMLInputElement) {
    if (event.key === 'Enter' && !game.inMatch) {
      event.preventDefault();
      begin();
    }
    return;
  }
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
  if ((event.key === 'Enter' || event.key === ' ') && winCardUp()) {
    event.preventDefault();
    advanceWin();
    return;
  }
  const queued = modeFromKey(event.key);
  if (queued) {
    event.preventDefault();
    game.queuePower(queued);
    return;
  }
  const next = dirFromKey(event.key);
  if (next) {
    event.preventDefault();
    if (game.acceptsInput) direction = next;
    return;
  }
  if (event.key === 'r' || event.key === 'R') {
    event.preventDefault();
    restart();
  }
}

nameInput.value = loadPlayerName();
commitName();
nameInput.addEventListener('input', () => {
  game.setPlayerName(savePlayerName(nameInput.value));
  hudName.textContent = game.playerName;
});
nameInput.addEventListener('blur', commitName);

const session = new NetSession({
  onNote: (text) => {
    game.setOnlineNote(text);
    syncHud();
  },
  onLobby: () => {
    game.clearSpectate();
    if (game.inMatch) {
      direction = null;
      standingsSig = '';
      scrolledToYou = false;
      game.showTitle();
    }
    syncHud();
  },
  onSpectate: (message) => {
    direction = null;
    standingsSig = '';
    scrolledToYou = false;
    game.beginSpectate(message.roster, message.clock);
    syncHud();
  },
  onMatchStart: (message) => {
    direction = null;
    standingsSig = '';
    scrolledToYou = false;
    game.clearSpectate();
    game.startMatch();
    game.armOnline(message.you, message.roster);
    game.applyOnlineRoster(message.roster);
    syncHud();
  },
  onJammer: (message) => {
    game.receiveOnlineJammer(message.strength, message.fromName, message.attack, message.fromSeat);
  },
  onRoster: (message) => {
    if (session.spectating) game.applySpectateRoster(message.seats, message.clock);
    else game.applyOnlineRoster(message.seats);
  },
  onKo: (message) => {
    game.noteOnlineKo(message.victim, message.killer, message.killerKos);
    syncHud();
  },
  onEliminated: (message) => {
    if (session.spectating) {
      game.noteSpectatorElimination(message.seat, message.place);
      syncHud();
      return;
    }
    game.noteOnlineElimination(message.seat, message.place);
    if (message.seat === session.seat) game.applyServerElimination();
    else game.eliminateOnlineSeat(message.seat);
  },
  onMatchEnd: (message) => {
    if (session.spectating) {
      game.showSpectatorPlacements(message.placements);
      syncHud();
      return;
    }
    const mine = message.placements.find((row) => row.seat === session.seat);
    if (mine && mine.place !== 1) game.applyServerElimination();
    else game.eliminateOnlineOpponent();
    game.setOnlineStandings(message.placements);
    syncHud();
  },
});

window.addEventListener('keydown', onKeyDown);
if (!import.meta.env.DEV) onlineButton.textContent = 'Online';
startButton.addEventListener('click', begin);
onlineButton.addEventListener('click', beginOnline);
readyButton.addEventListener('click', () => {
  session.sendReady();
  syncHud();
});
overlayContinue.addEventListener('click', (event) => {
  event.stopPropagation();
  advanceWin();
});
overlayEl.addEventListener('click', (event) => {
  if (event.target instanceof HTMLButtonElement) return;
  advanceWin();
});
rankingEnd.addEventListener('click', () => {
  game.requestEndMatch();
  syncHud();
});
for (const button of restartButtons) button.addEventListener('click', restart);
for (const button of menuButtons) button.addEventListener('click', menu);
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
if (new URLSearchParams(window.location.search).get('online') === '1') beginOnline();

let last = performance.now();
let lag = 0;
function frame(now: number): void {
  const dt = document.hidden ? 0 : (now - last) / 1000;
  last = now;
  const plan = planSimSteps(lag, dt);
  lag = plan.lag;
  for (let step = 0; step < plan.frames; step++) {
    game.setDirection(direction);
    game.update(SIM_FRAME_SEC);
  }
  game.draw(ctx!);
  syncHud();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
