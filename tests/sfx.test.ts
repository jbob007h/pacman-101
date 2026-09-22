import { describe, expect, it } from 'vitest';
import { Sfx, type SfxWatch } from '../src/audio/sfx';
import { Game } from '../src/game';
import type { InboundJammer, JammerKind, JammerPhase } from '../src/gameplay/inbound';
import { Tile } from '../src/gameplay/maze';
import { DIR_NONE } from '../src/shared/types';

function jammer(kind: JammerKind, phase: JammerPhase): InboundJammer {
  return {
    kind,
    phase,
    anim: 0,
    centerKey: -1,
    prevX: 0,
    prevY: 0,
    x: 1,
    y: 1,
    dir: { ...DIR_NONE },
    queued: null,
  };
}

function watch(partial: Partial<SfxWatch> = {}): SfxWatch {
  return {
    jammers: [],
    slow: 0,
    fruit: false,
    boardIndex: 0,
    ...partial,
  };
}

describe('generated sound effects', () => {
  it('thins out dot clicks and does not also click on a power pellet', () => {
    const sfx = new Sfx();
    sfx.dot();
    sfx.dot();
    expect(sfx.log).toEqual(['dot']);
    sfx.tick(0.1);
    sfx.dot();
    expect(sfx.log).toEqual(['dot', 'dot']);

    sfx.pellet();
    sfx.dot();
    expect(sfx.log).toEqual(['dot', 'dot', 'pellet']);
  });

  it('plays one red spawn, a fruit pair, a white hit, and a separate wipe', () => {
    const sfx = new Sfx();
    const red = jammer('red', 'spawn');
    sfx.sync(watch({ jammers: [red] }));
    sfx.sync(watch({ jammers: [red] }));
    expect(sfx.log.filter((name) => name === 'red-spawn')).toEqual(['red-spawn']);

    sfx.sync(watch({ fruit: true }));
    sfx.sync(watch({ fruit: false, boardIndex: 1 }));
    expect(sfx.log).toContain('fruit-spawn');
    expect(sfx.log).toContain('fruit');

    const hit = jammer('white', 'live');
    sfx.sync(watch({ jammers: [hit], boardIndex: 1 }));
    hit.phase = 'dying';
    sfx.sync(watch({ jammers: [hit], slow: 0.6, boardIndex: 1 }));
    expect(sfx.log).toContain('white-hit');
    expect(sfx.log).not.toContain('white-wipe');

    const wiped = jammer('white', 'live');
    sfx.sync(watch({ jammers: [wiped], slow: 0.6, boardIndex: 1 }));
    wiped.phase = 'dying';
    sfx.sync(watch({ jammers: [wiped], slow: 0.6, boardIndex: 1 }));
    expect(sfx.log).toContain('white-wipe');
  });

  it('stays quiet while muted and does not fetch audio', () => {
    const sfx = new Sfx();
    sfx.setMuted(true);
    sfx.start();
    sfx.death();
    sfx.win();
    expect(sfx.log).toEqual([]);
    sfx.setMuted(false);
    sfx.win();
    expect(sfx.log).toEqual(['win']);
  });

  it('hooks dots, pellets, ghosts, death, and the win fanfare from the match', () => {
    const game = new Game(() => 0);
    for (const ghost of game.board.ghosts) {
      ghost.mode = 'house';
      ghost.releaseAt = 1e9;
    }
    game.board.pac.dir = { x: 1, y: 0 };
    game.board.pac.x = 5;
    game.board.pac.y = 5;
    game.update(1 / 60);
    expect(game.sfx.log).toContain('dot');

    game.sfx.log.length = 0;
    const pellet = findPellet(game);
    game.board.pac.x = pellet.x;
    game.board.pac.y = pellet.y;
    game.update(1 / 60);
    expect(game.sfx.log).toContain('pellet');
    expect(game.sfx.log).not.toContain('dot');

    game.bus.emit({ type: 'ghostEaten', ghostId: 'blinky', strength: 1, combo: 2 });
    game.bus.emit({ type: 'playerDied' });
    game.bus.emit({ type: 'matchWon' });
    expect(game.sfx.log).toContain('ghost');
    expect(game.sfx.log).toContain('death');
    expect(game.sfx.log).toContain('win');
    expect(game.sfx.log.filter((name) => name === 'death')).toHaveLength(1);
  });
});

function findPellet(game: Game): { x: number; y: number } {
  const maze = game.board.maze;
  for (let y = 0; y < maze.rows; y++) {
    for (let x = 0; x < maze.cols; x++) {
      if (maze.tile(x, y) === Tile.Pellet) return { x, y };
    }
  }
  throw new Error('no power pellet');
}
