# N1 — two-player jammer loop

Implemented. Local single-player is still the default. This phase is a dev loop: two browsers, one in-memory match, no bots and no 101-seat lobby.

## What works

- `server/` is a Node + `ws` process. `npm run server` listens on `ws://localhost:8787` (`PORT` overrides the port, bound on `0.0.0.0` so a later host can see it).
- One room, two human seats. A third join is rejected. In-memory only.
- Messages: `join`, `ready`, `lobby`, `matchStart`, `earnAttack`, `jammerInbound`, `rosterDelta`, `deathReport`, `playerEliminated`, `matchEnd`, `ping`.
- The client sends `earnAttack` only for a ghost batch: type `ghost` plus the ghost count. `dots` and `clear` are ignored, and so is a `target` field. Ghost strength below 1 is dropped. Other ghost strengths are clamped to 1–200. More than 12 earns in a second are dropped.
- The server picks the other living seat, adds pressure, and sends `jammerInbound` only to that seat. The victim plays the existing inbound jammer (panel flight into the ghost house, then local chasers).
- `rosterDelta` updates side-panel 1 (pressure, hit flash, busy). The other 99 panels are parked out so the alive counter reads 2.
- A local maze death sends `deathReport`. The server confirms with `playerEliminated`. Pressure at 100, or a disconnect during play, eliminates that seat and `matchEnd` names the other seat. The client then uses the existing win congratulations or death standings.
- `join` stores each typed name (trimmed, 16 characters, blank becomes Pac). `matchEnd.placements` is the same list on every client: seat, that name, and place. The loser is 2nd; the winner is 1st. Online standings render that list. They do not invent CPU names for the human seats. A win still shows congratulations first. A loss still waits out the death pause. Offline standings stay the local 101.
- Offline **Start match** never opens a socket. Online is **Online (dev)** on the title screen, or `?online=1`. `?ws=` overrides the socket URL.

## Ghost attack window

`GHOST_ATTACK_WINDOW` is 2 seconds. The first frightened-ghost eat (a main ghost or a train follower) opens the window. Further eats in those 2 seconds only increment a count. Nothing is sent per bite.

When the window ends, the client sends **one** `earnAttack` with type `ghost` and strength equal to that count. The server still picks the other living seat. The victim spawns **that many** inbound jammers — one per ghost — not `ceil(pressure / 8)`. One ghost alone is one jammer, two seconds later. Three ghosts inside the window are one attack that delivers three jammers. The next eat opens a new window.

A single eat used to send strength `48 + chain * 22`. The victim turned that into several sprites (`inboundCount`), so one ghost looked like a handful of jammers. Ghost strength is now the count.

An empty window never sends. Time passing, a power pellet, ordinary dots, and a full clear do not open it and do not send an attack. Eating ghosts is the only player attack.

Offline, that same window adds pressure equal to the ghost count on one living sim. A CPU shot that picks you delivers one jammer, the same as one ghost eat. CPU-versus-CPU shots still use the sim pressure clock. There is no bot clock in N1, so the 10s grace on `matchStart` is only for later phases.

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

Lobby fill to 101, server bots, streamed mazes, client-chosen targets, and reconnect. Those stay N2–N4 in [networking-n0.md](networking-n0.md). The two-seat finish order is already the server's `matchEnd` list.
