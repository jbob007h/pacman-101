import { SIM_COUNT } from '../config';

/** Shown when the name field is empty. Remembered for this browser. */
export const DEFAULT_PLAYER_NAME = 'Pac';
const NAME_KEY = 'pacman-101-player-name';
const NAME_LIMIT = 16;

/**
 * One hundred fixed opponent names. Ids 1–100 use this list in order, so a
 * sim keeps the same name for the whole session and across restarts.
 */
export const CPU_NAMES: readonly string[] = [
  'botcheeks',
  'el bot-tastico',
  'sir botalot',
  'byte me gently',
  'beep boop',
  'whirlybot',
  'captain cache',
  'lady logic',
  'tin can can',
  'servo sweetie',
  'algorhythm',
  'miss circuit',
  'bolt buddy',
  'pixel pips',
  'the cogfather',
  'watt a bot',
  'gearloose',
  'robo robin',
  'clankers',
  'zippy diode',
  'mama motherboard',
  'chip cheerio',
  'drone alone',
  'beepresso',
  'sir spamalot',
  'botato chip',
  'whirbot',
  'lady bugbyte',
  'tin lizzy',
  'cogsworth jr',
  'data daisy',
  'blink bot',
  'jammer jam',
  'pelletina',
  'dot dot dash',
  'wakawaka bot',
  'tunnel tony',
  'house bot',
  'elroy junior',
  'cruise control',
  'scatter brain',
  'chase case',
  'fright bot',
  'eye see you',
  'jam on it',
  'pressure cooker',
  'stack attack',
  'sideboard sam',
  'mini maze',
  'panel pal',
  'red jam jar',
  'white out bot',
  'slow poke droid',
  'board boss',
  'clearbot',
  'last byte',
  'one oh fun',
  'bot and soul',
  'neural nellie',
  'tensor tina',
  'gradient greg',
  'overfit olive',
  'epoch eddie',
  'batch betty',
  'token tommy',
  'prompt princess',
  'halluci-nate',
  'temp tom',
  'top-p pip',
  'vector vince',
  'cosine carly',
  'kernel kevin',
  'softmax sophie',
  'relu ruby',
  'dropout danny',
  'bias betty',
  'checkpoint charlie',
  'fine-tune fiona',
  'zero-shot zoe',
  'rag doll droid',
  'widget wendy',
  'gizmo gertie',
  'sprocket sue',
  'android andy',
  'cyborg cindy',
  'droid david',
  'mech martha',
  'piston penny',
  'rivet rita',
  'solder sally',
  'toggle tina',
  'usb ursula',
  'vram vicky',
  'wifi willy',
  'xml xavier',
  'yaml yolanda',
  'zip file zed',
  'botox the bot',
  'eliza electric',
  'clippy cousin',
];

export function cpuName(simId: number): string {
  return CPU_NAMES[simId - 1] ?? `bot ${simId}`;
}

export function sanitizePlayerName(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, NAME_LIMIT);
}

type NameStore = Pick<Storage, 'getItem' | 'setItem'>;

function browserStore(): NameStore | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Saved name, or {@link DEFAULT_PLAYER_NAME} when the field is blank or storage is missing. */
export function loadPlayerName(store: NameStore | null = browserStore()): string {
  try {
    const saved = sanitizePlayerName(store?.getItem(NAME_KEY));
    return saved || DEFAULT_PLAYER_NAME;
  } catch {
    return DEFAULT_PLAYER_NAME;
  }
}

/** Persist a trimmed name. Blank becomes {@link DEFAULT_PLAYER_NAME}. */
export function savePlayerName(raw: string, store: NameStore | null = browserStore()): string {
  const name = sanitizePlayerName(raw) || DEFAULT_PLAYER_NAME;
  try {
    store?.setItem(NAME_KEY, name);
  } catch {
    /* private mode and tests can play without storage */
  }
  return name;
}

if (CPU_NAMES.length !== SIM_COUNT) {
  throw new Error(`expected ${SIM_COUNT} cpu names, found ${CPU_NAMES.length}`);
}
