import { MAX_SIM_STEPS, SIM_CATCHUP_BUDGET_MS, SIM_FRAME_SEC, SIM_FPS, VIEW_H, VIEW_W } from './config';
import { Game } from './game';
import { WallSimClock } from './loop';
import { NetSession } from './net/session';
import { resolveSocketUrl } from './net/socketUrl';
import { modeFromKey } from './gameplay/powerMode';
import { dirFromKey, type Dir } from './shared/types';
import { standingMarks, type StandingRow } from './systems/ranking';
import { loadPlayerName, savePlayerName } from './systems/names';
import { activeTheme, bootTheme, setActiveTheme, type ThemeId } from './theme';
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
const helpEl = document.querySelector<HTMLElement>('#help');
const brandEl = document.querySelector<HTMLElement>('#hud h1');
const eyebrowEl = document.querySelector<HTMLElement>('#title-eyebrow');
const cardTitleEl = document.querySelector<HTMLElement>('#title-heading');
const cardKickerEl = document.querySelector<HTMLElement>('#title-kicker');
const blurbEl = document.querySelector<HTMLElement>('#title-blurb');
const nameLabelEl = document.querySelector<HTMLElement>('#name-label');
const rankingTitleEl = document.querySelector<HTMLElement>('#ranking-title');
const themeButtons = document.querySelectorAll<HTMLButtonElement>('[data-theme-id]');
const statLabels = {
  alive: document.querySelector<HTMLElement>('.alive-stat span'),
  score: document.querySelector<HTMLElement>('.score-stat span'),
  ko: document.querySelector<HTMLElement>('.ko-stat span'),
  board: document.querySelector<HTMLElement>('.board-stat span'),
  speed: document.querySelector<HTMLElement>('.speed-stat span'),
  time: document.querySelector<HTMLElement>('.time-stat span'),
};

if (!canvas || !aliveEl || !scoreEl || !koEl || !boardEl || !speedEl || !timeEl || !statusEl || !overlayEl || !overlayCard || !overlayTitle || !overlayBody || !overlayHint || !overlayContinue || !overlayRestart || !rankingEl || !rankingBlurb || !rankingList || !rankingEnd || !titleEl || !countdownEl || !startButton || !onlineButton || !readyButton || !onlineNoteEl || !nameInput || !hudName || !helpEl || !brandEl || !eyebrowEl || !cardTitleEl || !cardKickerEl || !blurbEl || !nameLabelEl || !rankingTitleEl || !statLabels.alive || !statLabels.score || !statLabels.ko || !statLabels.board || !statLabels.speed || !statLabels.time || muteButtons.length < 2 || menuButtons.length < 2 || themeButtons.length < 2) {
  throw new Error('101 is missing required DOM nodes');
}

const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Canvas 2D is unavailable');

bootTheme();
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
  const copy = activeTheme().strings;
  readyButton!.textContent = session.hasReadied ? copy.waiting : copy.ready;
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
  const copy = activeTheme().strings;
  rankingBlurb!.textContent = game.spectating
    ? copy.spectateBlurb(stillIn)
    : yourPlace
      ? stillIn > 0
        ? copy.placedLive(yourPlace, stillIn)
        : copy.placed(yourPlace)
      : copy.stillIn(stillIn);
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
  for (const mark of standingMarks(row)) {
    const icon = document.createElement('span');
    icon.className = mark.className;
    icon.textContent = mark.text;
    icon.title = mark.title;
    marks.append(icon);
  }
  const tag = document.createElement('span');
  tag.className = 'tag';
  const copy = activeTheme().strings;
  tag.textContent = row.you ? copy.rankYou : row.state === 'active' ? copy.rankIn : '';
  item.append(place, name, marks, tag);
  return item;
}

function syncMute(): void {
  const muted = game.sfx.muted;
  for (const button of muteButtons) {
    const copy = activeTheme().strings;
    button.textContent = muted ? copy.muted : copy.soundOn;
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

function applyThemeCopy(): void {
  const theme = activeTheme();
  const copy = theme.strings;
  document.title = copy.documentTitle;
  brandEl!.textContent = copy.brand;
  eyebrowEl!.textContent = copy.eyebrow;
  cardTitleEl!.textContent = copy.cardTitle;
  cardKickerEl!.textContent = copy.cardKicker;
  cardKickerEl!.hidden = copy.cardKicker.length === 0;
  blurbEl!.textContent = copy.blurb;
  nameLabelEl!.textContent = copy.nameLabel;
  nameInput!.placeholder = copy.namePlaceholder;
  helpEl!.textContent = copy.help;
  statusEl!.textContent = copy.statusIdle;
  startButton!.textContent = copy.start;
  onlineButton!.textContent = import.meta.env.DEV ? copy.onlineDev : copy.online;
  rankingTitleEl!.textContent = copy.standingsTitle;
  overlayContinue!.textContent = copy.seeStandings;
  rankingEnd!.textContent = copy.endMatch;
  const [hudRestart, overlayRestartBtn, rankingRestartBtn] = restartButtons;
  if (hudRestart) hudRestart.textContent = copy.restart;
  if (overlayRestartBtn) overlayRestartBtn.textContent = copy.restartMatch;
  if (rankingRestartBtn) rankingRestartBtn.textContent = copy.restartMatch;
  for (const button of menuButtons) button.textContent = copy.menu;
  statLabels.alive!.textContent = copy.alive;
  statLabels.score!.textContent = copy.score;
  statLabels.ko!.textContent = copy.ko;
  statLabels.board!.textContent = copy.board;
  statLabels.speed!.textContent = copy.speed;
  statLabels.time!.textContent = copy.time;
  for (const button of themeButtons) {
    button.setAttribute('aria-pressed', button.dataset.themeId === theme.id ? 'true' : 'false');
  }
}

function chooseTheme(id: ThemeId): void {
  if (game.inMatch || game.spectating) return;
  const previousDefault = activeTheme().strings.defaultPlayerName;
  setActiveTheme(id);
  if (nameInput!.value === previousDefault) {
    nameInput!.value = activeTheme().strings.defaultPlayerName;
    commitName();
  }
  applyThemeCopy();
  syncMute();
  syncHud();
}

window.addEventListener('keydown', onKeyDown);
applyThemeCopy();
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
for (const button of themeButtons) {
  button.addEventListener('click', () => {
    const id = button.dataset.themeId;
    if (id === 'classic' || id === 'deep-sea') chooseTheme(id);
  });
}
window.addEventListener('resize', resize);
resize();
syncHud();
syncMute();
if (new URLSearchParams(window.location.search).get('online') === '1') beginOnline();

const clock = new WallSimClock();
clock.mark(performance.now());
let simWorker: Worker | null = null;
let mainHeartbeat: number | null = null;
let wakeQueued = false;
let hiddenCatchUpQueued = false;

function runSteps(frames: number): void {
  for (let step = 0; step < frames; step++) {
    game.setDirection(direction);
    game.update(SIM_FRAME_SEC);
  }
}

/**
 * Advance the maze from wall-clock time. Hidden, minimized, and unfocused
 * tabs keep the same clock: nothing zeroes the gap. A long wake runs a short
 * slice and yields. While the tab is showing, later frames finish the backlog.
 * While it is hidden, the worker schedules the next slice.
 */
function pumpSim(now = performance.now()): void {
  clock.mark(now);
  const started = performance.now();
  while (clock.lag >= SIM_FRAME_SEC) {
    const frames = clock.take(MAX_SIM_STEPS);
    if (frames === 0) break;
    runSteps(frames);
    if (performance.now() - started >= SIM_CATCHUP_BUDGET_MS) break;
  }
  if (document.hidden && clock.lag >= SIM_FRAME_SEC) queueHiddenCatchUp();
}

function queueHiddenCatchUp(): void {
  if (hiddenCatchUpQueued) return;
  hiddenCatchUpQueued = true;
  if (simWorker != null) {
    simWorker.postMessage({ type: 'pump' });
    return;
  }
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    hiddenCatchUpQueued = false;
    if (document.hidden && clock.lag >= SIM_FRAME_SEC) pumpSim();
  };
  channel.port2.postMessage(null);
}

function onSimWake(): void {
  // Ticks already waiting in the queue share one slice. Wall time is read
  // when that slice runs, so dropping the extra ticks does not drop the gap.
  if (wakeQueued) return;
  wakeQueued = true;
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    wakeQueued = false;
    hiddenCatchUpQueued = false;
    pumpSim();
  };
  channel.port2.postMessage(null);
}

function startMainHeartbeat(): void {
  if (mainHeartbeat != null) return;
  mainHeartbeat = window.setInterval(() => onSimWake(), 1000 / SIM_FPS);
}

try {
  const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = () => onSimWake();
  worker.onerror = () => {
    worker.terminate();
    simWorker = null;
    startMainHeartbeat();
  };
  simWorker = worker;
} catch {
  startMainHeartbeat();
}

document.addEventListener('visibilitychange', () => {
  pumpSim();
});
window.addEventListener('focus', () => {
  pumpSim();
});
window.addEventListener('pageshow', () => {
  pumpSim();
});

function frame(): void {
  pumpSim();
  game.draw(ctx!);
  syncHud();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
