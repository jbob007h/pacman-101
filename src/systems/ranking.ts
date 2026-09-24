import { SIM_COUNT } from '../config';
import type { EventBus } from '../shared/events';
import { cpuName } from './names';

const YOU = 'you';

export interface StandingRow {
  /** Null while this player is still alive. A number is a locked finish. */
  place: number | null;
  name: string;
  you: boolean;
  state: 'active' | 'out';
}

export interface StandingSnapshot {
  rows: StandingRow[];
  /** Locked finish for the human, or null while they are still alive. */
  yourPlace: number | null;
  stillIn: number;
}

/**
 * Finish order for all 101 players.
 *
 * A death locks `place = survivors + 1`, where survivors are the players still
 * alive after that death. The first one out is 101st. The last one standing,
 * when they finally fall, is 1st. If the human is the one left, that win locks
 * them in 1st immediately. Living players keep `place === null` — the
 * standings show them as still active with a blank placement. When a sim dies
 * later, that blank closes and their name appears on the newly locked place.
 * Earlier finishes do not move.
 */
export class Ranking {
  private playerName: string;
  private readonly alive = new Set<string>();
  private readonly placed: StandingRow[] = [];

  constructor(
    bus: EventBus,
    playerName: string,
  ) {
    this.playerName = playerName;
    this.markEveryoneAlive();
    bus.on('playerEliminated', () => this.eliminate(YOU, this.playerName, true));
    bus.on('simEliminated', (event) => this.eliminate(simKey(event.simId), cpuName(event.simId), false));
  }

  reset(playerName: string): void {
    this.playerName = playerName;
    this.placed.length = 0;
    this.markEveryoneAlive();
  }

  /** Used the next time the human is eliminated. A finish already locked keeps its name. */
  setPlayerName(playerName: string): void {
    this.playerName = playerName;
  }

  nameForSim(simId: number): string {
    return cpuName(simId);
  }

  /**
   * Lock the players who are still alive, best first.
   * Used when a local match is ended while CPUs are still going.
   * Places already locked from earlier eliminations stay put.
   */
  sealSims(order: readonly { id: number; name: string }[]): void {
    let place = 1;
    for (const row of order) {
      if (!this.alive.delete(simKey(row.id))) continue;
      this.placed.push({ place, name: row.name, you: false, state: 'out' });
      place += 1;
    }
  }

  snapshot(): StandingSnapshot {
    const active: StandingRow[] = [];
    for (let id = 1; id <= SIM_COUNT; id++) {
      if (!this.alive.has(simKey(id))) continue;
      active.push({ place: null, name: cpuName(id), you: false, state: 'active' });
    }
    active.sort((a, b) => a.name.localeCompare(b.name));
    const out = [...this.placed].sort((a, b) => (a.place ?? 0) - (b.place ?? 0));
    const yours = this.placed.find((row) => row.you);
    return {
      rows: [...active, ...out],
      yourPlace: yours?.place ?? null,
      stillIn: this.alive.size,
    };
  }

  private markEveryoneAlive(): void {
    this.alive.clear();
    this.alive.add(YOU);
    for (let id = 1; id <= SIM_COUNT; id++) this.alive.add(simKey(id));
  }

  private eliminate(key: string, name: string, you: boolean): void {
    if (!this.alive.delete(key)) return;
    this.placed.push({
      place: this.alive.size + 1,
      name,
      you,
      state: 'out',
    });
    if (this.alive.size === 1 && this.alive.has(YOU)) this.eliminate(YOU, this.playerName, true);
  }
}

function simKey(id: number): string {
  return `sim:${id}`;
}
