import type { EventBus } from '../shared/events';
import type { SimWorld } from './sims';

export type MatchPhase = 'playing' | 'won' | 'lost';

/** Alive counter and win/loss. Player death becomes an elimination (one life). */
export class Match {
  phase: MatchPhase = 'playing';

  constructor(
    private readonly bus: EventBus,
    private readonly sims: SimWorld,
  ) {
    bus.on('playerDied', () => {
      if (this.phase !== 'playing') return;
      this.phase = 'lost';
      this.bus.emit({ type: 'playerEliminated' });
      this.bus.emit({ type: 'matchLost' });
    });
    bus.on('simEliminated', () => {
      if (this.phase !== 'playing') return;
      if (this.sims.aliveCount() === 0) {
        this.phase = 'won';
        this.bus.emit({ type: 'matchWon' });
      }
    });
  }

  /** Humans plus living sims. Starts at 101. */
  remaining(): number {
    const you = this.phase === 'lost' ? 0 : 1;
    return you + this.sims.aliveCount();
  }

  reset(): void {
    this.phase = 'playing';
  }
}
