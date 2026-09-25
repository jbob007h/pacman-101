import type { PacMode } from '../gameplay/powerMode';
import type { GhostMode } from '../gameplay/ghosts';
import type { Dir, GhostId } from '../shared/types';
import type { JammerKind } from '../gameplay/inbound';
import type { WallFill } from '../render/walls';

export type ThemeId = 'classic' | 'deep-sea';

export type ToneType = OscillatorType | 'noise';

/** One oscillator or noise burst. Delays are seconds after the cue starts. */
export interface ToneStep {
  freq: number;
  dur: number;
  type: ToneType;
  gain: number;
  delay?: number;
  slideTo?: number;
}

export interface ThemeSounds {
  start: readonly ToneStep[];
  countdown: (beat: number) => readonly ToneStep[];
  countdownGo: readonly ToneStep[];
  dotHi: readonly ToneStep[];
  dotLo: readonly ToneStep[];
  pellet: readonly ToneStep[];
  wake: readonly ToneStep[];
  trainEat: (combo: number) => readonly ToneStep[];
  ghost: (combo: number) => readonly ToneStep[];
  fruitSpawn: readonly ToneStep[];
  fruit: readonly ToneStep[];
  clear: readonly ToneStep[];
  whiteHit: readonly ToneStep[];
  whiteWipe: readonly ToneStep[];
  redSpawn: readonly ToneStep[];
  impact: readonly ToneStep[];
  ko: readonly ToneStep[];
  death: readonly ToneStep[];
  win: readonly ToneStep[];
}

export interface ThemeFonts {
  ui: string;
  display: string;
  mono: string;
  callout: string;
  score: string;
  power: string;
  panel: string;
  panelName: string;
}

/** CSS custom properties applied to the document root. Keys include the `--` prefix. */
export type ThemeCss = Record<string, string>;

export interface ThemeStrings {
  documentTitle: string;
  /** Big wordmark. Stays "101"; the theme name rides alongside it. */
  brand: string;
  cardTitle: string;
  /** Shown under the title when the theme has a subtitle. Empty hides it. */
  cardKicker: string;
  eyebrow: string;
  blurb: string;
  nameLabel: string;
  namePlaceholder: string;
  defaultPlayerName: string;
  help: string;
  start: string;
  onlineDev: string;
  online: string;
  ready: string;
  waiting: string;
  soundOn: string;
  muted: string;
  menu: string;
  restart: string;
  restartMatch: string;
  seeStandings: string;
  standingsTitle: string;
  endMatch: string;
  alive: string;
  score: string;
  ko: string;
  board: string;
  speed: string;
  time: string;
  statusIdle: string;
  statusMenu: string;
  statusMove: string;
  statusWin: string;
  statusFinal: string;
  statusOut: string;
  statusSlow: string;
  statusFright: string;
  jammersFull: string;
  speedUp: string;
  koCallout: string;
  modeActive: string;
  modeNext: string;
  modes: Record<PacMode, string>;
  countdown: readonly string[];
  koByYou: string;
  koYou: string;
  rankYou: string;
  rankIn: string;
  jamFrom: (name: string) => string;
  eliminated: (name: string) => string;
  reason: (reason: string) => string;
  winTitle: string;
  winBody: (score: number) => string;
  winHint: string;
  placed: (place: number) => string;
  placedLive: (place: number, stillIn: number) => string;
  stillIn: (stillIn: number) => string;
  spectateBlurb: (stillIn: number) => string;
  spectateStatus: (time: string, alive: number) => string;
  spectateNote: string;
  matchOver: string;
  opponent: string;
  lobbyWaiting: (who: string, ready: number, humans: number, roomSize: number) => string;
  lobbyStarting: (who: string, secs: number, roomSize: number) => string;
  connectLocal: string;
  connectRemote: string;
  fallbackName: string;
}

export interface PlayerPose {
  sx: number;
  sy: number;
  radius: number;
  mouth: number;
  facing: number;
  /** 0 alive, 1 at the end of the death spin. */
  death: number;
  slow: boolean;
  anim: number;
  time: number;
}

export interface ChaserPose {
  sx: number;
  sy: number;
  dir: Dir;
  /** Body color when the chaser is not frightened. */
  color: string;
  mode: GhostMode;
  flash: boolean;
  eyesOnly: boolean;
  /** Sprite scale already multiplied by {@link SPRITE_SCALE}. */
  s: number;
  homeX: number;
  time: number;
  /** 0 shark, 1 jelly, 2 squid, 3 angler. Classic ignores this. */
  species: number;
  alpha: number;
}

export interface JammerPose {
  kind: JammerKind;
  frozen: boolean;
  /** Sprite scale (the 2× actor scale). Spawn pulse is already on the transform. */
  s: number;
  time: number;
}

export interface ThemePaint {
  pageBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void;
  mazeBackground(ctx: CanvasRenderingContext2D, board: { x: number; y: number; w: number; h: number }, time: number): void;
  wall(ctx: CanvasRenderingContext2D, px: number, py: number, fill: WallFill, flash: number): void;
  door(ctx: CanvasRenderingContext2D, px: number, py: number, time: number): void;
  dot(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number): void;
  pellet(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number): void;
  player(ctx: CanvasRenderingContext2D, pose: PlayerPose): void;
  chaser(ctx: CanvasRenderingContext2D, pose: ChaserPose): void;
  jammer(ctx: CanvasRenderingContext2D, pose: JammerPose): void;
  fruit(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number): void;
  panel(ctx: CanvasRenderingContext2D, sim: PanelSim, time: number): void;
  boardChrome(ctx: CanvasRenderingContext2D, board: { x: number; y: number; w: number; h: number }, slow: number, time: number): void;
  bolt(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void;
  incoming(ctx: CanvasRenderingContext2D, sx: number, sy: number, x: number, y: number): void;
  particle(ctx: CanvasRenderingContext2D, x: number, y: number, alpha: number): void;
  mazeFlash(ctx: CanvasRenderingContext2D, board: { x: number; y: number; w: number; h: number }, flash: number): void;
  eatScore(ctx: CanvasRenderingContext2D, text: string, sx: number, sy: number): void;
  callout(ctx: CanvasRenderingContext2D, text: string, fill: string): void;
  calloutFill: { speed: string; ko: string; eat: string };
  powerModes(
    ctx: CanvasRenderingContext2D,
    input: { powerActive: PacMode; powerQueued: PacMode },
  ): void;
  pelletClock(ctx: CanvasRenderingContext2D, cx: number, cy: number, fill: number): void;
}

/** The panel fields the side-grid painter reads. */
export interface PanelSim {
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
}

export interface Theme {
  id: ThemeId;
  /** Picker label. */
  label: string;
  css: ThemeCss;
  fonts: ThemeFonts;
  strings: ThemeStrings;
  cpuNames: readonly string[];
  sounds: ThemeSounds;
  ghostColor: (id: GhostId) => string;
  sleeperColor: string;
  trainColor: (index: number, total: number) => string;
  paint: ThemePaint;
}
