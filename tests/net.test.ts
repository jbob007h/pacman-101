import { afterEach, describe, expect, it } from 'vitest';
import { GHOST_ATTACK_WINDOW, SIM_ATTACK_GRACE } from '../src/config';
import { Game } from '../src/game';
import type { RosterSeat, ServerMessage } from '../src/net/protocol';
import { EARN_RATE_LIMIT, MAX_HUMANS, ROOM_SIZE } from '../src/net/protocol';
import { describeLobby } from '../src/net/session';
import { CPU_NAMES, cpuName } from '../src/systems/names';
import { startMatchServer, type MatchServer } from '../server/index';
import { MatchRoom, type SeatLink } from '../server/match';

const servers: MatchServer[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) await server.close();
});

describe('match room', () => {
  it('sends a jammer only to the other living seat', () => {
    const logs: { who: string; message: ServerMessage }[] = [];
    const link = (who: string): SeatLink => ({
      send(message) {
        logs.push({ who, message });
      },
    });
    const room = new MatchRoom(() => 0, () => 0);
    const ada = room.join(link('ada'), 'Ada');
    const bea = room.join(link('bea'), 'Bea');
    expect(ada.ok && bea.ok).toBe(true);
    if (!ada.ok || !bea.ok) return;
    room.handle(ada.seat, { type: 'ready' });
    room.handle(bea.seat, { type: 'ready' });
    logs.length = 0;

    room.handle(ada.seat, { type: 'earnAttack', attack: 'ghost', strength: 48 });

    const jammers = logs.filter((entry) => entry.message.type === 'jammerInbound');
    expect(jammers).toEqual([
      {
        who: 'bea',
        message: { type: 'jammerInbound', fromSeat: ada.seat, fromName: 'Ada', strength: 48, attack: 'ghost' },
      },
    ]);
    const roster = logs.find((entry) => entry.who === 'ada' && entry.message.type === 'rosterDelta');
    expect(roster?.message.type).toBe('rosterDelta');
    if (roster?.message.type !== 'rosterDelta') return;
    expect(roster.message.seats).toHaveLength(ROOM_SIZE);
    expect(roster.message.seats[0]).toMatchObject({ seat: ada.seat, pressure: 0, busy: true, bot: false });
    expect(roster.message.seats[1]).toMatchObject({ seat: bea.seat, pressure: 48, hit: true, bot: false });
    expect(roster.message.seats.filter((seat) => seat.bot)).toHaveLength(ROOM_SIZE - 2);
  });

  it('ignores target picks, garbage, and earns past the rate limit', () => {
    let now = 5_000;
    const room = new MatchRoom(
      () => now,
      () => 0,
    );
    const pressure = track(room);
    room.handle(pressure.ada, { type: 'earnAttack', attack: 'ghost', strength: 10, target: 2 });
    room.handle(pressure.ada, { type: 'earnAttack', attack: 'nope', strength: 10 });
    room.handle(pressure.ada, { type: 'earnAttack', attack: 'ghost', strength: Number.NaN });
    room.handle(pressure.ada, { type: 'earnAttack', attack: 'ghost', strength: 0 });
    room.handle(pressure.ada, { type: 'earnAttack', attack: 'ghost', strength: 0.4 });
    room.handle(pressure.ada, { type: 'earnAttack', attack: 'dots', strength: 22 });
    room.handle(pressure.ada, { type: 'earnAttack', attack: 'clear', strength: 42 });
    expect(pressure.ofBea()).toBe(0);

    for (let i = 0; i < EARN_RATE_LIMIT; i++) {
      room.handle(pressure.ada, { type: 'earnAttack', attack: 'ghost', strength: 1 });
    }
    expect(pressure.ofBea()).toBe(EARN_RATE_LIMIT);
    room.handle(pressure.ada, { type: 'earnAttack', attack: 'ghost', strength: 1 });
    expect(pressure.ofBea()).toBe(EARN_RATE_LIMIT);

    now += 1_000;
    room.handle(pressure.ada, { type: 'earnAttack', attack: 'ghost', strength: 1.6 });
    expect(pressure.ofBea()).toBe(EARN_RATE_LIMIT + 2);
  });

  it('lets more than two humans join, and rejects the seat past the human cap', () => {
    const room = new MatchRoom(() => 0, () => 0);
    for (let n = 0; n < MAX_HUMANS; n++) {
      const joined = room.join({ send() {} }, `P${n}`);
      expect(joined.ok).toBe(true);
    }
    expect(room.join({ send() {} }, 'Extra')).toEqual({ ok: false, text: 'Match is full' });
  });

  it('starts eight ready humans with no CPU fillers', () => {
    const logs: ServerMessage[] = [];
    const room = new MatchRoom(() => 0, () => 0);
    const ids: number[] = [];
    for (let n = 0; n < MAX_HUMANS; n++) {
      const joined = room.join(n === 0 ? sink(logs) : { send() {} }, `P${n}`);
      if (!joined.ok) throw new Error('expected a seat');
      ids.push(joined.seat);
    }
    for (const id of ids) room.handle(id, { type: 'ready' });
    const started = logs.find((message) => message.type === 'matchStart');
    expect(started?.type).toBe('matchStart');
    if (started?.type !== 'matchStart') return;
    expect(started.roster).toHaveLength(ROOM_SIZE);
    expect(started.roster.every((seat) => seat.bot === false)).toBe(true);
  });

  it('does not end on one death while bots are still alive', () => {
    const logs: ServerMessage[] = [];
    const room = new MatchRoom(() => 0, () => 0);
    const ada = room.join(sink(logs), 'Ada');
    const bea = room.join({ send() {} }, 'Bea');
    if (!ada.ok || !bea.ok) throw new Error('expected two seats');
    room.handle(ada.seat, { type: 'ready' });
    room.handle(bea.seat, { type: 'ready' });
    logs.length = 0;
    room.handle(ada.seat, { type: 'deathReport' });
    room.handle(ada.seat, { type: 'deathReport' });
    expect(logs.filter((message) => message.type === 'matchEnd')).toHaveLength(0);
    expect(logs.find((message) => message.type === 'playerEliminated')).toMatchObject({
      type: 'playerEliminated',
      seat: ada.seat,
      remaining: ROOM_SIZE - 1,
    });
    expect(room.join({ send() {} }, 'Cam')).toEqual({ ok: false, text: 'Match is full' });
  });

  it('sends both seats the same finish names and places', () => {
    const adaLog: ServerMessage[] = [];
    const beaLog: ServerMessage[] = [];
    const room = new MatchRoom(() => 0, () => 0);
    const ada = room.join(sink(adaLog), '  Ada  ');
    const bea = room.join(sink(beaLog), 'Bea');
    if (!ada.ok || !bea.ok) throw new Error('expected two seats');
    room.handle(ada.seat, { type: 'ready' });
    room.handle(bea.seat, { type: 'ready' });
    for (let n = 0; n < ROOM_SIZE; n++) {
      room.handle(ada.seat, { type: 'earnAttack', attack: 'ghost', strength: 200 });
    }
    const adaEnd = adaLog.find((message) => message.type === 'matchEnd');
    const beaEnd = beaLog.find((message) => message.type === 'matchEnd');
    expect(adaEnd).toEqual(beaEnd);
    expect(adaEnd?.type).toBe('matchEnd');
    if (adaEnd?.type !== 'matchEnd') return;
    expect(adaEnd.winnerSeat).toBe(ada.seat);
    expect(adaEnd.placements).toHaveLength(ROOM_SIZE);
    expect(adaEnd.placements.map((row) => row.name)).toEqual(['Ada', 'Bea', ...CPU_NAMES.slice(0, ROOM_SIZE - 2)]);
    expect(adaEnd.placements.find((row) => row.seat === ada.seat)?.place).toBe(1);
    expect(adaEnd.placements.find((row) => row.seat === bea.seat)?.place).toBe(ROOM_SIZE);
  });

  it('drops a lobby leaver so a ready human is not stuck', () => {
    const logs: ServerMessage[] = [];
    const waiting = new MatchRoom(() => 0, () => 0);
    const ada = waiting.join({ send() {} }, 'Ada');
    const bea = waiting.join(sink(logs), 'Bea');
    if (!ada.ok || !bea.ok) throw new Error('expected two seats');
    waiting.handle(bea.seat, { type: 'ready' });
    expect(logs.some((message) => message.type === 'matchStart')).toBe(false);
    waiting.leave(ada.seat);
    const started = logs.find((message) => message.type === 'matchStart');
    expect(started?.type).toBe('matchStart');
    if (started?.type !== 'matchStart') return;
    expect(started.roster.filter((seat) => seat.bot)).toHaveLength(ROOM_SIZE - 1);
    expect(started.grace).toBe(SIM_ATTACK_GRACE);
  });

  it('pads a solo ready human to the room size with named CPU bots', () => {
    const logs: ServerMessage[] = [];
    const room = new MatchRoom(() => 0, () => 0);
    const ada = room.join(sink(logs), 'Ada');
    if (!ada.ok) throw new Error('expected a seat');
    const lobby = logs.find((message) => message.type === 'lobby');
    expect(lobby?.type).toBe('lobby');
    if (lobby?.type === 'lobby') {
      expect(lobby.need).toBe(ROOM_SIZE);
      expect(lobby.seats).toEqual([
        expect.objectContaining({ seat: ada.seat, name: 'Ada', bot: false, ready: false }),
      ]);
    }
    room.handle(ada.seat, { type: 'ready' });
    const started = logs.find((message) => message.type === 'matchStart');
    expect(started?.type).toBe('matchStart');
    if (started?.type !== 'matchStart') return;
    expect(started.grace).toBe(SIM_ATTACK_GRACE);
    expect(started.roster).toHaveLength(ROOM_SIZE);
    expect(started.roster.filter((seat) => !seat.bot)).toEqual([
      expect.objectContaining({ seat: ada.seat, name: 'Ada', ready: true, alive: true }),
    ]);
    expect(started.roster.filter((seat) => seat.bot).map((seat) => seat.name)).toEqual(
      CPU_NAMES.slice(0, ROOM_SIZE - 1),
    );
  });

  it('waits for every joined human, then fills fewer bots when two are ready', () => {
    const logs: ServerMessage[] = [];
    const room = new MatchRoom(() => 0, () => 0);
    const ada = room.join(sink(logs), 'Ada');
    const bea = room.join({ send() {} }, 'Bea');
    if (!ada.ok || !bea.ok) throw new Error('expected two seats');
    room.handle(ada.seat, { type: 'ready' });
    expect(logs.some((message) => message.type === 'matchStart')).toBe(false);
    const lobby = [...logs].reverse().find((message) => message.type === 'lobby');
    expect(lobby?.type).toBe('lobby');
    if (lobby?.type === 'lobby') {
      expect(describeLobby(lobby.seats, lobby.need)).toContain('Ada (ready)');
      expect(describeLobby(lobby.seats, lobby.need)).toContain('Bea');
      expect(lobby.seats.map((seat) => [seat.name, seat.bot, seat.ready])).toEqual([
        ['Ada', false, true],
        ['Bea', false, false],
      ]);
    }
    room.handle(bea.seat, { type: 'ready' });
    const started = logs.find((message) => message.type === 'matchStart');
    expect(started?.type).toBe('matchStart');
    if (started?.type !== 'matchStart') return;
    expect(started.roster.filter((seat) => seat.bot)).toHaveLength(ROOM_SIZE - 2);
    expect(started.roster.filter((seat) => !seat.bot).map((seat) => seat.name)).toEqual(['Ada', 'Bea']);
  });

  it('fires each bot on its own 8s timer at one living seat, without waiting out grace', () => {
    const logs: ServerMessage[] = [];
    const room = new MatchRoom(() => 0, () => 0);
    const ada = room.join(sink(logs), 'Ada');
    if (!ada.ok) throw new Error('expected a seat');
    room.handle(ada.seat, { type: 'ready' });
    logs.length = 0;
    room.tick(7.9);
    expect(logs.filter((message) => message.type === 'jammerInbound')).toHaveLength(0);
    room.tick(0.1);
    const inbound = logs.filter((message) => message.type === 'jammerInbound');
    expect(inbound).toHaveLength(ROOM_SIZE - 1);
    expect(inbound.every((message) => message.type === 'jammerInbound' && message.strength === 1 && message.attack === 'ghost')).toBe(
      true,
    );
    expect(new Set(inbound.map((message) => (message.type === 'jammerInbound' ? message.fromName : ''))).size).toBe(
      ROOM_SIZE - 1,
    );
  });

  it('lets a human earn hit a bot, and lets a bot hit either a human or a bot', () => {
    const humanLogs: ServerMessage[] = [];
    const botTarget = new MatchRoom(
      () => 0,
      scriptedRng([...Array(ROOM_SIZE - 2).fill(0), 0.999]),
    );
    const ada = botTarget.join(sink(humanLogs), 'Ada');
    const bea = botTarget.join(sink([]), 'Bea');
    if (!ada.ok || !bea.ok) throw new Error('expected two seats');
    botTarget.handle(ada.seat, { type: 'ready' });
    botTarget.handle(bea.seat, { type: 'ready' });
    humanLogs.length = 0;
    botTarget.handle(ada.seat, { type: 'earnAttack', attack: 'ghost', strength: 15 });
    expect(humanLogs.some((message) => message.type === 'jammerInbound')).toBe(false);
    const struck = [...humanLogs].reverse().find((message) => message.type === 'rosterDelta');
    expect(struck?.type).toBe('rosterDelta');
    if (struck?.type === 'rosterDelta') {
      const bots = struck.seats.filter((seat) => seat.bot);
      expect(bots.some((seat) => seat.pressure === 15 && seat.hit)).toBe(true);
      expect(struck.seats.find((seat) => seat.seat === bea.seat)?.pressure).toBe(0);
    }

    const botLogs: ServerMessage[] = [];
    const botsHitBots = new MatchRoom(() => 0, scriptedRng(botDice(ROOM_SIZE - 1, 0.999)));
    const solo = botsHitBots.join(sink(botLogs), 'Ada');
    if (!solo.ok) throw new Error('expected a seat');
    botsHitBots.handle(solo.seat, { type: 'ready' });
    botLogs.length = 0;
    botsHitBots.tick(8);
    expect(botLogs.some((message) => message.type === 'jammerInbound')).toBe(false);
    const afterBots = [...botLogs].reverse().find((message) => message.type === 'rosterDelta');
    expect(afterBots?.type).toBe('rosterDelta');
    if (afterBots?.type === 'rosterDelta') {
      expect(afterBots.seats.find((seat) => seat.seat === solo.seat)?.pressure).toBe(0);
      const dealt = afterBots.seats.filter((seat) => seat.bot).reduce((sum, seat) => sum + seat.pressure, 0);
      expect(dealt).toBe(ROOM_SIZE - 1);
    }
  });

  it('eliminates a disconnected human and leaves the bots in play', () => {
    const logs: ServerMessage[] = [];
    const room = new MatchRoom(() => 0, () => 0);
    const ada = room.join({ send() {} }, 'Ada');
    const bea = room.join(sink(logs), 'Bea');
    if (!ada.ok || !bea.ok) throw new Error('expected two seats');
    room.handle(ada.seat, { type: 'ready' });
    room.handle(bea.seat, { type: 'ready' });
    logs.length = 0;
    room.leave(ada.seat);
    expect(logs.some((message) => message.type === 'matchEnd')).toBe(false);
    expect(logs.find((message) => message.type === 'playerEliminated')).toMatchObject({
      type: 'playerEliminated',
      seat: ada.seat,
      remaining: ROOM_SIZE - 1,
    });
    const roster = logs.find((message) => message.type === 'rosterDelta');
    expect(roster?.type).toBe('rosterDelta');
    if (roster?.type === 'rosterDelta') {
      expect(roster.seats.find((seat) => seat.seat === ada.seat)).toMatchObject({ alive: false, bot: false });
      expect(roster.seats.filter((seat) => seat.bot && seat.alive)).toHaveLength(ROOM_SIZE - 2);
      expect(roster.seats.find((seat) => seat.seat === bea.seat)?.alive).toBe(true);
    }
  });
});

describe('match server', () => {
  it('answers HTTP GET / and still accepts a socket on the same port', async () => {
    const server = await startMatchServer(0);
    servers.push(server);
    const response = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('101 match server');
    const seat = await openSeat(server.port, 'Ada');
    expect(seat.readyState).toBe(WebSocket.OPEN);
  });

  it('plays an earn from one socket into the other client jammer', async () => {
    const server = await startMatchServer(0, { rng: () => 0 });
    servers.push(server);
    const ada = await openSeat(server.port, 'Ada');
    const bea = await openSeat(server.port, 'Bea');
    const startAda = nextMessage(ada, 'matchStart');
    const startBea = nextMessage(bea, 'matchStart');
    ada.send(JSON.stringify({ type: 'ready' }));
    bea.send(JSON.stringify({ type: 'ready' }));
    const started = await Promise.all([startAda, startBea]);
    expect(started[0].roster).toHaveLength(ROOM_SIZE);
    expect(started[0].roster.filter((seat) => seat.bot)).toHaveLength(ROOM_SIZE - 2);
    expect(started[0].you).not.toBe(started[1].you);

    let inboundCount = 0;
    bea.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type === 'jammerInbound') inboundCount += 1;
    });
    const seenByAttacker: string[] = [];
    ada.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      seenByAttacker.push(message.type);
    });
    const pong = nextMessage(ada, 'ping');
    ada.send(JSON.stringify({ type: 'earnAttack', attack: 'ghost', strength: 48, target: started[1].you }));
    ada.send(JSON.stringify({ type: 'ping' }));
    expect((await pong).type).toBe('ping');
    expect(inboundCount).toBe(0);

    const inbound = nextMessage(bea, 'jammerInbound');
    ada.send(JSON.stringify({ type: 'earnAttack', attack: 'ghost', strength: 48 }));
    const jammer = await inbound;
    expect(jammer).toMatchObject({ fromName: 'Ada', strength: 48, fromSeat: started[0].you, attack: 'ghost' });
    expect(inboundCount).toBe(1);
    expect(seenByAttacker).not.toContain('jammerInbound');
  });

  it('accepts a third human socket and rejects the one past the cap', async () => {
    const server = await startMatchServer(0, { rng: () => 0 });
    servers.push(server);
    await openSeat(server.port, 'Ada');
    await openSeat(server.port, 'Bea');
    const cam = await openSeat(server.port, 'Cam');
    expect(cam.readyState).toBe(WebSocket.OPEN);
    for (let n = 3; n < MAX_HUMANS; n++) await openSeat(server.port, `P${n}`);
    const extra = await connected(server.port);
    const error = nextMessage(extra, 'error');
    extra.send(JSON.stringify({ type: 'join', name: 'Extra' }));
    expect(await error).toMatchObject({ type: 'error', text: 'Match is full' });
  });

  it('pads one ready socket to a full roster of humans and bots', async () => {
    const server = await startMatchServer(0, { rng: () => 0 });
    servers.push(server);
    const ada = await openSeat(server.port, 'Ada');
    const start = nextMessage(ada, 'matchStart');
    ada.send(JSON.stringify({ type: 'ready' }));
    const message = await start;
    expect(message.grace).toBe(SIM_ATTACK_GRACE);
    expect(message.roster.filter((seat) => !seat.bot)).toHaveLength(1);
    expect(message.roster.filter((seat) => seat.bot).map((seat) => seat.name)).toEqual(CPU_NAMES.slice(0, ROOM_SIZE - 1));
  });
});

describe('online game path', () => {
  it('sends earns instead of local targets, then plays a server jammer', () => {
    const game = new Game(() => 0);
    const earns: { attack: string; strength: number }[] = [];
    let deaths = 0;
    game.bindOnline({
      earn: (attack, strength) => earns.push({ attack, strength }),
      death: () => {
        deaths += 1;
      },
    });
    game.startMatch();
    game.armOnline(1, 'Ada');
    expect(game.match.remaining()).toBe(2);
    expect(game.sims.aliveCount()).toBe(1);

    game.bus.emit({ type: 'ghostEaten', ghostId: 'blinky', strength: 1, combo: 1 });
    game.bus.emit({ type: 'trainGhostEaten', combo: 2 });
    game.bus.emit({ type: 'ghostEaten', ghostId: 'pinky', strength: 3, combo: 3 });
    expect(earns).toEqual([]);
    game.sims.advanceGhostWindow(GHOST_ATTACK_WINDOW - 0.05);
    expect(earns).toEqual([]);
    game.sims.advanceGhostWindow(0.05);
    game.bus.emit({ type: 'dotEaten', totalEaten: 50, remaining: 20 });
    game.bus.emit({ type: 'dotEaten', totalEaten: 51, remaining: 19 });
    game.bus.emit({ type: 'boardCleared' });
    expect(earns).toEqual([{ attack: 'ghost', strength: 3 }]);
    expect(game.sims.sims[0]?.pressure).toBe(0);

    game.bus.emit({ type: 'ghostEaten', ghostId: 'inky', strength: 1, combo: 1 });
    game.sims.advanceGhostWindow(GHOST_ATTACK_WINDOW);
    expect(earns[1]).toEqual({ attack: 'ghost', strength: 1 });

    game.applyOnlineRoster([
      { seat: 1, name: 'You', alive: true, pressure: 0, hit: false, busy: false, bot: false, ready: true },
      { seat: 2, name: 'Ada', alive: true, pressure: 48, hit: true, busy: true, bot: false, ready: true },
    ]);
    expect(game.sims.sims[0]).toMatchObject({ name: 'Ada', pressure: 48, heat: 1, busy: 1 });

    const before = game.board.inbound.jammers.length;
    game.receiveOnlineJammer(22, 'Ada', 'dots');
    game.receiveOnlineJammer(42, 'Ada', 'clear');
    for (let frame = 0; frame < 12; frame++) game.update(0.05);
    expect(game.board.inbound.jammers).toHaveLength(before);
    const banner = new Game(() => 0);
    banner.receiveOnlineJammer(22, 'Ada', 'dots');
    expect(banner.hud().status).not.toContain('Dot pressure');
    const one = new Game(() => 0);
    one.receiveOnlineJammer(1, 'Ada', 'ghost');
    const three = new Game(() => 0);
    three.receiveOnlineJammer(3, 'Bea', 'ghost');
    for (let frame = 0; frame < 12; frame++) {
      one.update(0.05);
      three.update(0.05);
    }
    expect(one.board.inbound.jammers).toHaveLength(1);
    expect(three.board.inbound.jammers).toHaveLength(3);

    game.eliminateOnlineOpponent();
    expect(game.match.phase).toBe('won');
    expect(deaths).toBe(0);

    game.startMatch();
    game.bus.emit({ type: 'ghostEaten', ghostId: 'blinky', strength: 1, combo: 1 });
    expect(game.online).toBe(false);
    expect(earns).toHaveLength(2);
    game.sims.advanceGhostWindow(GHOST_ATTACK_WINDOW);
    expect(earns).toHaveLength(2);
    expect(game.sims.sims.some((sim) => sim.pressure > 0)).toBe(true);
    expect(game.match.remaining()).toBe(101);
  });

  it('does not send a ghost earn until a ghost is eaten', () => {
    const game = new Game(() => 0);
    const earns: { attack: string; strength: number }[] = [];
    game.bindOnline({
      earn: (attack, strength) => earns.push({ attack, strength }),
      death: () => {},
    });
    game.startMatch();
    game.armOnline(1, 'Ada');
    game.sims.advanceGhostWindow(10);
    game.bus.emit({ type: 'powerPelletEaten' });
    for (let eaten = 1; eaten < 50; eaten++) {
      game.bus.emit({ type: 'dotEaten', totalEaten: eaten, remaining: 40 });
    }
    game.sims.advanceGhostWindow(GHOST_ATTACK_WINDOW);
    expect(earns).toEqual([]);

    game.bus.emit({ type: 'dotEaten', totalEaten: 50, remaining: 40 });
    game.bus.emit({ type: 'boardCleared' });
    game.sims.advanceGhostWindow(GHOST_ATTACK_WINDOW);
    expect(earns).toEqual([]);

    game.bus.emit({ type: 'ghostEaten', ghostId: 'blinky', strength: 1, combo: 1 });
    game.sims.advanceGhostWindow(GHOST_ATTACK_WINDOW);
    expect(earns).toEqual([{ attack: 'ghost', strength: 1 }]);

    const victim = new Game(() => 0);
    victim.receiveOnlineJammer(22, 'Ada', 'dots');
    victim.receiveOnlineJammer(42, 'Ada', 'clear');
    expect(victim.board.inbound.jammers).toHaveLength(0);
    expect(victim.hud().status).not.toContain('Dot pressure');
    victim.receiveOnlineJammer(1, 'Ada', 'ghost');
    expect(victim.hud().status).toBe('Ghost jam from Ada');
  });

  it('reports a local maze death and does not echo a server elimination', () => {
    const game = new Game(() => 0);
    let deaths = 0;
    game.bindOnline({
      earn: () => {},
      death: () => {
        deaths += 1;
      },
    });
    game.startMatch();
    game.armOnline(1, 'Ada');
    game.bus.emit({ type: 'playerDied' });
    expect(deaths).toBe(1);
    expect(game.match.phase).toBe('lost');

    const other = new Game(() => 0);
    other.bindOnline({
      earn: () => {},
      death: () => {
        deaths += 1;
      },
    });
    other.startMatch();
    other.armOnline(2, 'Bea');
    other.applyServerElimination();
    expect(deaths).toBe(1);
    expect(other.match.phase).toBe('lost');
    expect(other.board.pac.alive).toBe(false);
  });

  it('renders the same server standings on a win and a loss', () => {
    const placements = [
      { seat: 1, name: 'Ada', place: 2 },
      { seat: 2, name: 'Bea', place: 1 },
    ];
    const names = [
      [1, 'Bea'],
      [2, 'Ada'],
    ];

    const loser = new Game(() => 0);
    loser.startMatch();
    loser.armOnline(1, 'Bea');
    loser.setPlayerName('Local only');
    loser.applyServerElimination();
    loser.setOnlineStandings(placements);
    loser.board.deathTime = 0.5;
    expect(loser.hud().standings).toBeNull();
    loser.board.deathTime = 1;
    const lost = loser.hud().standings;
    expect(lost?.yourPlace).toBe(2);
    expect(lost?.stillIn).toBe(0);
    expect(lost?.rows.map((row) => [row.place, row.name, row.you])).toEqual([
      [1, 'Bea', false],
      [2, 'Ada', true],
    ]);

    const winner = new Game(() => 0);
    winner.startMatch();
    winner.armOnline(2, 'Ada');
    winner.eliminateOnlineOpponent();
    winner.setOnlineStandings(placements);
    expect(winner.hud().overlay?.title).toBe('Congratulations!');
    expect(winner.hud().standings).toBeNull();
    winner.acknowledgeWin();
    const won = winner.hud().standings;
    expect(won?.rows.map((row) => [row.place, row.name])).toEqual(names);
    expect(won?.rows.find((row) => row.you)).toMatchObject({ name: 'Bea', place: 1 });
    expect(won?.yourPlace).toBe(1);
    expect(won?.stillIn).toBe(0);

    winner.startMatch();
    expect(winner.online).toBe(false);
    expect(winner.hud().standings).toBeNull();
  });

  it('shows the server room on the side panels and lists bot names in the standings', () => {
    const game = new Game(() => 0);
    game.startMatch();
    const roster: RosterSeat[] = [];
    for (let seat = 1; seat <= ROOM_SIZE; seat++) {
      const bot = seat !== 1;
      roster.push({
        seat,
        name: bot ? cpuName(seat - 1) : 'Ada',
        alive: true,
        pressure: seat === 4 ? 40 : 0,
        hit: seat === 4,
        busy: seat === 5,
        bot,
        ready: true,
      });
    }
    game.armOnline(1, roster);
    expect(game.match.remaining()).toBe(ROOM_SIZE);
    expect(game.sims.aliveCount()).toBe(ROOM_SIZE - 1);
    expect(game.sims.sims.filter((sim) => sim.parked)).toHaveLength(100 - (ROOM_SIZE - 1));
    expect(game.sims.sims[0]).toMatchObject({ name: cpuName(1), showName: true, parked: false, alive: true });
    expect(game.sims.sims[2]).toMatchObject({ name: cpuName(3), pressure: 40, heat: 1 });
    expect(game.sims.sims[3]).toMatchObject({ name: cpuName(4), busy: 1 });
    expect(game.sims.sims[ROOM_SIZE - 1]?.parked).toBe(true);

    game.eliminateOnlineOpponent();
    expect(game.match.phase).toBe('won');
    game.setOnlineStandings(
      roster.map((seat) => ({
        seat: seat.seat,
        name: seat.name,
        place: seat.seat === 1 ? 1 : ROOM_SIZE - seat.seat + 2,
      })),
    );
    game.acknowledgeWin();
    const names = game.hud().standings?.rows.map((row) => row.name);
    expect(names).toContain('Ada');
    expect(names).toEqual(expect.arrayContaining(CPU_NAMES.slice(0, ROOM_SIZE - 1)));
  });

  it('keeps CPU timers frozen while local battle is off', () => {
    const game = new Game(() => 0);
    let shots = 0;
    game.bus.on('incomingJammer', () => {
      shots += 1;
    });
    game.bus.on('jammersSent', (event) => {
      if (event.reason === 'sim') shots += 1;
    });
    const pending = game.sims.sims.map((sim) => sim.attackIn);
    game.sims.setLocalBattle(false);
    game.sims.update(30);
    expect(shots).toBe(0);
    expect(game.sims.aliveCount()).toBe(100);
    expect(game.sims.sims.map((sim) => sim.attackIn)).toEqual(pending);
  });
});

function scriptedRng(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index] ?? 0;
    index += 1;
    return value;
  };
}

/** One zero per bot for the opening delay, then jammer, target, and the next delay for each shot. */
function botDice(bots: number, targetRoll: number): number[] {
  const rolls: number[] = [];
  for (let n = 0; n < bots; n++) rolls.push(0);
  for (let n = 0; n < bots; n++) rolls.push(0, targetRoll, 0);
  return rolls;
}

function sink(logs: ServerMessage[]): SeatLink {
  return {
    send(message) {
      logs.push(message);
    },
  };
}

function track(room: MatchRoom): { ada: number; ofBea: () => number } {
  let beaPressure = 0;
  const ada = room.join({ send() {} }, 'Ada');
  const bea = room.join(
    {
      send(message) {
        if (message.type === 'rosterDelta') {
          beaPressure = message.seats.find((seat) => seat.seat !== (ada.ok ? ada.seat : 0))?.pressure ?? beaPressure;
        }
        if (message.type === 'playerEliminated') beaPressure = 100;
      },
    },
    'Bea',
  );
  if (!ada.ok || !bea.ok) throw new Error('expected two seats');
  room.handle(ada.seat, { type: 'ready' });
  room.handle(bea.seat, { type: 'ready' });
  return {
    ada: ada.seat,
    ofBea: () => beaPressure,
  };
}

async function openSeat(port: number, name: string): Promise<WebSocket> {
  const socket = await connected(port);
  const lobby = nextMessage(socket, 'lobby');
  socket.send(JSON.stringify({ type: 'join', name }));
  await lobby;
  return socket;
}

function connected(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.push(socket);
    socket.addEventListener('open', () => resolve(socket));
    socket.addEventListener('error', () => reject(new Error('socket failed')));
  });
}

function nextMessage<T extends ServerMessage['type']>(
  socket: WebSocket,
  type: T,
): Promise<Extract<ServerMessage, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      reject(new Error(`timed out waiting for ${type}`));
    }, 2000);
    function onMessage(event: MessageEvent): void {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type !== type) return;
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      resolve(message as Extract<ServerMessage, { type: T }>);
    }
    socket.addEventListener('message', onMessage);
  });
}
