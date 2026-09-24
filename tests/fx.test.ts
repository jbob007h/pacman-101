import { describe, expect, it } from 'vitest';
import { FRUIT_DRAW_SCALE, FRUIT_TILE, PAC_START, TILE } from '../src/config';
import { Game } from '../src/game';
import { ghostHouseCenter, panelCenter } from '../src/render/layout';
import { BoltField, GRID_BOLT_SCALE } from '../src/render/fx';

describe('incoming attack juice', () => {
  it('flies to the ghost house before spawning jammers, then shakes and bursts', () => {
    const fx = new BoltField();
    const from = panelCenter(12);
    const house = ghostHouseCenter();
    const impacts: number[] = [];
    fx.queueIncoming(from, house, 16);
    fx.update(0.2, (strength) => impacts.push(strength));
    expect(impacts).toEqual([]);
    expect(fx.incoming).toHaveLength(1);
    expect(fx.incoming[0]?.sx).toBe(from.x);
    expect(fx.incoming[0]?.tx).toBe(house.x);

    fx.update(0.3, (strength) => impacts.push(strength));
    expect(impacts).toEqual([16]);
    expect(fx.incoming).toHaveLength(0);
    expect(fx.shake).toBeGreaterThan(0);
    expect(fx.flash).toBeGreaterThan(0);
    expect(fx.particles.length).toBeGreaterThan(8);

    fx.update(0.05, (strength) => impacts.push(strength));
    expect(impacts).toEqual([16]);
  });

  it('spawns the inbound jammers when the shot arrives, not when it is thrown', () => {
    const game = new Game(() => 0);
    game.bus.emit({ type: 'incomingJammer', fromSimId: 4, strength: 8 });
    expect(game.board.inbound.jammers).toHaveLength(0);
    for (let frame = 0; frame < 8; frame++) game.update(0.05);
    expect(game.board.inbound.jammers).toHaveLength(0);
    game.update(0.05);
    expect(game.board.inbound.jammers.length).toBeGreaterThan(0);
    expect(game.board.inbound.jammers.every((jammer) => jammer.phase === 'spawn')).toBe(true);
    expect(game.sfx.log).toContain('impact');
  });

  it('draws the fruit at twice the old size, centered on the corridor like Pac', () => {
    expect(FRUIT_DRAW_SCALE).toBe(2);
    expect(FRUIT_TILE.y).toBe(17);
    expect(FRUIT_TILE.x).toBe(PAC_START.x);
    const fruitX = FRUIT_TILE.x * TILE + TILE / 2;
    const pacX = PAC_START.x * TILE + TILE / 2;
    expect(fruitX).toBe(pacX);
  });

  it('sends a smaller bolt from one side panel to another', () => {
    const game = new Game(() => 0);
    const from = panelCenter(2);
    const to = panelCenter(8);
    game.bus.emit({ type: 'jammersSent', targets: [8], strength: 4, reason: 'sim', fromSimId: 2 });
    expect(game.fx.bolts).toHaveLength(1);
    expect(game.fx.bolts[0]).toMatchObject({ sx: from.x, sy: from.y, tx: to.x, ty: to.y, scale: GRID_BOLT_SCALE });
    expect(GRID_BOLT_SCALE).toBeLessThan(1);

    game.fx.clear();
    game.bus.emit({ type: 'jammersSent', targets: [3], strength: 2, reason: 'ghost' });
    expect(game.fx.bolts[0]?.scale).toBe(1);
  });

  it('flies a smaller bolt when an online roster shows a side-board attack', () => {
    const game = new Game(() => 0);
    game.startMatch();
    const seat = (id: number, hit: boolean, busy: boolean) => ({
      seat: id,
      name: `S${id}`,
      alive: true,
      pressure: 0,
      hit,
      busy,
      bot: id !== 1,
      ready: true,
    });
    game.armOnline(1, [seat(1, false, false), seat(2, false, false), seat(3, false, false)]);
    game.applyOnlineRoster([seat(1, false, false), seat(2, false, true), seat(3, true, false)]);
    const bolt = game.fx.bolts[0];
    const from = panelCenter(game.sims.sims[0]?.id ?? 1);
    const to = panelCenter(game.sims.sims[1]?.id ?? 2);
    expect(bolt).toMatchObject({ sx: from.x, sy: from.y, tx: to.x, ty: to.y, scale: GRID_BOLT_SCALE });
  });
});
