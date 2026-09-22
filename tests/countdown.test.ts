import { describe, expect, it } from 'vitest';
import { COUNTDOWN_BEAT_FRAMES, PAC_START } from '../src/config';
import { Game } from '../src/game';
import { DIR_RIGHT } from '../src/shared/types';

describe('start countdown', () => {
  it('holds Pac for Ready, 3, 2, 1, then launches him left on Hit it!', () => {
    const game = new Game(() => 0);
    expect(game.hud().countdown).toBeNull();

    game.startMatch();
    expect(game.hud().countdown).toBe('Ready…');
    expect(game.hud().status).toBe('Ready…');
    expect(game.sfx.log).toEqual(['countdown']);
    expect(game.board.pac.x).toBe(PAC_START.x);
    expect(game.board.pac.y).toBe(PAC_START.y);
    const startX = game.board.pac.x;
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    const ghostX = blinky.x;

    for (let frame = 0; frame < COUNTDOWN_BEAT_FRAMES; frame++) {
      game.setDirection(DIR_RIGHT);
      game.update(1 / 60);
      expect(game.hud().countdown).toBe('Ready…');
      expect(game.board.pac.x).toBe(startX);
      expect(game.board.pac.dir).toEqual({ x: 0, y: 0 });
    }
    expect(blinky.x).toBe(ghostX);
    expect(game.hud().time).toBe('0:00');
    expect(game.acceptsInput).toBe(false);

    for (const label of ['3…', '2…', '1…']) {
      game.setDirection(DIR_RIGHT);
      game.update(1 / 60);
      expect(game.hud().countdown).toBe(label);
      for (let frame = 1; frame < COUNTDOWN_BEAT_FRAMES; frame++) {
        game.setDirection(DIR_RIGHT);
        game.update(1 / 60);
        expect(game.hud().countdown).toBe(label);
        expect(game.board.pac.x).toBe(startX);
      }
    }

    game.setDirection(DIR_RIGHT);
    game.update(1 / 60);
    expect(game.hud().countdown).toBe('Hit it!');
    expect(game.acceptsInput).toBe(true);
    expect(game.board.pac.dir.x).toBe(-1);
    expect(game.board.pac.x).toBeLessThan(PAC_START.x);
    expect(game.sfx.log.filter((name) => name === 'countdown')).toHaveLength(4);
    expect(game.sfx.log).toContain('countdown-go');

    const launchedX = game.board.pac.x;
    game.setDirection(DIR_RIGHT);
    game.update(1 / 60);
    expect(game.board.pac.dir.x).toBe(1);
    expect(game.board.pac.x).toBeGreaterThan(launchedX);
  });

  it('leaves tests that call restart able to move on the next frame', () => {
    const game = new Game(() => 0);
    game.startMatch();
    game.restart();
    expect(game.hud().countdown).toBeNull();
    expect(game.board.pac.x).toBe(PAC_START.x);
    expect(game.board.pac.y).toBe(PAC_START.y);
    game.board.pac.dir = { x: -1, y: 0 };
    const x = game.board.pac.x;
    game.update(1 / 60);
    expect(game.board.pac.x).toBeLessThan(x);
  });
});
