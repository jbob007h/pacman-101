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
  /** Knockouts this player has scored. */
  kos: number;
  /** The local player knocked this row out. */
  koByYou: boolean;
  /** This row knocked the local player out. Stays set after they are eliminated. */
  koYou: boolean;
}

export interface KoRowMarks {
  kos: number;
  koByYou: boolean;
  koYou: boolean;
}

const NO_MARKS: KoRowMarks = { kos: 0, koByYou: false, koYou: false };

export interface StandingMark {
  className: 'ko-icon' | 'kod-icon' | 'ko-total';
  text: string;
  title: string;
}

/** Visible KO count. Zero stays on the row so the column is never blank. */
export function koCountLabel(kos: number): string {
  const n = Number.isFinite(kos) ? Math.max(0, Math.floor(kos)) : 0;
  return `KO ${n}`;
}

/**
 * Red ✕ when you knocked them out, gold ◉ when they knocked you out,
 * then the KO count on every row.
 */
export function standingMarks(row: Pick<StandingRow, 'kos' | 'koByYou' | 'koYou'>): StandingMark[] {
  const marks: StandingMark[] = [];
  if (row.koByYou) {
    marks.push({ className: 'ko-icon', text: '✕', title: 'You knocked them out' });
  }
  if (row.koYou) {
    marks.push({ className: 'kod-icon', text: '◉', title: 'Knocked you out' });
  }
  const label = koCountLabel(row.kos);
  marks.push({ className: 'ko-total', text: label, title: label });
  return marks;
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
  /** Placed rows keep id so KO marks can refresh while the list is open. */
  private readonly placed: { id: number; place: number; name: string; you: boolean }[] = [];
  /** `0` is the local player. Sim ids are 1..100. */
  private marksFor: (id: number) => KoRowMarks = () => NO_MARKS;

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

  /** Live KO marks. Called again on every snapshot so counts stay current. */
  setKoMarks(marksFor: (id: number) => KoRowMarks): void {
    this.marksFor = marksFor;
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
      this.placed.push({ id: row.id, place, name: row.name, you: false });
      place += 1;
    }
  }

  snapshot(): StandingSnapshot {
    const active: StandingRow[] = [];
    for (let id = 1; id <= SIM_COUNT; id++) {
      if (!this.alive.has(simKey(id))) continue;
      active.push(this.decorate(id, { place: null, name: cpuName(id), you: false, state: 'active' }));
    }
    active.sort((a, b) => a.name.localeCompare(b.name));
    const out = [...this.placed]
      .sort((a, b) => a.place - b.place)
      .map((row) => this.decorate(row.id, { place: row.place, name: row.name, you: row.you, state: 'out' }));
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
      id: you ? 0 : simIdFromKey(key),
      place: this.alive.size + 1,
      name,
      you,
    });
    if (this.alive.size === 1 && this.alive.has(YOU)) this.eliminate(YOU, this.playerName, true);
  }

  private decorate(id: number, row: Omit<StandingRow, 'kos' | 'koByYou' | 'koYou'>): StandingRow {
    const marks = this.marksFor(id);
    return { ...row, kos: marks.kos, koByYou: marks.koByYou, koYou: marks.koYou };
  }
}

function simKey(id: number): string {
  return `sim:${id}`;
}

function simIdFromKey(key: string): number {
  const id = Number(key.slice(4));
  return Number.isFinite(id) ? id : 0;
}
