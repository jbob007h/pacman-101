/**
 * Knockout credit for one victim.
 *
 * Red contact credits that jammer's sender. A white jammer with a sender
 * credits the last such sender and beats the most recent attack. With no
 * attributed touch, the most recent attack sender is credited. Never attacked
 * credits nobody.
 *
 * A null sender never scores. Train-mode whites are spawned with no sender, so
 * the local maze does not record them as touches: they neither score nor
 * erase an earlier attacker. A reported `{ kind: 'white', sender: null }`
 * (the wire form of a senderless white) credits nobody and does not fall
 * through to the latest attack.
 */

/** Local human, in the offline book. Sim ids are 1..100. Server seats stay 1..101. */
export const LOCAL_PLAYER = 0;

export interface KoMemory {
  /** Sender of the most recent attack that targeted this player. */
  lastAttacker: number | null;
  /** Sender of the last white jammer with a real sender that this player touched. */
  lastWhite: number | null;
  touchedWhite: boolean;
}

export type DeathCause =
  | { kind: 'red'; sender: number | null }
  | { kind: 'white'; sender: number | null }
  | { kind: 'none' };

export function blankMemory(): KoMemory {
  return { lastAttacker: null, lastWhite: null, touchedWhite: false };
}

/** Attacks with no sender (none, today) are ignored. */
export function rememberAttack(memory: KoMemory, sender: number | null): void {
  if (sender == null) return;
  memory.lastAttacker = sender;
}

/**
 * Senderless whites (Train self-spawns) are not a touch.
 * They leave {@link KoMemory.lastWhite} and {@link KoMemory.touchedWhite} alone.
 */
export function rememberWhiteTouch(memory: KoMemory, sender: number | null): void {
  if (sender == null) return;
  memory.lastWhite = sender;
  memory.touchedWhite = true;
}

/** Maze facts the server cannot see, turned into the death report. */
export function causeFromMemory(memory: KoMemory, redSender: number | null | undefined): DeathCause {
  if (redSender !== undefined) return { kind: 'red', sender: redSender };
  if (memory.touchedWhite) return { kind: 'white', sender: memory.lastWhite };
  return { kind: 'none' };
}

/**
 * `lastAttacker` is the server's (or the local book's) most recent attack.
 * Red and white causes use the reported sender, including null.
 * `none` uses the latest attack, or null when this player was never attacked.
 */
export function resolveKnockout(lastAttacker: number | null, cause: DeathCause): number | null {
  if (cause.kind === 'red' || cause.kind === 'white') return cause.sender;
  return lastAttacker;
}

export interface KoVoiceState {
  busy: boolean;
  /** A later KO arrived while a line was already speaking. */
  holdDouble: boolean;
}

/**
 * One utterance at a time. The first KO says "K.O.".
 * Further KOs during that line collapse into a single "Double K.O." when it ends.
 */
export function koVoiceOnScore(state: KoVoiceState): { state: KoVoiceState; speak: 'K.O.' | null } {
  if (state.busy) return { state: { busy: true, holdDouble: true }, speak: null };
  return { state: { busy: true, holdDouble: false }, speak: 'K.O.' };
}

export function koVoiceOnEnd(state: KoVoiceState): { state: KoVoiceState; speak: 'Double K.O.' | null } {
  if (state.holdDouble) return { state: { busy: true, holdDouble: false }, speak: 'Double K.O.' };
  return { state: { busy: false, holdDouble: false }, speak: null };
}

/** Per-player attack memory and credited kills. One book per local match. */
export class KnockoutBook {
  private readonly memory = new Map<number, KoMemory>();
  private readonly counts = new Map<number, number>();
  private readonly killerOf = new Map<number, number>();
  private readonly resolved = new Set<number>();

  reset(): void {
    this.memory.clear();
    this.counts.clear();
    this.killerOf.clear();
    this.resolved.clear();
  }

  noteAttack(victim: number, sender: number | null): void {
    rememberAttack(this.memoryOf(victim), sender);
  }

  noteWhite(victim: number, sender: number | null): void {
    rememberWhiteTouch(this.memoryOf(victim), sender);
  }

  memoryOf(id: number): KoMemory {
    let memory = this.memory.get(id);
    if (!memory) {
      memory = blankMemory();
      this.memory.set(id, memory);
    }
    return memory;
  }

  /**
   * Credit a death once. A null sender, or a self hit, scores nothing.
   * Returns the killer id, or null when nobody is credited.
   */
  award(victim: number, cause: DeathCause): number | null {
    if (this.resolved.has(victim)) return this.killerOf.get(victim) ?? null;
    this.resolved.add(victim);
    const killer = resolveKnockout(this.memoryOf(victim).lastAttacker, cause);
    if (killer == null || killer === victim) return null;
    this.killerOf.set(victim, killer);
    this.counts.set(killer, (this.counts.get(killer) ?? 0) + 1);
    return killer;
  }

  count(id: number): number {
    return this.counts.get(id) ?? 0;
  }

  /** Who knocked this id out, or null. */
  killer(victim: number): number | null {
    return this.killerOf.get(victim) ?? null;
  }
}
