import { describe, expect, it } from 'vitest';
import { DIR_LEFT } from '../src/shared/types';
import { Game } from '../src/game';
import type { InboundJammer } from '../src/gameplay/inbound';
import { KILL_PRESSURE } from '../src/config';
import { LOBBY_COUNTDOWN_MS } from '../src/net/protocol';
import type { ServerMessage } from '../src/net/protocol';
import { cpuName } from '../src/systems/names';
import {
  blankMemory,
  koVoiceOnEnd,
  koVoiceOnScore,
  rememberAttack,
  rememberWhiteTouch,
  resolveKnockout,
  causeFromMemory,
} from '../src/systems/knockouts';
import { MatchRoom, type SeatLink } from '../server/match';

function liveJammer(partial: Pick<InboundJammer, 'kind' | 'sender'> & { x: number; y: number }): InboundJammer {
  return {
    kind: partial.kind,
    sender: partial.sender,
    phase: 'live',
    anim: 1,
    centerKey: -1,
    prevX: partial.x,
    prevY: partial.y,
    x: partial.x,
    y: partial.y,
    dir: { ...DIR_LEFT },
    queued: null,
  };
}

function quiet(game: Game): void {
  for (const sim of game.sims.sims) sim.attackIn = 1e9;
}

function killOnGhost(game: Game): void {
  const blinky = game.board.ghosts[0];
  if (!blinky) throw new Error('missing blinky');
  game.board.pac.x = blinky.x;
  game.board.pac.y = blinky.y;
  blinky.mode = 'chase';
  game.update(1 / 60);
}

describe('knockout credit', () => {
  it('credits a red sender, a later white sender, the latest attack, nobody, or a senderless white', () => {
    expect(resolveKnockout(4, { kind: 'red', sender: 2 })).toBe(2);
    expect(resolveKnockout(4, { kind: 'red', sender: null })).toBeNull();

    const memory = blankMemory();
    rememberWhiteTouch(memory, 3);
    rememberWhiteTouch(memory, 8);
    rememberAttack(memory, 1);
    expect(causeFromMemory(memory, undefined)).toEqual({ kind: 'white', sender: 8 });
    expect(resolveKnockout(memory.lastAttacker, causeFromMemory(memory, undefined))).toBe(8);
    expect(resolveKnockout(memory.lastAttacker, { kind: 'red', sender: 2 })).toBe(2);

    const untouched = blankMemory();
    rememberAttack(untouched, 6);
    expect(resolveKnockout(untouched.lastAttacker, { kind: 'none' })).toBe(6);
    expect(resolveKnockout(null, { kind: 'none' })).toBeNull();

    rememberWhiteTouch(untouched, null);
    expect(untouched.touchedWhite).toBe(false);
    expect(resolveKnockout(untouched.lastAttacker, causeFromMemory(untouched, undefined))).toBe(6);
    expect(resolveKnockout(6, { kind: 'white', sender: null })).toBeNull();
  });

  it('says K.O. once, then Double K.O. after a pile-up', () => {
    let state = { busy: false, holdDouble: false };
    const first = koVoiceOnScore(state);
    state = first.state;
    expect(first.speak).toBe('K.O.');
    const piled = koVoiceOnScore(state);
    state = piled.state;
    expect(piled.speak).toBeNull();
    const again = koVoiceOnScore(state);
    expect(again.speak).toBeNull();
    const after = koVoiceOnEnd(again.state);
    expect(after.speak).toBe('Double K.O.');
    expect(koVoiceOnEnd(after.state).speak).toBeNull();
  });

  it('credits the local maze for red, last white, latest attack, never attacked, and self-spawned white', () => {
    const red = new Game(() => 0.5);
    quiet(red);
    const pac = red.board.pac;
    red.board.inbound.jammers.push(liveJammer({ kind: 'red', sender: 4, x: pac.x, y: pac.y }));
    red.update(1 / 60);
    expect(red.match.phase).toBe('lost');
    expect(red.ranking.snapshot().rows.find((row) => row.name === cpuName(4))?.koYou).toBe(true);
    expect(red.hud().kos).toBe(0);

    const whites = new Game(() => 0.5);
    quiet(whites);
    const spot = whites.board.pac;
    whites.board.inbound.jammers.push(liveJammer({ kind: 'white', sender: 3, x: spot.x, y: spot.y }));
    whites.update(1 / 60);
    expect(whites.match.phase).toBe('playing');
    whites.board.inbound.jammers.push(liveJammer({ kind: 'white', sender: 9, x: spot.x, y: spot.y }));
    whites.update(1 / 60);
    killOnGhost(whites);
    expect(whites.ranking.snapshot().rows.find((row) => row.name === cpuName(9))?.koYou).toBe(true);
    expect(whites.ranking.snapshot().rows.find((row) => row.name === cpuName(3))?.koYou).toBe(false);

    const attacked = new Game(() => 0.5);
    quiet(attacked);
    attacked.bus.emit({ type: 'incomingJammer', fromSimId: 7, strength: 1, exact: true });
    killOnGhost(attacked);
    expect(attacked.ranking.snapshot().rows.find((row) => row.name === cpuName(7))?.koYou).toBe(true);

    const clean = new Game(() => 0.5);
    quiet(clean);
    killOnGhost(clean);
    expect(clean.ranking.snapshot().rows.some((row) => row.koYou)).toBe(false);
    expect(clean.hud().kos).toBe(0);

    const self = new Game(() => 0.5);
    quiet(self);
    const selfPac = self.board.pac;
    self.board.inbound.jammers.push(liveJammer({ kind: 'white', sender: null, x: selfPac.x, y: selfPac.y }));
    self.update(1 / 60);
    killOnGhost(self);
    expect(self.ranking.snapshot().rows.some((row) => row.koYou)).toBe(false);

    const selfAfter = new Game(() => 0.5);
    quiet(selfAfter);
    selfAfter.bus.emit({ type: 'incomingJammer', fromSimId: 2, strength: 1, exact: true });
    const after = selfAfter.board.pac;
    selfAfter.board.inbound.jammers.push(liveJammer({ kind: 'white', sender: null, x: after.x, y: after.y }));
    selfAfter.update(1 / 60);
    killOnGhost(selfAfter);
    expect(selfAfter.ranking.snapshot().rows.find((row) => row.name === cpuName(2))?.koYou).toBe(true);
  });

  it('credits CPU pressure kills and mistake deaths through the same rules', () => {
    const game = new Game(() => 0.5);
    quiet(game);
    const attacker = game.sims.sims[0];
    if (!attacker) throw new Error('missing attacker');
    attacker.attackIn = 0;
    for (const sim of game.sims.sims) {
      if (sim.id !== attacker.id) sim.pressure = KILL_PRESSURE - 1;
    }
    game.sims.update(0.05, 0);
    const dead = game.sims.sims.find((sim) => !sim.alive);
    if (!dead) throw new Error('expected a pressure KO');
    expect(game.knockouts.killer(dead.id)).toBe(attacker.id);
    expect(game.knockouts.count(attacker.id)).toBe(1);

    const mistakes = new Game(() => 1);
    quiet(mistakes);
    mistakes.bus.emit({ type: 'jammersSent', targets: [5], strength: 1, reason: 'sim', fromSimId: 2 });
    for (let i = 0; i < 40; i++) mistakes.sims.update(0.05, 15 + i * 0.05);
    expect(mistakes.sims.sims[4]?.alive).toBe(false);
    expect(mistakes.knockouts.killer(5)).toBe(2);
    expect(mistakes.knockouts.count(2)).toBe(1);
    expect(mistakes.knockouts.killer(8)).toBeNull();
    expect(mistakes.hud().kos).toBe(0);
  });

  it('lets the player score a KO and keep the red X', () => {
    const game = new Game(() => 0.5);
    game.sfx.setMuted(false);
    quiet(game);
    game.bus.emit({ type: 'jammersSent', targets: [6], strength: 1, reason: 'ghost' });
    game.bus.emit({ type: 'simEliminated', simId: 6, remainingPlayers: 100 });
    expect(game.hud().kos).toBe(1);
    expect(game.sims.sims[5]?.koByYou).toBe(true);
    expect(game.ranking.snapshot().rows.find((row) => row.name === cpuName(6))?.koByYou).toBe(true);
    expect(game.sfx.log).toContain('ko');
  });
});

describe('server knockout credit', () => {
  it('resolves red, last white, latest attack, never attacked, and a senderless white', () => {
    const logs: ServerMessage[] = [];
    const link = (): SeatLink => ({
      send(message) {
        logs.push(message);
      },
    });
    let pickBea = false;
    const clock = mutableClock();
    const room = new MatchRoom(clock.now, () => (pickBea ? 0.015 : 0));
    const ada = room.join(link(), 'Ada');
    const bea = room.join(link(), 'Bea');
    const cam = room.join(link(), 'Cam');
    if (!ada.ok || ada.role !== 'player' || !bea.ok || bea.role !== 'player' || !cam.ok || cam.role !== 'player') {
      throw new Error('expected three seats');
    }
    for (const id of [ada.seat, bea.seat, cam.seat]) room.handle(id, { type: 'ready' });
    clock.advance(LOBBY_COUNTDOWN_MS);
    room.tick();
    logs.length = 0;

    const untouched = startedRoom();
    untouched.room.handle(untouched.bea, { type: 'deathReport', cause: { kind: 'none' } });
    expect(untouched.logs.some((message) => message.type === 'ko')).toBe(false);

    room.handle(ada.seat, { type: 'earnAttack', attack: 'ghost', strength: 1 });
    pickBea = true;
    room.handle(cam.seat, { type: 'earnAttack', attack: 'ghost', strength: 1 });
    logs.length = 0;
    room.handle(bea.seat, { type: 'deathReport', cause: { kind: 'white', sender: ada.seat } });
    expect(logs.find((message) => message.type === 'ko')).toMatchObject({
      type: 'ko',
      victim: bea.seat,
      killer: ada.seat,
      killerKos: 1,
    });

    const redRoom = startedRoom();
    redRoom.room.handle(redRoom.ada, { type: 'earnAttack', attack: 'ghost', strength: 1 });
    redRoom.logs.length = 0;
    redRoom.room.handle(redRoom.bea, { type: 'deathReport', cause: { kind: 'red', sender: redRoom.ada } });
    expect(redRoom.logs.find((message) => message.type === 'ko')).toMatchObject({
      killer: redRoom.ada,
      victim: redRoom.bea,
    });

    const plain = startedRoom();
    plain.room.handle(plain.ada, { type: 'earnAttack', attack: 'ghost', strength: 1 });
    plain.logs.length = 0;
    plain.room.handle(plain.bea, { type: 'deathReport', cause: { kind: 'none' } });
    expect(plain.logs.find((message) => message.type === 'ko')).toMatchObject({ killer: plain.ada });

    const blocked = startedRoom();
    blocked.room.handle(blocked.ada, { type: 'earnAttack', attack: 'ghost', strength: 1 });
    blocked.logs.length = 0;
    blocked.room.handle(blocked.bea, { type: 'deathReport', cause: { kind: 'white', sender: null } });
    expect(blocked.logs.some((message) => message.type === 'ko')).toBe(false);

    const forged = startedRoom();
    forged.room.handle(forged.ada, { type: 'earnAttack', attack: 'ghost', strength: 1 });
    forged.logs.length = 0;
    forged.room.handle(forged.bea, { type: 'deathReport', cause: { kind: 'red', sender: 40 } });
    expect(forged.logs.some((message) => message.type === 'ko')).toBe(false);

    const pressure = startedRoom();
    pressure.logs.length = 0;
    pressure.room.handle(pressure.ada, { type: 'earnAttack', attack: 'ghost', strength: KILL_PRESSURE });
    expect(pressure.logs.some((message) => message.type === 'ko' || message.type === 'playerEliminated')).toBe(false);
    expect(pressure.logs.some((message) => message.type === 'jammerInbound')).toBe(true);
    const roster = [...pressure.logs].reverse().find((message) => message.type === 'rosterDelta');
    expect(roster?.type === 'rosterDelta' ? roster.seats.find((seat) => seat.seat === pressure.bea)?.alive : false).toBe(
      true,
    );
  });
});

function mutableClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

function startedRoom(): { room: MatchRoom; logs: ServerMessage[]; ada: number; bea: number } {
  const logs: ServerMessage[] = [];
  const clock = mutableClock();
  const room = new MatchRoom(clock.now, () => 0);
  const ada = room.join({ send: (message) => logs.push(message) }, 'Ada');
  const bea = room.join({ send: (message) => logs.push(message) }, 'Bea');
  if (!ada.ok || ada.role !== 'player' || !bea.ok || bea.role !== 'player') throw new Error('expected two seats');
  room.handle(ada.seat, { type: 'ready' });
  room.handle(bea.seat, { type: 'ready' });
  clock.advance(LOBBY_COUNTDOWN_MS);
  room.tick();
  return { room, logs, ada: ada.seat, bea: bea.seat };
}
