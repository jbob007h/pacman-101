import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { ghostHouseCenter, panelCenter } from '../src/render/layout';
import { BoltField } from '../src/render/fx';

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
});
