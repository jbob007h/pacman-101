import type { InboundJammer } from '../gameplay/inbound';
import { koVoiceOnEnd, koVoiceOnScore, type KoVoiceState } from '../systems/knockouts';
import { activeTheme } from '../theme';
import type { ToneStep } from '../theme/types';

const MUTE_KEY = '101-muted';
/** Overall level. Individual cues stay under this so overlaps do not clip. */
const MASTER = 0.7;
const DOT_GAP = 0.09;

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
  private voice: KoVoiceState = { busy: false, holdDouble: false };

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
    if (muted) {
      this.voice = { busy: false, holdDouble: false };
      this.cancelSpeech();
    }
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
    this.voice = { busy: false, holdDouble: false };
    this.cancelSpeech();
  }

  start(): void {
    this.play('start', () => this.playSteps(activeTheme().sounds.start));
  }

  /** One short blip per countdown beat. `go` is the release cue. */
  countdown(beat: number, go: boolean): void {
    this.play(go ? 'countdown-go' : 'countdown', () => {
      const sounds = activeTheme().sounds;
      this.playSteps(go ? sounds.countdownGo : sounds.countdown(beat));
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
    const sounds = activeTheme().sounds;
    this.play(high ? 'dot-hi' : 'dot-lo', () => this.playSteps(high ? sounds.dotHi : sounds.dotLo));
  }

  pellet(): void {
    this.skipDot = true;
    this.play('pellet', () => this.playSteps(activeTheme().sounds.pellet));
  }

  wake(): void {
    this.play('wake', () => this.playSteps(activeTheme().sounds.wake));
  }

  /** A train follower, shorter than a main-ghost eat. */
  trainEat(combo: number): void {
    this.play('train-eat', () => this.playSteps(activeTheme().sounds.trainEat(combo)));
  }

  ghost(combo: number): void {
    this.play('ghost', () => this.playSteps(activeTheme().sounds.ghost(combo)));
  }

  fruitSpawn(): void {
    this.play('fruit-spawn', () => this.playSteps(activeTheme().sounds.fruitSpawn));
  }

  fruitEat(): void {
    this.play('fruit', () => this.playSteps(activeTheme().sounds.fruit));
  }

  boardClear(): void {
    this.play('clear', () => this.playSteps(activeTheme().sounds.clear));
  }

  whiteHit(): void {
    this.play('white-hit', () => this.playSteps(activeTheme().sounds.whiteHit));
  }

  whiteWipe(): void {
    this.play('white-wipe', () => this.playSteps(activeTheme().sounds.whiteWipe));
  }

  redSpawn(): void {
    this.play('red-spawn', () => this.playSteps(activeTheme().sounds.redSpawn));
  }

  /** Thud when an incoming attack reaches the ghost house. */
  impact(): void {
    this.play('impact', () => this.playSteps(activeTheme().sounds.impact));
  }

  /**
   * Local KO. A short hit always plays (unless muted). Speech says "K.O."
   * once at a time, then "Double K.O." if more landed while that line was going.
   */
  ko(): void {
    this.play('ko', () => this.playSteps(activeTheme().sounds.ko));
    if (this.muted) return;
    const next = koVoiceOnScore(this.voice);
    this.voice = next.state;
    if (next.speak) this.utter(next.speak);
  }

  death(): void {
    this.play('death', () => this.playSteps(activeTheme().sounds.death));
  }

  win(): void {
    this.play('win', () => this.playSteps(activeTheme().sounds.win));
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

  private utter(text: 'K.O.' | 'Double K.O.'): void {
    const synth = speechSynth();
    this.log.push(text === 'K.O.' ? 'ko-voice' : 'ko-voice-double');
    if (!synth) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.35;
    utter.pitch = 0.62;
    utter.volume = 1;
    utter.onend = () => {
      if (this.muted) {
        this.voice = { busy: false, holdDouble: false };
        return;
      }
      const next = koVoiceOnEnd(this.voice);
      this.voice = next.state;
      if (next.speak) this.utter(next.speak);
    };
    try {
      synth.speak(utter);
    } catch {
      const next = koVoiceOnEnd(this.voice);
      this.voice = next.state;
    }
  }

  private cancelSpeech(): void {
    const synth = speechSynth();
    try {
      synth?.cancel();
    } catch {
      /* no speech engine */
    }
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

  private playSteps(steps: readonly ToneStep[]): void {
    for (const step of steps) {
      if (step.type === 'noise') this.burst(step.dur, step.gain);
      else this.tone(step.freq, step.dur, step.type, step.gain, step.delay ?? 0, step.slideTo);
    }
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

function speechSynth(): SpeechSynthesis | null {
  const host = globalThis as { speechSynthesis?: SpeechSynthesis };
  return host.speechSynthesis ?? null;
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
