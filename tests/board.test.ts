import { describe, expect, it } from 'vitest';
import { GHOST_ATTACK_WINDOW, SPEED_POPUP_SECONDS } from '../src/config';
import { Game } from '../src/game';
import { ghostDrawMode } from '../src/render/draw';
import type { Dir } from '../src/shared/types';
import { DIR_DOWN, DIR_LEFT, DIR_UP } from '../src/shared/types';

describe('main board', () => {
  it('can reach a power pellet, frighten ghosts, and emit ghostEaten', () => {
    const game = new Game(() => 0);
    const seen: string[] = [];
    game.bus.on('powerPelletEaten', () => seen.push('pellet'));
    game.bus.on('ghostEaten', (event) => seen.push(`ghost:${event.strength}`));

    for (const ghost of game.board.ghosts) {
      ghost.mode = 'house';
      ghost.x = 13;
      ghost.y = 14;
      ghost.releaseAt = 1e9;
    }

    let atePellet = false;
    for (let i = 0; i < 60 * 8 && !atePellet; i++) {
      game.board.pac.queued = steer(game.board.pac.x, game.board.pac.y);
      game.update(1 / 60);
      atePellet = seen.includes('pellet');
    }
    expect(atePellet).toBe(true);
    expect(game.board.pac.alive).toBe(true);
    expect(game.board.frightened).toBeGreaterThan(0);

    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    blinky.mode = 'frightened';
    blinky.x = game.board.pac.x;
    blinky.y = game.board.pac.y;
    game.update(1 / 60);
    expect(seen.some((event) => event.startsWith('ghost:'))).toBe(true);
    game.sims.advanceGhostWindow(GHOST_ATTACK_WINDOW);
    expect(game.sims.sims.some((sim) => sim.pressure > 0 || !sim.alive)).toBe(true);
  });

  it('lets an eaten ghost leave the house deadly while the same pellet is still running', () => {
    const game = new Game(() => 0.5);
    for (const ghost of game.board.ghosts) {
      ghost.mode = 'house';
      ghost.releaseAt = 1e9;
    }
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    blinky.mode = 'frightened';
    blinky.x = 5;
    blinky.y = 5;
    game.board.pac.x = 5;
    game.board.pac.y = 5;
    game.board.pac.dir = { x: 0, y: 0 };
    game.board.frightened = 9;
    game.update(0);
    expect(blinky.mode).toBe('eaten');
    expect(blinky.skipFright).toBe(true);

    blinky.mode = 'house';
    blinky.x = 14;
    blinky.y = 14;
    blinky.releaseAt = 0;
    blinky.dir = { x: 0, y: -1 };
    game.board.pac.x = 20;
    game.board.pac.y = 23;
    game.board.pac.dir = { x: -1, y: 0 };
    let mode: string = blinky.mode;
    for (let i = 0; i < 160 && mode !== 'scatter'; i++) {
      game.update(1 / 60);
      mode = blinky.mode;
    }
    expect(blinky.mode).toBe('scatter');
    expect(blinky.skipFright).toBe(true);
    expect(game.board.frightened).toBeGreaterThan(1);
    expect(game.board.pac.alive).toBe(true);

    game.board.pac.x = blinky.x;
    game.board.pac.y = blinky.y;
    game.board.pac.dir = { x: 0, y: 0 };
    game.update(0);
    expect(game.board.pac.alive).toBe(false);
    expect(game.board.frightened).toBeGreaterThan(1);
  });

  it('frightens a returned ghost only after another power pellet', () => {
    const game = new Game(() => 0.5);
    for (const ghost of game.board.ghosts) {
      ghost.mode = 'house';
      ghost.releaseAt = 1e9;
    }
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    blinky.mode = 'chase';
    blinky.skipFright = true;
    blinky.x = 14;
    blinky.y = 11;
    game.board.frightened = 9;
    game.board.pac.x = 1;
    game.board.pac.y = 23;
    game.board.pac.dir = { x: 1, y: 0 };
    game.update(1 / 60);
    expect(game.board.frightened).toBeGreaterThan(8);
    expect(blinky.skipFright).toBe(false);
    expect(blinky.mode).toBe('frightened');
  });

  it('does not eat a house ghost while a pellet only changes how it is drawn', () => {
    const game = new Game(() => 0.5);
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    blinky.mode = 'house';
    blinky.skipFright = false;
    blinky.x = 5;
    blinky.y = 5;
    game.board.frightened = 9;
    game.board.pac.x = 5;
    game.board.pac.y = 5;
    game.board.pac.dir = { x: 0, y: 0 };
    game.update(0);
    expect(game.board.pac.alive).toBe(true);
    expect(blinky.mode).toBe('house');
    expect(game.board.score).toBe(0);
    expect(ghostDrawMode(blinky.mode, blinky.skipFright, game.board.frightened)).toBe('frightened');
    expect(ghostDrawMode('house', true, 9)).toBe('house');
    expect(ghostDrawMode('eaten', false, 9)).toBe('eaten');
  });

  it('clears skipFright in the house on a new pellet without making that ghost edible', () => {
    const game = new Game(() => 0.5);
    for (const ghost of game.board.ghosts) {
      ghost.mode = 'house';
      ghost.releaseAt = 1e9;
      ghost.skipFright = true;
    }
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    blinky.x = 14;
    blinky.y = 14;
    game.board.pac.x = 1;
    game.board.pac.y = 23;
    game.board.pac.dir = { x: 1, y: 0 };
    game.update(1 / 60);
    expect(blinky.mode).toBe('house');
    expect(blinky.skipFright).toBe(false);
    expect(game.board.frightened).toBeGreaterThan(8);
    expect(ghostDrawMode(blinky.mode, blinky.skipFright, game.board.frightened)).toBe('frightened');

    const score = game.board.score;
    game.board.pac.dir = { x: 0, y: 0 };
    game.board.pac.x = blinky.x;
    game.board.pac.y = blinky.y;
    game.update(0);
    expect(blinky.mode).toBe('house');
    expect(game.board.pac.alive).toBe(true);
    expect(game.board.score).toBe(score);
  });

  it('replaces one eat-count popup and starts the next pellet at 1', () => {
    const game = new Game(() => 0.5);
    const blinky = game.board.ghosts[0];
    const pinky = game.board.ghosts[1];
    const clyde = game.board.ghosts[3];
    if (!blinky || !pinky || !clyde) throw new Error('missing ghosts');
    game.board.pac.dir = { x: 0, y: 0 };
    game.board.frightened = 9;
    game.board.pac.x = 5;
    game.board.pac.y = 5;
    blinky.mode = 'frightened';
    blinky.x = 5;
    blinky.y = 5;
    game.update(0);
    expect(game.board.eatPopupCount).toBe(1);
    expect(game.board.eatPopup).toBe(SPEED_POPUP_SECONDS);
    expect(game.board.eatPopupX).toBe(5);
    expect(game.board.eatPopupY).toBe(5);

    while (game.board.eatPause > 0) game.update(0.05);
    expect(game.board.eatPopup).toBeGreaterThan(0);
    expect(game.board.eatPopup).toBeLessThan(SPEED_POPUP_SECONDS);
    const stillShowing = game.board.eatPopup;
    game.board.pac.x = 8;
    game.board.pac.y = 5;
    pinky.mode = 'frightened';
    pinky.x = 8;
    pinky.y = 5;
    game.update(0);
    expect(game.board.eatPopupCount).toBe(2);
    expect(game.board.eatPopup).toBe(SPEED_POPUP_SECONDS);
    expect(game.board.eatPopup).toBeGreaterThan(stillShowing);
    expect(game.board.eatPopupX).toBe(8);
    expect(game.board.eatPopupY).toBe(5);

    while (game.board.eatPause > 0) game.update(0.05);
    blinky.mode = 'frightened';
    blinky.x = 20;
    blinky.y = 5;
    game.board.train.leaderId = 'blinky';
    game.board.train.followers = [
      {
        id: 1,
        x: 8,
        y: 6,
        dir: { x: -1, y: 0 },
        queued: null,
        centerKey: -1,
        reversePending: false,
        joined: true,
        wakeX: 8,
        wakeY: 6,
      },
    ];
    game.board.pac.x = 8;
    game.board.pac.y = 6;
    game.update(0);
    expect(game.board.eatPopupCount).toBe(3);
    expect(game.board.train.followers).toHaveLength(0);
    expect(game.board.eatPopupX).toBe(8);
    expect(game.board.eatPopupY).toBe(6);

    while (game.board.eatPause > 0) game.update(0.05);
    for (const ghost of game.board.ghosts) {
      ghost.mode = 'house';
      ghost.x = 14;
      ghost.y = 14;
    }
    game.board.frightened = 0.04;
    game.board.pac.x = 8;
    game.board.pac.y = 5;
    game.board.pac.dir = { x: 1, y: 0 };
    game.update(0.05);
    expect(game.board.frightened).toBe(0);
    expect(game.board.combo).toBe(0);

    game.board.pac.dir = { x: 0, y: 0 };
    game.board.frightened = 9;
    clyde.mode = 'frightened';
    clyde.x = 8;
    clyde.y = 5;
    game.board.pac.x = 8;
    game.board.pac.y = 5;
    game.update(0);
    expect(game.board.eatPopupCount).toBe(1);
    expect(game.board.combo).toBe(1);
  });

  it('keeps the eat count when a new pellet refills fright that is still running', () => {
    const game = new Game(() => 0.5);
    const blinky = game.board.ghosts[0];
    const pinky = game.board.ghosts[1];
    const inky = game.board.ghosts[2];
    if (!blinky || !pinky || !inky) throw new Error('missing ghosts');
    for (const ghost of game.board.ghosts) {
      ghost.mode = 'house';
      ghost.releaseAt = 1e9;
    }
    game.board.pac.dir = { x: 0, y: 0 };
    game.board.frightened = 4;
    game.board.pac.x = 5;
    game.board.pac.y = 5;
    blinky.mode = 'frightened';
    blinky.x = 5;
    blinky.y = 5;
    game.update(0);
    while (game.board.eatPause > 0) game.update(0.05);
    pinky.mode = 'frightened';
    pinky.x = 5;
    pinky.y = 5;
    game.update(0);
    expect(game.board.eatPopupCount).toBe(2);

    while (game.board.eatPause > 0) game.update(0.05);
    game.board.pac.x = 1;
    game.board.pac.y = 23;
    game.board.pac.dir = { x: 1, y: 0 };
    game.update(1 / 60);
    expect(game.board.frightened).toBeGreaterThan(8);
    expect(game.board.eatPopupCount).toBe(2);

    game.board.pac.dir = { x: 0, y: 0 };
    game.board.pac.x = 8;
    game.board.pac.y = 5;
    inky.mode = 'frightened';
    inky.x = 8;
    inky.y = 5;
    game.update(0);
    expect(game.board.eatPopupCount).toBe(3);
    expect(game.board.eatPopupX).toBe(8);
  });

  it('opens the match in scatter and switches to chase after that wave', () => {
    const game = new Game(() => 0);
    const blinky = game.board.ghosts[0];
    if (!blinky) throw new Error('missing blinky');
    expect(game.board.wave).toBe('scatter');
    expect(blinky.mode).toBe('scatter');

    for (const ghost of game.board.ghosts) {
      ghost.releaseAt = 1e9;
      if (ghost.id !== 'blinky') ghost.mode = 'house';
    }
    blinky.x = 22;
    blinky.y = 5;
    blinky.dir = { x: 1, y: 0 };
    blinky.mode = 'scatter';
    game.board.pac.dir = { x: -1, y: 0 };

    let frames = 0;
    while (game.board.wave === 'scatter' && frames < 500) {
      game.update(1 / 60);
      frames += 1;
    }
    expect(game.board.pac.alive).toBe(true);
    expect(frames).toBeGreaterThan(300);
    expect(frames).toBeLessThan(420);
    expect(game.board.wave).toBe('chase');
    expect(blinky.mode).toBe('chase');

    game.restart();
    expect(game.board.wave).toBe('scatter');
    expect(game.board.ghosts[0]?.mode).toBe('scatter');
  });
});

function steer(x: number, y: number): Dir {
  if (y > 20.2 && x > 6.1) return { ...DIR_LEFT };
  if (x > 5.8 && y > 20.1) return { ...DIR_UP };
  if (y < 20.4 && x > 1.1) return { ...DIR_LEFT };
  return { ...DIR_DOWN };
}
