import { afterEach, describe, expect, it } from 'vitest';
import { GHOST_ATTACK_WINDOW } from '../src/config';
import { Game } from '../src/game';
import type { RosterSeat, ServerMessage } from '../src/net/protocol';
import { EARN_RATE_LIMIT, LOBBY_COUNTDOWN_MS, MAX_HUMANS, ROOM_SIZE } from '../src/net/protocol';
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
    const clock = mutableClock();
    const room = new MatchRoom(clock.now, () => 0);
    const ada = room.join(link('ada'), 'Ada');
    const bea = room.join(link('bea'), 'Bea');
    expect(ada.ok && bea.ok).toBe(true);
    if (!ada.ok || ada.role !== 'player' || !bea.ok || bea.role !== 'player') return;
    readyAndStart(room, [ada.seat, bea.seat], clock);
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
    expect(roster.message.seats.find((seat) => seat.seat === ada.seat)).toMatchObject({ pressure: 0, busy: true });
    expect(roster.message.seats.find((seat) => seat.seat === bea.seat)).toMatchObject({ pressure: 48, hit: true });
  });

  it('ignores target picks, garbage, and earns past the rate limit', () => {
    let now = 5_000;
    const room = new MatchRoom(
      () => now,
      () => 0,
    );
    const pressure = track(room, (ms) => {
      now += ms;
    });
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

  it('eliminates a seat on death without ending a padded match, and rejects a 17th human', () => {
    const logs: ServerMessage[] = [];
    let now = 0;
    const room = new MatchRoom(
      () => now,
      () => 0,
    );
    const ada = room.join(sink(logs), 'Ada');
    const bea = room.join({ send() {} }, 'Bea');
    if (!ada.ok || ada.role !== 'player' || !bea.ok || bea.role !== 'player') throw new Error('expected two seats');
    readyAndStart(room, [ada.seat, bea.seat], {
      advance(ms) {
        now += ms;
      },
    });
    logs.length = 0;
    room.handle(ada.seat, { type: 'deathReport' });
    room.handle(ada.seat, { type: 'deathReport' });
    expect(logs.some((message) => message.type === 'matchEnd')).toBe(false);
    expect(logs.find((message) => message.type === 'playerEliminated')).toMatchObject({
      seat: ada.seat,
      remaining: ROOM_SIZE - 1,
    });

    const fresh = new MatchRoom(() => 0, () => 0);
    for (let i = 0; i < MAX_HUMANS; i++) {
      const joined = fresh.join({ send() {} }, `H${i}`);
      expect(joined.ok).toBe(true);
    }
    expect(fresh.join({ send() {} }, 'Extra')).toEqual({ ok: false, text: 'Lobby is full' });
  });

  it('sends every human the same finish names and places', () => {
    const adaLog: ServerMessage[] = [];
    const beaLog: ServerMessage[] = [];
    let now = 0;
    const room = new MatchRoom(
      () => now,
      () => 0,
    );
    const ada = room.join(sink(adaLog), '  Ada  ');
    const bea = room.join(sink(beaLog), 'Bea');
    if (!ada.ok || ada.role !== 'player' || !bea.ok || bea.role !== 'player') throw new Error('expected two seats');
    readyAndStart(room, [ada.seat, bea.seat], {
      advance(ms) {
        now += ms;
      },
    });
    for (let i = 0; i < ROOM_SIZE - 1; i++) {
      now += 1_000;
      room.handle(ada.seat, { type: 'earnAttack', attack: 'ghost', strength: 100 });
    }
    const adaEnd = adaLog.find((message) => message.type === 'matchEnd');
    const beaEnd = beaLog.find((message) => message.type === 'matchEnd');
    expect(adaEnd).toEqual(beaEnd);
    expect(adaEnd).toMatchObject({
      type: 'matchEnd',
      winnerSeat: ada.seat,
    });
    if (adaEnd?.type !== 'matchEnd') return;
    expect(adaEnd.placements).toHaveLength(ROOM_SIZE);
    expect(adaEnd.placements.find((row) => row.seat === ada.seat)).toMatchObject({ name: 'Ada', place: 1 });
    expect(adaEnd.placements.find((row) => row.seat === bea.seat)).toMatchObject({ name: 'Bea', place: ROOM_SIZE });
  });

  it('frees a lobby seat when someone leaves before the match starts', () => {
    let now = 0;
    const room = new MatchRoom(
      () => now,
      () => 0,
    );
    const ada = room.join({ send() {} }, 'Ada');
    const bea = room.join({ send() {} }, 'Bea');
    if (!ada.ok || ada.role !== 'player' || !bea.ok || bea.role !== 'player') throw new Error('expected two seats');
    room.handle(ada.seat, { type: 'ready' });
    room.leave(ada.seat);
    const cam = room.join({ send() {} }, 'Cam');
    expect(cam.ok).toBe(true);
    if (!cam.ok || cam.role !== 'player') return;
    room.handle(bea.seat, { type: 'ready' });
    room.handle(cam.seat, { type: 'ready' });
    now += LOBBY_COUNTDOWN_MS - 1;
    room.tick();
    const early: ServerMessage[] = [];
    const probe = room.join(sink(early), 'Dee');
    expect(probe.ok).toBe(true);
    expect(early.some((message) => message.type === 'matchStart')).toBe(false);
  });

  it('waits out the lobby countdown, then pads to 101', () => {
    let now = 0;
    const logs: ServerMessage[] = [];
    const room = new MatchRoom(
      () => now,
      () => 0,
    );
    const ada = room.join(sink(logs), 'Ada');
    if (!ada.ok || ada.role !== 'player') throw new Error('expected a seat');
    room.handle(ada.seat, { type: 'ready' });
    room.tick();
    expect(logs.some((message) => message.type === 'matchStart')).toBe(false);
    const bea = room.join(sink(logs), 'Bea');
    if (!bea.ok || bea.role !== 'player') throw new Error('expected a second seat');
    room.handle(bea.seat, { type: 'ready' });
    now += LOBBY_COUNTDOWN_MS - 1;
    room.tick();
    expect(logs.some((message) => message.type === 'matchStart')).toBe(false);
    now += 1;
    room.tick();
    const start = logs.find((message) => message.type === 'matchStart');
    expect(start?.type).toBe('matchStart');
    if (start?.type !== 'matchStart') return;
    expect(start.roster).toHaveLength(ROOM_SIZE);
    expect(start.roster.filter((seat) => seat.bot).length).toBe(ROOM_SIZE - 2);
    expect(start.roster.filter((seat) => !seat.bot).map((seat) => seat.name).sort()).toEqual(['Ada', 'Bea']);
  });

  it('admits a spectator during play, ignores their earn, then offers the next lobby', () => {
    let now = 0;
    const playerLog: ServerMessage[] = [];
    const watchLog: ServerMessage[] = [];
    const watchLink = sink(watchLog);
    const room = new MatchRoom(
      () => now,
      () => 0,
    );
    const ada = room.join(sink(playerLog), 'Ada');
    if (!ada.ok || ada.role !== 'player') throw new Error('expected a seat');
    room.handle(ada.seat, { type: 'ready' });
    now += LOBBY_COUNTDOWN_MS;
    room.tick();
    const watch = room.join(watchLink, 'Cam');
    expect(watch).toMatchObject({ ok: true, role: 'spectator' });
    if (!watch.ok || watch.role !== 'spectator') return;
    const spectate = watchLog.find((message) => message.type === 'spectate');
    expect(spectate?.type).toBe('spectate');
    if (spectate?.type !== 'spectate') return;
    expect(spectate.roster).toHaveLength(ROOM_SIZE);
    const before = playerLog.filter((message) => message.type === 'rosterDelta').length;
    room.onMessage(watchLink, { type: 'earnAttack', attack: 'ghost', strength: 100 });
    room.onMessage(watchLink, { type: 'deathReport' });
    expect(playerLog.filter((message) => message.type === 'rosterDelta').length).toBe(before);
    expect(playerLog.some((message) => message.type === 'playerEliminated' && message.seat === ada.seat)).toBe(false);
    for (let i = 0; i < ROOM_SIZE - 1; i++) {
      now += 1_000;
      room.handle(ada.seat, { type: 'earnAttack', attack: 'ghost', strength: 100 });
    }
    expect(watchLog.some((message) => message.type === 'matchEnd')).toBe(true);
    const lobby = [...watchLog].reverse().find((message) => message.type === 'lobby');
    expect(lobby).toMatchObject({ type: 'lobby', countdownMs: null });
    if (lobby?.type !== 'lobby') return;
    expect(lobby.seats.some((seat) => seat.name === 'Cam')).toBe(true);
    expect(lobby.you).toBeGreaterThan(0);
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
    const server = await startMatchServer(0, { countdownMs: 80, rng: () => 0 });
    servers.push(server);
    const ada = await openSeat(server.port, 'Ada');
    const bea = await openSeat(server.port, 'Bea');
    const startAda = nextMessage(ada, 'matchStart');
    const startBea = nextMessage(bea, 'matchStart');
    ada.send(JSON.stringify({ type: 'ready' }));
    bea.send(JSON.stringify({ type: 'ready' }));
    const started = await Promise.all([startAda, startBea]);
    expect(started[0].roster).toHaveLength(ROOM_SIZE);
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

  it('admits a spectator socket while a match is in play', async () => {
    const server = await startMatchServer(0, { countdownMs: 80, rng: () => 0 });
    servers.push(server);
    const ada = await openSeat(server.port, 'Ada');
    const start = nextMessage(ada, 'matchStart');
    ada.send(JSON.stringify({ type: 'ready' }));
    await start;
    const cam = await connected(server.port);
    const spectate = nextMessage(cam, 'spectate');
    cam.send(JSON.stringify({ type: 'join', name: 'Cam' }));
    const admitted = await spectate;
    expect(admitted.roster).toHaveLength(ROOM_SIZE);
    let eliminated = false;
    ada.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type === 'playerEliminated') eliminated = true;
    });
    cam.send(JSON.stringify({ type: 'earnAttack', attack: 'ghost', strength: 100 }));
    cam.send(JSON.stringify({ type: 'deathReport' }));
    const pong = nextMessage(ada, 'ping');
    ada.send(JSON.stringify({ type: 'ping' }));
    await pong;
    expect(eliminated).toBe(false);
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
    game.armOnline(1, duo(1, 'Ada'));
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

  it('shows 101 alive from a full roster and a spectator standings board', () => {
    const game = new Game(() => 0);
    const roster: RosterSeat[] = Array.from({ length: ROOM_SIZE }, (_, index) => ({
      seat: index + 1,
      name: index === 0 ? 'Ada' : `Bot ${index}`,
      alive: true,
      pressure: 0,
      hit: false,
      busy: false,
      bot: index !== 0,
      ready: true,
    }));
    game.startMatch();
    game.armOnline(1, roster);
    expect(game.match.remaining()).toBe(ROOM_SIZE);
    expect(game.sims.aliveCount()).toBe(ROOM_SIZE - 1);
    expect(game.online).toBe(true);

    const watcher = new Game(() => 0);
    const earns: unknown[] = [];
    watcher.bindOnline({
      earn: (attack, strength) => earns.push({ attack, strength }),
      death: () => earns.push('death'),
    });
    watcher.beginSpectate(roster, 12);
    expect(watcher.spectating).toBe(true);
    expect(watcher.online).toBe(false);
    expect(watcher.inMatch).toBe(false);
    expect(watcher.hud().standings?.stillIn).toBe(ROOM_SIZE);
    watcher.bus.emit({ type: 'ghostEaten', ghostId: 'blinky', strength: 1, combo: 1 });
    watcher.bus.emit({ type: 'playerDied' });
    expect(earns).toEqual([]);
    watcher.noteSpectatorElimination(2, ROOM_SIZE);
    expect(watcher.hud().standings?.stillIn).toBe(ROOM_SIZE - 1);
    expect(watcher.hud().standings?.rows.find((row) => row.name === 'Bot 1')).toMatchObject({
      place: ROOM_SIZE,
      state: 'out',
    });
    watcher.showSpectatorPlacements(
      roster.map((seat, index) => ({ seat: seat.seat, name: seat.name, place: index + 1 })),
    );
    expect(watcher.hud().status).toContain('Joining the next lobby');
    watcher.clearSpectate();
    expect(watcher.spectating).toBe(false);
    expect(watcher.hud().standings).toBeNull();
  });

  it('shows every eliminated place on a spectator who joined mid-match', () => {
    let now = 0;
    const playerLog: ServerMessage[] = [];
    const watchLog: ServerMessage[] = [];
    const room = new MatchRoom(() => now, () => 0);
    const ada = room.join(sink(playerLog), 'Ada');
    if (!ada.ok || ada.role !== 'player') throw new Error('expected a seat');
    room.handle(ada.seat, { type: 'ready' });
    now += LOBBY_COUNTDOWN_MS;
    room.tick();
    room.handle(ada.seat, { type: 'earnAttack', attack: 'ghost', strength: 100 });
    const eliminated = playerLog.find((message) => message.type === 'playerEliminated');
    expect(eliminated?.type).toBe('playerEliminated');
    if (eliminated?.type !== 'playerEliminated') return;

    const watch = room.join(sink(watchLog), 'Cam');
    expect(watch).toMatchObject({ ok: true, role: 'spectator' });
    const spectate = watchLog.find((message) => message.type === 'spectate');
    expect(spectate?.type).toBe('spectate');
    if (spectate?.type !== 'spectate') return;
    const alreadyOut = spectate.roster.filter((seat) => seat.place != null);
    expect(alreadyOut).toHaveLength(1);
    expect(alreadyOut[0]).toMatchObject({ seat: eliminated.seat, place: eliminated.place, alive: false });

    const watcher = new Game(() => 0);
    watcher.beginSpectate(spectate.roster, spectate.clock);
    const board = watcher.hud().standings;
    expect(board?.stillIn).toBe(ROOM_SIZE - 1);
    const out = board?.rows.filter((row) => row.state === 'out') ?? [];
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ place: eliminated.place, name: alreadyOut[0]?.name });
    expect(board?.rows.filter((row) => row.state === 'out' && row.place == null)).toEqual([]);

    const nextSeat = spectate.roster.find((seat) => seat.alive && seat.seat !== ada.seat);
    if (!nextSeat) throw new Error('expected a living seat');
    watcher.applySpectateRoster(
      spectate.roster.map((seat) =>
        seat.seat === nextSeat.seat ? { ...seat, alive: false, place: ROOM_SIZE - 1 } : seat,
      ),
    );
    const later = watcher.hud().standings;
    const laterOut = later?.rows.filter((row) => row.state === 'out') ?? [];
    expect(laterOut.map((row) => row.place).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      ROOM_SIZE - 1,
      eliminated.place,
    ]);
    expect(later?.rows).toHaveLength(ROOM_SIZE);
  });

  it('does not send a ghost earn until a ghost is eaten', () => {
    const game = new Game(() => 0);
    const earns: { attack: string; strength: number }[] = [];
    game.bindOnline({
      earn: (attack, strength) => earns.push({ attack, strength }),
      death: () => {},
    });
    game.startMatch();
    game.armOnline(1, duo(1, 'Ada'));
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
    game.armOnline(1, duo(1, 'Ada'));
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
    other.armOnline(2, duo(2, 'Bea'));
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
    loser.armOnline(1, duo(1, 'Bea'));
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
    winner.armOnline(2, duo(2, 'Ada'));
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

function sink(logs: ServerMessage[]): SeatLink {
  return {
    send(message) {
      logs.push(message);
    },
  };
}

function duo(you: number, opponentName: string): RosterSeat[] {
  const other = you === 1 ? 2 : 1;
  return [
    { seat: you, name: 'You', alive: true, pressure: 0, hit: false, busy: false, bot: false, ready: true },
    { seat: other, name: opponentName, alive: true, pressure: 0, hit: false, busy: false, bot: false, ready: true },
  ];
}

function mutableClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

function readyAndStart(room: MatchRoom, ids: number[], clock: { advance: (ms: number) => void }): void {
  for (const id of ids) room.handle(id, { type: 'ready' });
  clock.advance(LOBBY_COUNTDOWN_MS);
  room.tick();
}

function track(room: MatchRoom, advance: (ms: number) => void): { ada: number; ofBea: () => number } {
  let beaPressure = 0;
  const ada = room.join({ send() {} }, 'Ada');
  const bea = room.join(
    {
      send(message) {
        if (message.type === 'rosterDelta') {
          beaPressure = message.seats.find((seat) => seat.seat === (bea.ok && bea.role === 'player' ? bea.seat : -1))?.pressure ?? beaPressure;
        }
        if (message.type === 'playerEliminated' && bea.ok && bea.role === 'player' && message.seat === bea.seat) {
          beaPressure = 100;
        }
      },
    },
    'Bea',
  );
  if (!ada.ok || ada.role !== 'player' || !bea.ok || bea.role !== 'player') throw new Error('expected two seats');
  readyAndStart(room, [ada.seat, bea.seat], { advance });
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
