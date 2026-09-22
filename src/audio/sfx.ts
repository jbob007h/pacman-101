import type { InboundJammer } from '../gameplay/inbound';

const MUTE_KEY = '101-muted';
/** Overall level. Individual cues stay under this so overlaps do not clip. */
const MASTER = 0.7;
const DOT_GAP = 0.09;
/** Higher wakawaka tone, in Hz. */
const DOT_HI = 980;
/** Lower wakawaka tone, in Hz. */
const DOT_LO = 620;

export interface SfxWatch {
  jammers: readonly InboundJammer[];
  slow: number;
  fruit: boolean;
  boardIndex: number;
}

/**
 * Short tones made in the browser with Web Audio. Nothing is fetched, and a
 * missing audio device is ignored so the match still runs.
 */
export class Sfx {
  /** Cue names that were accepted (muted cues are not listed). */
  readonly log: string[] = [];
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private clock = 0;
  private lastDot = -1;
  /** Next dot cue is the high tone when true. Flips every accepted click. */
  private nextDotHigh = true;
  private skipDot = false;
  private known = new WeakSet<InboundJammer>();
  private whiteDying = new WeakSet<InboundJammer>();
  private fruitOn = false;
  private boardSeen = 0;
  private slow = 0;

  constructor(context?: AudioContext) {
    this.muted = readMuted();
    if (context) this.attach(context);
  }

  /** Call from a click or key so the browser will allow sound. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = audioContextCtor();
    if (!Ctx) return;
    try {
      this.attach(new Ctx());
    } catch {
      this.ctx = null;
      this.master = null;
    }
  }

  toggle(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      const gain = this.master.gain;
      gain.cancelScheduledValues(this.ctx.currentTime);
      gain.setValueAtTime(muted ? 0 : MASTER, this.ctx.currentTime);
    }
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      /* private mode */
    }
  }

  tick(dt: number): void {
    this.clock += dt;
  }

  /** Forget board watches. Used when a match restarts. */
  resetWatch(): void {
    this.known = new WeakSet();
    this.whiteDying = new WeakSet();
    this.fruitOn = false;
    this.boardSeen = 0;
    this.slow = 0;
    this.skipDot = false;
  }

  start(): void {
    this.play('start', () => {
      this.tone(392, 0.08, 'square', 0.05);
      this.tone(523, 0.09, 'square', 0.055, 0.08);
      this.tone(659, 0.14, 'square', 0.06, 0.16);
    });
  }

  /** One short blip per countdown beat. `go` is the Hit it! cue. */
  countdown(beat: number, go: boolean): void {
    this.play(go ? 'countdown-go' : 'countdown', () => {
      if (go) {
        this.tone(523, 0.07, 'square', 0.05);
        this.tone(784, 0.16, 'square', 0.06, 0.07);
        return;
      }
      const freq = [330, 392, 440, 494][beat] ?? 440;
      this.tone(freq, 0.08, 'square', 0.045);
    });
  }

  /**
   * Alternating high / low wakawaka. Throttled so a corridor of dots stays
   * musical instead of a machine-gun.
   */
  dot(): void {
    if (this.skipDot) {
      this.skipDot = false;
      return;
    }
    if (this.now() - this.lastDot < DOT_GAP) return;
    this.lastDot = this.now();
    const high = this.nextDotHigh;
    this.nextDotHigh = !this.nextDotHigh;
    const freq = high ? DOT_HI : DOT_LO;
    this.play(high ? 'dot-hi' : 'dot-lo', () => this.tone(freq, 0.042, 'square', 0.034));
  }

  pellet(): void {
    this.skipDot = true;
    this.play('pellet', () => {
      this.tone(160, 0.26, 'sawtooth', 0.06, 0, 480);
      this.tone(640, 0.12, 'square', 0.04, 0.05);
    });
  }

  ghost(combo: number): void {
    const base = 500 + Math.min(8, Math.max(1, combo)) * 55;
    this.play('ghost', () => {
      this.tone(96, 0.07, 'sine', 0.05);
      this.tone(base, 0.08, 'sine', 0.08);
      this.tone(base * 1.5, 0.1, 'triangle', 0.05, 0.06);
    });
  }

  fruitSpawn(): void {
    this.play('fruit-spawn', () => {
      this.tone(740, 0.12, 'sine', 0.04);
      this.tone(988, 0.14, 'triangle', 0.035, 0.05);
    });
  }

  fruitEat(): void {
    this.play('fruit', () => {
      this.tone(440, 0.1, 'triangle', 0.06);
      this.tone(554, 0.1, 'triangle', 0.06, 0.09);
      this.tone(659, 0.16, 'triangle', 0.07, 0.18);
    });
  }

  boardClear(): void {
    this.play('clear', () => {
      this.tone(392, 0.07, 'square', 0.045);
      this.tone(523, 0.08, 'square', 0.05, 0.06);
      this.tone(659, 0.09, 'square', 0.05, 0.12);
      this.tone(880, 0.16, 'triangle', 0.045, 0.2);
    });
  }

  whiteHit(): void {
    this.play('white-hit', () => this.tone(420, 0.22, 'sine', 0.07, 0, 140));
  }

  whiteWipe(): void {
    this.play('white-wipe', () => {
      this.tone(880, 0.06, 'square', 0.04);
      this.burst(0.07, 0.04);
    });
  }

  redSpawn(): void {
    this.play('red-spawn', () => this.tone(98, 0.14, 'square', 0.06, 0, 70));
  }

  /** Thud when an incoming attack reaches the ghost house. */
  impact(): void {
    this.play('impact', () => {
      this.tone(150, 0.1, 'sawtooth', 0.06, 0, 70);
      this.burst(0.09, 0.045);
    });
  }

  death(): void {
    this.play('death', () => {
      this.tone(420, 0.38, 'sawtooth', 0.07, 0, 70);
      this.burst(0.28, 0.05);
    });
  }

  win(): void {
    this.play('win', () => {
      const notes = [523, 659, 784, 1046];
      for (let i = 0; i < notes.length; i++) this.tone(notes[i] ?? 523, 0.16, 'triangle', 0.07, i * 0.09);
    });
  }

  /**
   * Fruit, red spawns, white hits, and white wipes are not bus events.
   * Compare this frame with the last one.
   */
  sync(state: SfxWatch): void {
    let newReds = 0;
    let whiteDeaths = 0;
    for (const jammer of state.jammers) {
      if (!this.known.has(jammer)) {
        this.known.add(jammer);
        if (jammer.kind === 'red' && jammer.phase === 'spawn') newReds += 1;
        continue;
      }
      if (jammer.kind === 'white' && jammer.phase === 'dying' && !this.whiteDying.has(jammer)) {
        this.whiteDying.add(jammer);
        whiteDeaths += 1;
      }
    }
    if (state.fruit && !this.fruitOn) this.fruitSpawn();
    if (!state.fruit && this.fruitOn && state.boardIndex > this.boardSeen) this.fruitEat();
    this.fruitOn = state.fruit;
    this.boardSeen = state.boardIndex;

    const slowed = state.slow > this.slow + 0.001;
    this.slow = state.slow;
    if (newReds > 0) this.redSpawn();
    if (slowed) this.whiteHit();
    else if (whiteDeaths > 0) this.whiteWipe();
  }

  private play(name: string, body: () => void): void {
    if (this.muted) return;
    this.log.push(name);
    if (!this.ctx || !this.master) return;
    try {
      body();
    } catch {
      /* the graph was rejected; keep playing the match */
    }
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : this.clock;
  }

  private attach(ctx: AudioContext): void {
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : MASTER;
    master.connect(ctx.destination);
    this.master = master;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    delay = 0,
    slideTo?: number,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + dur);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t + Math.min(0.012, dur * 0.4));
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp);
    amp.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private burst(dur: number, gain: number): void {
    const ctx = this.ctx;
    const master = this.master;
    const buffer = this.ensureNoise();
    if (!ctx || !master || !buffer) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    const amp = ctx.createGain();
    src.buffer = buffer;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(amp);
    amp.connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private ensureNoise(): AudioBuffer | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.max(8, Math.floor(ctx.sampleRate * 0.2));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }
}

function audioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.AudioContext;
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}
