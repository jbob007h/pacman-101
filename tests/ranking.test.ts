import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { CPU_NAMES, DEFAULT_PLAYER_NAME, loadPlayerName, savePlayerName } from '../src/systems/names';
import { SIM_COUNT } from '../src/config';

describe('names and standings', () => {
  it('keeps a fixed pool of 100 unique cpu names', () => {
    expect(CPU_NAMES).toHaveLength(SIM_COUNT);
    expect(new Set(CPU_NAMES.map((name) => name.toLowerCase())).size).toBe(SIM_COUNT);
    expect(CPU_NAMES[0]).toBe('botcheeks');
    expect(CPU_NAMES).toContain('el bot-tastico');
    const game = new Game(() => 0.5);
    expect(game.sims.sims.map((sim) => sim.name)).toEqual([...CPU_NAMES]);
  });

  it('stores a trimmed name and falls back to Pac when blank', () => {
    const saved = new Map<string, string>();
    const store = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        saved.set(key, value);
      },
    };
    expect(savePlayerName('  ', store)).toBe(DEFAULT_PLAYER_NAME);
    expect(loadPlayerName(store)).toBe('Pac');
    expect(savePlayerName('  Jason  ', store)).toBe('Jason');
    expect(loadPlayerName(store)).toBe('Jason');
    expect(savePlayerName('a very long name indeed', store)).toBe('a very long name');
  });

  it('locks places from the bottom and leaves the living blank', () => {
    const game = new Game(() => 0.5);
    game.setPlayerName('Jason');
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    game.board.pac.x = blinky.x;
    game.board.pac.y = blinky.y;
    blinky.mode = 'chase';
    game.update(1 / 60);

    const first = game.ranking.snapshot();
    expect(game.match.phase).toBe('lost');
    expect(first.yourPlace).toBe(101);
    expect(first.stillIn).toBe(100);
    expect(first.rows.filter((row) => row.state === 'active').every((row) => row.place === null)).toBe(true);
    expect(first.rows.find((row) => row.you)).toMatchObject({ name: 'Jason', place: 101, state: 'out' });

    game.bus.emit({ type: 'simEliminated', simId: 1, remainingPlayers: 100 });
    const next = game.ranking.snapshot();
    expect(next.yourPlace).toBe(101);
    expect(next.stillIn).toBe(99);
    expect(next.rows.find((row) => row.name === 'botcheeks')).toMatchObject({ place: 100, state: 'out' });
    expect(next.rows.find((row) => row.name === 'el bot-tastico')?.place).toBeNull();
    expect(game.match.phase).toBe('lost');
  });

  it('keeps eliminating cpus after the human is out and shows the list once the death pause ends', () => {
    const game = new Game(() => 0.5);
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    game.board.pac.x = blinky.x;
    game.board.pac.y = blinky.y;
    blinky.mode = 'chase';
    game.board.pac.dir = { x: -1, y: 0 };
    game.update(1 / 60);
    expect(game.hud().standings).toBeNull();

    const aliveAtDeath = game.sims.aliveCount();
    for (let i = 0; i < 600; i++) game.update(0.05);
    expect(game.match.phase).toBe('lost');
    expect(game.sims.aliveCount()).toBeLessThan(aliveAtDeath);
    const hud = game.hud();
    expect(hud.standings).not.toBeNull();
    expect(hud.standings?.yourPlace).toBe(101);
    expect(hud.standings?.rows.some((row) => row.state === 'out' && !row.you)).toBe(true);
    expect(hud.standings?.rows.filter((row) => row.state === 'active').every((row) => row.place === null)).toBe(true);
    expect(game.match.remaining()).toBe(game.sims.aliveCount());
  });
});
