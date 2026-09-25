import { COUNTDOWN_BEATS } from '../config';
import type { GhostId } from '../shared/types';
import { CPU_NAMES } from '../systems/names';
import { createClassicPaint } from './classicPaint';
import type { Theme, ThemeSounds, ThemeStrings, ToneStep } from './types';

const GHOST_COLOR: Record<GhostId, string> = {
  blinky: '#ff3b30',
  pinky: '#ffb8ff',
  inky: '#46f0ff',
  clyde: '#ffb852',
};

function tone(freq: number, dur: number, type: ToneStep['type'], gain: number, delay = 0, slideTo?: number): ToneStep {
  const step: ToneStep = { freq, dur, type, gain };
  if (delay) step.delay = delay;
  if (slideTo !== undefined) step.slideTo = slideTo;
  return step;
}

const sounds: ThemeSounds = {
  start: [tone(392, 0.08, 'square', 0.05), tone(523, 0.09, 'square', 0.055, 0.08), tone(659, 0.14, 'square', 0.06, 0.16)],
  countdown: (beat) => {
    const freq = [330, 392, 440, 494][beat] ?? 440;
    return [tone(freq, 0.08, 'square', 0.045)];
  },
  countdownGo: [tone(523, 0.07, 'square', 0.05), tone(784, 0.16, 'square', 0.06, 0.07)],
  dotHi: [tone(980, 0.042, 'square', 0.034)],
  dotLo: [tone(620, 0.042, 'square', 0.034)],
  pellet: [tone(160, 0.26, 'sawtooth', 0.06, 0, 480), tone(640, 0.12, 'square', 0.04, 0.05)],
  wake: [tone(494, 0.05, 'triangle', 0.04), tone(740, 0.09, 'triangle', 0.045, 0.05)],
  trainEat: (combo) => {
    const base = 360 + Math.min(8, Math.max(1, combo)) * 48;
    return [tone(base, 0.05, 'square', 0.04), tone(base * 1.4, 0.08, 'square', 0.035, 0.045)];
  },
  ghost: (combo) => {
    const base = 500 + Math.min(8, Math.max(1, combo)) * 55;
    return [tone(96, 0.07, 'sine', 0.05), tone(base, 0.08, 'sine', 0.08), tone(base * 1.5, 0.1, 'triangle', 0.05, 0.06)];
  },
  fruitSpawn: [tone(740, 0.12, 'sine', 0.04), tone(988, 0.14, 'triangle', 0.035, 0.05)],
  fruit: [tone(440, 0.1, 'triangle', 0.06), tone(554, 0.1, 'triangle', 0.06, 0.09), tone(659, 0.16, 'triangle', 0.07, 0.18)],
  clear: [
    tone(392, 0.07, 'square', 0.045),
    tone(523, 0.08, 'square', 0.05, 0.06),
    tone(659, 0.09, 'square', 0.05, 0.12),
    tone(880, 0.16, 'triangle', 0.045, 0.2),
  ],
  whiteHit: [tone(420, 0.22, 'sine', 0.07, 0, 140)],
  whiteWipe: [tone(880, 0.06, 'square', 0.04), tone(0, 0.07, 'noise', 0.04)],
  redSpawn: [tone(98, 0.14, 'square', 0.06, 0, 70)],
  impact: [tone(150, 0.1, 'sawtooth', 0.06, 0, 70), tone(0, 0.09, 'noise', 0.045)],
  ko: [tone(180, 0.06, 'square', 0.07, 0, 90), tone(720, 0.1, 'square', 0.06, 0.04), tone(0, 0.07, 'noise', 0.05)],
  death: [tone(420, 0.38, 'sawtooth', 0.07, 0, 70), tone(0, 0.28, 'noise', 0.05)],
  win: [523, 659, 784, 1046].map((freq, i) => tone(freq, 0.16, 'triangle', 0.07, i * 0.09)),
};

const strings: ThemeStrings = {
  documentTitle: '101',
  brand: '101',
  cardTitle: '101',
  cardKicker: '',
  eyebrow: 'local battle maze',
  blurb: 'You, plus one hundred opponents. Eat the fruit to advance. White jammers slow you. Red ones kill.',
  nameLabel: 'Your name',
  namePlaceholder: 'Pac',
  defaultPlayerName: 'Pac',
  help: 'The match opens with Ready, 3, 2, 1, then Hit it! Pac holds still until then, and takes off to the left. Arrows or WASD steer after that. Pac hitches for one frame on a dot and three frames on a power pellet. Eat a large dot, then a blue ghost, to throw jammers at the side boards. An open ring on the ghost house shows how long the pellet lasts. White ghosts sleep beside the side tunnels; touch one and it joins a train behind the nearest ghost. It cannot be eaten until it reaches the back of that train. Eating the lead ghost hands that ghost\'s color to the next in line. The fruit under the ghost house reloads the dots and advances the board. Clearing every pellet raises Speed by 1, pops "Speed Up!" on Pac, and leaves the maze empty until the fruit. White jammers slow you down and die if they touch you; a power pellet wipes them. Red jammers kill on contact, freeze while a power pellet is active, and vanish when you eat the fruit. Red fill is pressure. An X means that opponent is out. When you are eliminated, the standings keep updating while the other players finish. Once only CPU bots are still alive, End match skips to the results. When you win, a congratulations screen comes up first; click, tap, Space, or Enter opens the standings. R restarts. M or Sound on mutes the effects.',
  start: 'Start match',
  onlineDev: 'Online (dev)',
  online: 'Online',
  ready: 'Ready',
  waiting: 'Waiting…',
  soundOn: 'Sound on',
  muted: 'Muted',
  menu: 'Menu',
  restart: 'Restart',
  restartMatch: 'Restart match',
  seeStandings: 'See standings',
  standingsTitle: 'Standings',
  endMatch: 'End match',
  alive: 'Alive',
  score: 'Score',
  ko: 'KO',
  board: 'Board',
  speed: 'Speed',
  time: 'Time',
  statusIdle: 'Large dots frighten ghosts. Eating them sends jammers sideways.',
  statusMenu: 'Start match to play',
  statusMove: 'Press an arrow key or WASD to start',
  statusWin: 'Congratulations',
  statusFinal: 'Final standings',
  statusOut: 'Eliminated',
  statusSlow: 'Slowed by a jammer',
  statusFright: 'Ghosts are frightened and slow — eat them to jam opponents',
  jammersFull: 'Jammers are full',
  speedUp: 'Speed Up!',
  koCallout: 'K.O.',
  modeActive: 'ACTIVE',
  modeNext: 'NEXT',
  modes: { standard: 'Standard', stronger: 'Stronger', speed: 'Speed', train: 'Train' },
  countdown: COUNTDOWN_BEATS,
  koByYou: 'You knocked them out',
  koYou: 'Knocked you out',
  rankYou: 'you',
  rankIn: 'in',
  jamFrom: (name) => `Ghost jam from ${name}`,
  eliminated: (name) => `Eliminated ${name}`,
  reason: (reason) => {
    switch (reason) {
      case 'ghost':
        return 'Ghost jam';
      case 'dots':
        return 'Dot pressure';
      case 'clear':
        return 'Board clear';
      case 'sim':
        return 'Sim jam';
      default:
        return 'Jam';
    }
  },
  winTitle: 'Congratulations!',
  winBody: (score) => `Last one standing. Score ${score}.`,
  winHint: 'Click, tap, Space, or Enter',
  placed: (place) => `You placed ${place}.`,
  placedLive: (place, stillIn) => `You placed ${place}. ${stillIn} still in — open spots stay blank until they are out.`,
  stillIn: (stillIn) => `${stillIn} still in.`,
  spectateBlurb: (stillIn) => `Spectating. ${stillIn} still in. No remote maze — the next lobby opens when this match ends.`,
  spectateStatus: (time, alive) => `Spectating · ${time} · ${alive} alive. No maze view — you join the next lobby when this match ends.`,
  spectateNote: 'Spectating this match. No maze view.',
  matchOver: 'Match over. Joining the next lobby…',
  opponent: 'Opponent',
  lobbyWaiting: (who, ready, humans, roomSize) =>
    `${who}. ${ready} of ${humans} ready. The first Ready starts a 10s countdown, then empty seats fill to ${roomSize}.`,
  lobbyStarting: (who, secs, roomSize) => `${who}. Starting in ${secs}s. Empty seats fill to ${roomSize}.`,
  connectLocal: 'Could not connect. Start the server with npm run server.',
  connectRemote:
    'Could not connect. A free Render server sleeps after idle time and can take a minute to wake. Try Online again.',
  fallbackName: 'Pac',
};

/** Cyan at the front of the train, magenta at the tail. */
export function classicTrainColor(index: number, total: number): string {
  const t = total <= 1 ? 0 : index / (total - 1);
  const hue = 168 + t * 152;
  const light = 78 - t * 16;
  return `hsl(${hue} 88% ${light}%)`;
}

export const classicTheme: Theme = {
  id: 'classic',
  label: 'Classic',
  fonts: {
    ui: '"Segoe UI", ui-sans-serif, system-ui, sans-serif',
    display: 'ui-monospace, "Cascadia Code", monospace',
    mono: 'ui-monospace, "Cascadia Code", monospace',
    callout: 'bold 26px ui-monospace, monospace',
    score: 'bold 13px ui-monospace, monospace',
    power: '12px sans-serif',
    panel: '10px ui-monospace, monospace',
    panelName: '9px ui-monospace, monospace',
  },
  css: {
    '--bg': '#07080f',
    '--bg-glow': 'rgba(48, 72, 160, 0.35)',
    '--text': '#f4f1e6',
    '--brand': '#ffe14a',
    '--muted': '#8ea0c8',
    '--alive': '#8cf0ff',
    '--ko': '#ff5a62',
    '--speed': '#ffe14a',
    '--time': '#f4f7ff',
    '--status': '#d5def2',
    '--button-bg': '#ffe14a',
    '--button-text': '#1a1400',
    '--button-hover': '#fff1a0',
    '--ghost-button': '#ffe14a',
    '--ghost-border': '#6e84b4',
    '--ghost-hover': 'rgba(255, 225, 74, 0.12)',
    '--note': '#8cf0ff',
    '--canvas-bg': '#070b14',
    '--countdown': '#ffe14a',
    '--scrim': 'rgba(4, 6, 12, 0.72)',
    '--card-bg': '#121826',
    '--card-border': '#31456f',
    '--card-title': '#ffe14a',
    '--hint': '#8ea0c8',
    '--card-text': '#d5def2',
    '--field-text': '#f4f1e6',
    '--field-bg': '#0c101a',
    '--field-border': '#6e84b4',
    '--field-focus': '#ffe14a',
    '--rank-border': '#243458',
    '--rank-bg': '#0c101a',
    '--rank-text': '#d5def2',
    '--rank-place': '#8ea0c8',
    '--rank-dim': '#5c6e94',
    '--rank-you-bg': 'rgba(255, 225, 74, 0.18)',
    '--rank-you': '#ffe14a',
    '--ko-icon-fg': '#1a0508',
    '--ko-icon-bg': '#ff2a36',
    '--kod-icon-fg': '#1a1400',
    '--kod-icon-bg': '#ffe14a',
    '--help': '#8ea0c8',
    '--font': '"Segoe UI", ui-sans-serif, system-ui, sans-serif',
    '--font-display': 'ui-monospace, "Cascadia Code", monospace',
    '--font-mono': 'ui-monospace, "Cascadia Code", monospace',
    '--shadow': 'rgba(0, 0, 0, 0.35)',
  },
  strings,
  cpuNames: CPU_NAMES,
  sounds,
  ghostColor: (id) => GHOST_COLOR[id],
  sleeperColor: '#f7f8ff',
  trainColor: classicTrainColor,
  paint: createClassicPaint(strings),
};
