import {
  CLEAR_PRESSURE,
  DOT_MILESTONE,
  DOT_PRESSURE,
  GHOST_PRESSURE_BASE,
  GHOST_PRESSURE_STEP,
} from '../config';
import type { GameplayEvent } from '../shared/events';
import type { AttackKind } from './protocol';

export interface EarnClaim {
  attack: AttackKind;
  strength: number;
}

/**
 * Pressure claim for a local earn. Matches {@link jammersFromEvent} strengths.
 * Train-only eats are not earns. A clear is one claim, not eight targets —
 * the server picks who gets hit.
 */
export function earnFromEvent(event: GameplayEvent): EarnClaim | null {
  if (event.type === 'ghostEaten') {
    return {
      attack: 'ghost',
      strength: GHOST_PRESSURE_BASE + event.strength * GHOST_PRESSURE_STEP,
    };
  }
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
