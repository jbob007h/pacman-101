# N1 — two-player jammer loop

Implemented. Local single-player is still the default. This phase is a dev loop: two browsers, one in-memory match, no bots and no 101-seat lobby.

## What works

- `server/` is a Node + `ws` process. `npm run server` listens on `ws://localhost:8787` (`PORT` overrides the port, bound on `0.0.0.0` so a later host can see it).
- One room, two human seats. A third join is rejected. In-memory only.
- Messages: `join`, `ready`, `lobby`, `matchStart`, `earnAttack`, `jammerInbound`, `rosterDelta`, `deathReport`, `playerEliminated`, `matchEnd`, `ping`.
- The client sends `earnAttack` with `ghost`, `dots`, or `clear` plus a strength. A `target` field is ignored. Strength is clamped to 1–200. More than 12 earns in a second are dropped.
- The server picks the other living seat, adds pressure, and sends `jammerInbound` only to that seat. The victim plays the existing inbound jammer (panel flight into the ghost house, then local chasers).
- `rosterDelta` updates side-panel 1 (pressure, hit flash, busy). The other 99 panels are parked out so the alive counter reads 2.
- A local maze death sends `deathReport`. The server confirms with `playerEliminated`. Pressure at 100, or a disconnect during play, eliminates that seat and `matchEnd` names the other seat. The client then uses the existing win congratulations or death standings.
- Offline **Start match** never opens a socket. Online is **Online (dev)** on the title screen, or `?online=1`. `?ws=` overrides the socket URL.

## Same rules as local earns

Strength matches the local jammer math: ghost pressure is `48 + chain * 22`, a 50-dot milestone is 22, a clear is 42. Train-only eats do not earn. A clear is one claim; with two seats the server lands it on the other player once, not on eight targets.

Human earns are not delayed. There is no bot clock in N1, so the 10s grace is only carried on `matchStart` for later phases.

## Run it

Terminal 1:

```bash
npm run server
```

Terminal 2:

```bash
npm run dev
```

Open two tabs at `http://localhost:5173/pacman-101/?online=1` (or click **Online (dev)**). Each tab joins and readies. When both are in, both count down. Eat a frightened ghost in one tab. The other tab gets an inbound jammer.

**Start match** in either tab drops the socket and plays the local 101-sim battle. `R` during an online session leaves and rejoins. Menu disconnects.

A Render free deploy can wait. The process already honors `PORT`. Do not point the GitHub Pages build at a socket until one is actually hosted; `?online=1` from that site tries `ws://localhost:8787` on the player's machine.

## Not in N1

Lobby fill to 101, server bots, streamed mazes, client-chosen targets, reconnect, and server-authored rankings. Those stay N2–N4 in [networking-n0.md](networking-n0.md).
