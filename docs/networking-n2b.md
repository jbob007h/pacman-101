# N2b — lobby countdown, 101 seats, spectate

Implemented. Local single-player is still the default. Offline **Start match** never opens a socket. `VITE_WS_URL` and dev `ws://localhost:8787` are unchanged.

N2a started the match on the first Ready and padded immediately. That skipped anyone still joining. N2b waits.

## Lobby

`ROOM_SIZE` is 101. `MAX_HUMANS` is 16. `LOBBY_COUNTDOWN_MS` is 10 seconds. All three are named constants in `src/net/protocol.ts`. Change the wait by editing that one constant.

1. A human clicks **Online**. The client joins and sends `ready`.
2. The first Ready starts the countdown. The match does not start on that instant.
3. More humans may join and Ready until the countdown hits 0, up to 16.
4. At 0 the server fills every empty seat with a CPU bot and sends `matchStart`.
5. Solo Ready still waits, then pads to 101. Two humans before the end means 99 bots.

A 17th human in the lobby gets `Lobby is full` and the socket closes. The 9th through 16th are normal lobby seats.

`lobby` carries `countdownMs` (`null` before the first Ready) and `need: 101`. The title note counts humans and the seconds left.

## Bots

Server bots use the same per-seat cadence as local CPUs: first shot and every later shot wait 8–12 seconds, and each shot is 1–16 jammers. The server picks the target. Only `ghost` earns apply. A bot hit on a human is `jammerInbound`. A bot hit on a bot is pressure on the roster. The jammer chase gate and speed feel stay on the client.

`matchStart.grace` is still 10. Bot timers do not treat that as a shared fast clock.

## Playing seats

`matchStart.roster` is the full 101. The client maps the other seats onto the side panels, so Alive reads 101, and turns local CPU targeting off. Ghost eats still send one `earnAttack`. Dots and clears do not.

Partial standings still update when a playing seat is eliminated: locked place, blank spots for whoever is alive. `matchEnd` replaces that with the server's full list. Win still shows congratulations first.

## Spectate

Joining while a match is already in play does not take a playing seat. The server sends `spectate` with the live roster and the match clock in seconds. The client sets a spectator flag and shows the same battle-layer roster as N0: alive, pressure, names, hit flash, busy, eliminations, and the clock.

A spectator does not get a maze for this match. The client will not send `earnAttack` or `deathReport`, and the server ignores those messages if they arrive. There is no remote maze view.

When `matchEnd` arrives, that spectator is moved into the next lobby (Ready is sent with the lobby message) so they can play the following match. Humans who just played stay on their standings until they rejoin. Rejoin after the next match has started spectates that match.

## Messages added

| Message | Direction | Purpose |
| --- | --- | --- |
| `lobby.countdownMs` | server → client | Milliseconds left, or `null` before the first Ready. |
| `spectate` | server → client | Roster and match clock for a non-playing viewer. |
| `rosterDelta.clock` | server → client | Match seconds, included while the match is in play. |

Roster seats may set `bot: true`.
