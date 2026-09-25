import type { GhostId } from '../shared/types';
import { createDeepSeaPaint } from './deepSeaPaint';
import { DEEP_SEA_NAMES } from './deepSeaNames';
import type { Theme, ThemeSounds, ThemeStrings, ToneStep } from './types';

const GHOST_COLOR: Record<GhostId, string> = {
  blinky: '#ff4b3a',
  pinky: '#ff8ad4',
  inky: '#3ee0ff',
  clyde: '#ff9a2e',
};

function tone(freq: number, dur: number, type: ToneStep['type'], gain: number, delay = 0, slideTo?: number): ToneStep {
  const step: ToneStep = { freq, dur, type, gain };
  if (delay) step.delay = delay;
  if (slideTo !== undefined) step.slideTo = slideTo;
  return step;
}

/** Same cue lengths and delays as classic, with softer underwater tones. */
const sounds: ThemeSounds = {
  start: [tone(330, 0.08, 'sine', 0.05, 0, 392), tone(440, 0.09, 'sine', 0.055, 0.08, 523), tone(554, 0.14, 'triangle', 0.06, 0.16, 740)],
  countdown: (beat) => {
    const freq = [262, 311, 349, 392][beat] ?? 349;
    return [tone(freq, 0.08, 'sine', 0.05, 0, freq * 1.5)];
  },
  countdownGo: [tone(392, 0.07, 'sine', 0.05, 0, 523), tone(659, 0.16, 'triangle', 0.06, 0.07, 880)],
  dotHi: [tone(640, 0.042, 'sine', 0.04, 0, 380)],
  dotLo: [tone(420, 0.042, 'sine', 0.04, 0, 240)],
  pellet: [tone(220, 0.26, 'sine', 0.06, 0, 680), tone(520, 0.12, 'triangle', 0.045, 0.05, 880)],
  wake: [tone(480, 0.05, 'sine', 0.045, 0, 920), tone(740, 0.09, 'sine', 0.04, 0.05, 420)],
  trainEat: (combo) => {
    const base = 280 + Math.min(8, Math.max(1, combo)) * 36;
    return [tone(base, 0.05, 'sine', 0.04, 0, base * 1.25), tone(base * 1.4, 0.08, 'triangle', 0.035, 0.045, base * 1.8)];
  },
  ghost: (combo) => {
    const base = 360 + Math.min(8, Math.max(1, combo)) * 40;
    return [tone(90, 0.07, 'sine', 0.05, 0, 140), tone(base, 0.08, 'sine', 0.07, 0, base * 1.2), tone(base * 1.5, 0.1, 'triangle', 0.05, 0.06)];
  },
  fruitSpawn: [tone(520, 0.12, 'sine', 0.04, 0, 780), tone(780, 0.14, 'triangle', 0.035, 0.05, 1040)],
  fruit: [tone(349, 0.1, 'sine', 0.06, 0, 440), tone(440, 0.1, 'triangle', 0.06, 0.09, 554), tone(554, 0.16, 'sine', 0.07, 0.18, 698)],
  clear: [
    tone(330, 0.07, 'sine', 0.045, 0, 392),
    tone(440, 0.08, 'sine', 0.05, 0.06, 523),
    tone(523, 0.09, 'triangle', 0.05, 0.12, 659),
    tone(698, 0.16, 'sine', 0.045, 0.2, 880),
  ],
  whiteHit: [tone(280, 0.22, 'sine', 0.07, 0, 110)],
  whiteWipe: [tone(660, 0.06, 'sine', 0.04, 0, 990), tone(0, 0.07, 'noise', 0.03)],
  redSpawn: [tone(70, 0.14, 'sine', 0.06, 0, 48)],
  impact: [tone(110, 0.1, 'sine', 0.06, 0, 55), tone(0, 0.09, 'noise', 0.04)],
  ko: [tone(140, 0.06, 'square', 0.06, 0, 70), tone(520, 0.1, 'square', 0.055, 0.04), tone(0, 0.07, 'noise', 0.045)],
  death: [tone(360, 0.38, 'sine', 0.07, 0, 60), tone(0, 0.28, 'noise', 0.04)],
  win: [392, 494, 587, 784].map((freq, i) => tone(freq, 0.16, 'sine', 0.07, i * 0.09, freq * 1.25)),
};

const strings: ThemeStrings = {
  documentTitle: '101: Deep Sea',
  brand: '101',
  cardTitle: '101',
  cardKicker: 'Deep Sea',
  eyebrow: 'deep sea battle',
  blurb: 'You, plus one hundred swimmers. Eat the starfish to advance. Pale urchins slow you. Red mines kill.',
  nameLabel: 'Your name',
  namePlaceholder: 'Fish',
  defaultPlayerName: 'Fish',
  help: 'The dive opens with Ready, 3, 2, 1, then Dive! Your fish holds still until then, and takes off to the left. Arrows or WASD steer after that. The fish hitches for one frame on plankton and three frames on a pearl. Eat a pearl, then a pale-blue predator, to throw urchins and mines at the side reefs. An open ring on the kelp gate shows how long the pearl lasts. Pale creatures sleep beside the side tunnels; touch one and it joins a school behind the nearest predator. It cannot be eaten until it reaches the back of that school. Eating the lead predator hands that creature\'s color to the next in line. The starfish under the kelp gate reloads the plankton and advances the reef. Clearing every pearl raises Speed by 1, pops "Speed Up!" on your fish, and leaves the maze empty until the starfish. Pale urchins slow you down and die if they touch you; a pearl wipes them. Red mines kill on contact, freeze while a pearl is active, and vanish when you eat the starfish. Red fill is pressure. An X means that swimmer is out. When you are sunk, the standings keep updating while the others finish. Once only CPU swimmers are still alive, End dive skips to the results. When you win, a congratulations screen comes up first; click, tap, Space, or Enter opens the standings. R restarts. M or Sound on mutes the effects. Keys 1–4 queue Steady, Surge, Dart, and School, and the choice starts on the next pearl. Surge lasts four seconds and drops one speed level for the rest of the dive. Dart adds three speed levels while it lasts. School wakes two followers for each sleeper, and every fourth wake drops a pale urchin.',
  start: 'Start dive',
  onlineDev: 'Online (dev)',
  online: 'Online',
  ready: 'Ready',
  waiting: 'Waiting…',
  soundOn: 'Sound on',
  muted: 'Muted',
  menu: 'Menu',
  restart: 'Restart',
  restartMatch: 'Restart dive',
  seeStandings: 'See standings',
  standingsTitle: 'Standings',
  endMatch: 'End dive',
  alive: 'Swimming',
  score: 'Score',
  ko: 'KO',
  board: 'Reef',
  speed: 'Speed',
  time: 'Time',
  statusIdle: 'Pearls frighten the predators. Eating them sends urchins and mines sideways.',
  statusMenu: 'Start a dive to play',
  statusMove: 'Press an arrow key or WASD to swim',
  statusWin: 'The reef is yours',
  statusFinal: 'Final standings',
  statusOut: 'Sunk',
  statusSlow: 'Slowed by an urchin',
  statusFright: 'Pearls frighten the predators — eat them to jam the reef',
  jammersFull: 'The reef is full',
  speedUp: 'Speed Up!',
  koCallout: 'K.O.',
  modeActive: 'ACTIVE',
  modeNext: 'NEXT',
  modes: { standard: 'Steady', stronger: 'Surge', speed: 'Dart', train: 'School' },
  countdown: ['Ready…', '3…', '2…', '1…', 'Dive!'],
  koByYou: 'You sank them',
  koYou: 'Sank you',
  rankYou: 'you',
  rankIn: 'in',
  jamFrom: (name) => `Urchin jam from ${name}`,
  eliminated: (name) => `Sank ${name}`,
  reason: (reason) => {
    switch (reason) {
      case 'ghost':
        return 'Predator jam';
      case 'dots':
        return 'Plankton pressure';
      case 'clear':
        return 'Reef clear';
      case 'sim':
        return 'School jam';
      default:
        return 'Jam';
    }
  },
  winTitle: 'The reef is yours!',
  winBody: (score) => `Last one swimming. Score ${score}.`,
  winHint: 'Click, tap, Space, or Enter',
  placed: (place) => `You placed ${place}.`,
  placedLive: (place, stillIn) => `You placed ${place}. ${stillIn} still swimming — open spots stay blank until they are out.`,
  stillIn: (stillIn) => `${stillIn} still swimming.`,
  spectateBlurb: (stillIn) => `Watching the dive. ${stillIn} still swimming. No remote maze — the next lobby opens when this dive ends.`,
  spectateStatus: (time, alive) => `Watching · ${time} · ${alive} swimming. No maze view — you join the next lobby when this dive ends.`,
  spectateNote: 'Watching this dive. No maze view.',
  matchOver: 'Dive over. Joining the next lobby…',
  opponent: 'Swimmer',
  lobbyWaiting: (who, ready, humans, roomSize) =>
    `${who}. ${ready} of ${humans} ready. The first Ready starts a 10s countdown, then empty seats fill to ${roomSize}.`,
  lobbyStarting: (who, secs, roomSize) => `${who}. Diving in ${secs}s. Empty seats fill to ${roomSize}.`,
  connectLocal: 'Could not connect. Start the server with npm run server.',
  connectRemote:
    'Could not connect. A free Render server sleeps after idle time and can take a minute to wake. Try Online again.',
  fallbackName: 'Fish',
};

/** Aqua at the front of the school, gold at the tail. */
export function deepSeaTrainColor(index: number, total: number): string {
  const t = total <= 1 ? 0 : index / (total - 1);
  const hue = 174 - t * 138;
  const light = 74 - t * 22;
  return `hsl(${hue} 82% ${light}%)`;
}

export const deepSeaTheme: Theme = {
  id: 'deep-sea',
  label: 'Deep Sea',
  fonts: {
    ui: '"Trebuchet MS", "Segoe UI", sans-serif',
    display: '"Trebuchet MS", "Segoe UI", sans-serif',
    mono: 'ui-monospace, "Cascadia Code", monospace',
    callout: 'bold 26px "Trebuchet MS", "Segoe UI", sans-serif',
    score: 'bold 13px "Trebuchet MS", "Segoe UI", sans-serif',
    power: '12px "Trebuchet MS", "Segoe UI", sans-serif',
    panel: '10px ui-monospace, monospace',
    panelName: '9px ui-monospace, monospace',
  },
  css: {
    '--bg': '#041820',
    '--bg-glow': 'rgba(32, 140, 150, 0.4)',
    '--text': '#e7f7f4',
    '--brand': '#7ee0c8',
    '--muted': '#8eb8c4',
    '--alive': '#7ee8ff',
    '--ko': '#ff5a62',
    '--speed': '#ffe09a',
    '--time': '#f3fffb',
    '--status': '#d5eee8',
    '--button-bg': '#7ee0c8',
    '--button-text': '#042028',
    '--button-hover': '#c9fff0',
    '--ghost-button': '#9aefe0',
    '--ghost-border': '#3d7a86',
    '--ghost-hover': 'rgba(126, 224, 200, 0.14)',
    '--note': '#7ee8ff',
    '--canvas-bg': '#03141c',
    '--countdown': '#ffe09a',
    '--scrim': 'rgba(2, 12, 18, 0.74)',
    '--card-bg': '#0c2832',
    '--card-border': '#2f6e7c',
    '--card-title': '#7ee0c8',
    '--hint': '#8eb8c4',
    '--card-text': '#d7f3ee',
    '--field-text': '#e7f7f4',
    '--field-bg': '#07161e',
    '--field-border': '#3d7a86',
    '--field-focus': '#7ee0c8',
    '--rank-border': '#1c4e5c',
    '--rank-bg': '#07161e',
    '--rank-text': '#d7f3ee',
    '--rank-place': '#8eb8c4',
    '--rank-dim': '#5e8490',
    '--rank-you-bg': 'rgba(126, 224, 200, 0.2)',
    '--rank-you': '#d8fff4',
    '--ko-icon-fg': '#1a0508',
    '--ko-icon-bg': '#ff2a36',
    '--kod-icon-fg': '#042028',
    '--kod-icon-bg': '#7ee0c8',
    '--help': '#8eb8c4',
    '--font': '"Trebuchet MS", "Segoe UI", sans-serif',
    '--font-display': '"Trebuchet MS", "Segoe UI", sans-serif',
    '--font-mono': 'ui-monospace, "Cascadia Code", monospace',
    '--shadow': 'rgba(0, 16, 24, 0.45)',
  },
  strings,
  cpuNames: DEEP_SEA_NAMES,
  sounds,
  ghostColor: (id) => GHOST_COLOR[id],
  sleeperColor: '#d7f6ff',
  trainColor: deepSeaTrainColor,
  paint: createDeepSeaPaint(strings),
};
