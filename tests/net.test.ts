import { afterEach, describe, expect, it } from 'vitest';
import { GHOST_ATTACK_WINDOW } from '../src/config';
import { Game } from '../src/game';
import type { ServerMessage } from '../src/net/protocol';
import { EARN_RATE_LIMIT } from '../src/net/protocol';
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
    expect(roster?.message).toMatchObject({
      type: 'rosterDelta',
      seats: [
        { seat: ada.seat, pressure: 0, busy: true },
        { seat: bea.seat, pressure: 48, hit: true },
      ],
    });
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

  it('ends the match when a seat reports death, and a full room rejects a third join', () => {
    const logs: ServerMessage[] = [];
    const room = new MatchRoom(() => 0, () => 0);
    const ada = room.join(sink(logs), 'Ada');
    const bea = room.join({ send() {} }, 'Bea');
    if (!ada.ok || !bea.ok) throw new Error('expected two seats');
    room.handle(ada.seat, { type: 'ready' });
    room.handle(bea.seat, { type: 'ready' });
    room.handle(ada.seat, { type: 'deathReport' });
    room.handle(ada.seat, { type: 'deathReport' });
    const endings = logs.filter((message) => message.type === 'matchEnd');
    expect(endings).toHaveLength(1);
    expect(endings[0]).toMatchObject({
      type: 'matchEnd',
      winnerSeat: bea.seat,
      placements: [
        { seat: ada.seat, name: 'Ada', place: 2 },
        { seat: bea.seat, name: 'Bea', place: 1 },
      ],
    });

    const third = room.join({ send() {} }, 'Cam');
    expect(third).toEqual({ ok: false, text: 'Match is full' });
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
    room.handle(ada.seat, { type: 'deathReport' });
    const adaEnd = adaLog.find((message) => message.type === 'matchEnd');
    const beaEnd = beaLog.find((message) => message.type === 'matchEnd');
    expect(adaEnd).toEqual(beaEnd);
    expect(adaEnd).toMatchObject({
      type: 'matchEnd',
      placements: [
        { seat: ada.seat, name: 'Ada', place: 2 },
        { seat: bea.seat, name: 'Bea', place: 1 },
      ],
    });
  });

  it('frees a disconnected seat so the other player is not stuck', () => {
    const logs: ServerMessage[] = [];
    const room = new MatchRoom(() => 0, () => 0);
    const ada = room.join({ send() {} }, 'Ada');
    const bea = room.join(sink(logs), 'Bea');
    if (!ada.ok || !bea.ok) throw new Error('expected two seats');
    room.handle(ada.seat, { type: 'ready' });
    room.handle(bea.seat, { type: 'ready' });
    room.leave(ada.seat);
    expect(logs.some((message) => message.type === 'matchEnd' && message.winnerSeat === bea.seat)).toBe(true);

    const cam = room.join({ send() {} }, 'Cam');
    expect(cam.ok).toBe(true);
  });
});

describe('match server', () => {
  it('plays an earn from one socket into the other client jammer', async () => {
    const server = await startMatchServer(0);
    servers.push(server);
    const ada = await openSeat(server.port, 'Ada');
    const bea = await openSeat(server.port, 'Bea');
    const startAda = nextMessage(ada, 'matchStart');
    const startBea = nextMessage(bea, 'matchStart');
    ada.send(JSON.stringify({ type: 'ready' }));
    bea.send(JSON.stringify({ type: 'ready' }));
    const started = await Promise.all([startAda, startBea]);
    expect(started[0].roster).toHaveLength(2);
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

  it('rejects a third socket while two seats are taken', async () => {
    const server = await startMatchServer(0);
    servers.push(server);
    await openSeat(server.port, 'Ada');
    await openSeat(server.port, 'Bea');
    const cam = await connected(server.port);
    const error = nextMessage(cam, 'error');
    cam.send(JSON.stringify({ type: 'join', name: 'Cam' }));
    expect(await error).toMatchObject({ type: 'error', text: 'Match is full' });
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
      { seat: 1, name: 'You', alive: true, pressure: 0, hit: false, busy: false },
      { seat: 2, name: 'Ada', alive: true, pressure: 48, hit: true, busy: true },
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

  it('keeps the CPU ticker frozen while local battle is off', () => {
    const game = new Game(() => 0);
    let incoming = 0;
    game.bus.on('incomingJammer', () => {
      incoming += 1;
    });
    game.sims.setLocalBattle(false);
    game.sims.syncMatchClock(30);
    game.sims.update(3);
    expect(incoming).toBe(0);
    expect(game.sims.aliveCount()).toBe(100);
  });
});

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
