import type { GhostId } from './types';

/**
 * Boundary between Gameplay (maze, Pac, ghosts) and Systems (sims, jammers, match).
 *
 * Gameplay emits facts about the main board. It does not know who the side-board
 * opponents are. Systems subscribe, turn those facts into jammer pressure, and
 * emit match results. Incoming junk is a systems event applied to the board
 * through a narrow method on the composition root — systems never import gameplay.
 */

export type JamReason = 'ghost' | 'dots' | 'clear' | 'sim';

export type GameplayEvent =
  | { type: 'dotEaten'; totalEaten: number; remaining: number }
  | { type: 'powerPelletEaten' }
  | { type: 'ghostEaten'; ghostId: GhostId; strength: number; combo: number }
  | { type: 'boardCleared' }
  | { type: 'playerDied' }
  | { type: 'sleeperWoken' }
  | { type: 'trainGhostEaten'; combo: number };

export type SystemsEvent =
  | { type: 'playerEliminated' }
  | { type: 'simEliminated'; simId: number; remainingPlayers: number }
  | { type: 'jammersSent'; targets: number[]; strength: number; reason: JamReason; fromSimId?: number }
  | { type: 'incomingJammer'; fromSimId: number; strength: number; exact?: boolean }
  /**
   * One batched ghost attack. `count` is the strength sent when the window closes:
   * ghosts eaten, then the active power mode (Stronger ×2, Speed ceil/2, otherwise unchanged).
   */
  | { type: 'ghostVolley'; count: number }
  | { type: 'matchWon' }
  | { type: 'matchLost' };

export type AppEvent = GameplayEvent | SystemsEvent;

type Handler = (event: AppEvent) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler>>();

  on<T extends AppEvent['type']>(
    type: T,
    handler: (event: Extract<AppEvent, { type: T }>) => void,
  ): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const wrapped = handler as Handler;
    set.add(wrapped);
    return () => set.delete(wrapped);
  }

  emit(event: AppEvent): void {
    const set = this.handlers.get(event.type);
    if (!set) return;
    for (const handler of [...set]) handler(event);
  }
}
