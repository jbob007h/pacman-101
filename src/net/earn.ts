import { CLEAR_PRESSURE, DOT_MILESTONE, DOT_PRESSURE } from '../config';
import type { GameplayEvent } from '../shared/events';
import type { AttackKind } from './protocol';

export interface EarnClaim {
  attack: AttackKind;
  strength: number;
}

/**
 * Immediate earns for dots and clears. Ghost eats are not here: they batch in
 * {@link GhostAttackWindow} and leave as one `ghost` earn whose strength is
 * the number of ghosts eaten.
 */
export function earnFromEvent(event: GameplayEvent): EarnClaim | null {
  if (
    event.type === 'dotEaten' &&
    event.remaining > 0 &&
    event.totalEaten > 0 &&
    event.totalEaten % DOT_MILESTONE === 0
  ) {
    return { attack: 'dots', strength: DOT_PRESSURE };
  }
  if (event.type === 'boardCleared') {
    return { attack: 'clear', strength: CLEAR_PRESSURE };
  }
  return null;
}
