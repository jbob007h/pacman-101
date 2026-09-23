# N1 — two-player jammer loop

Implemented. Local single-player is still the default. This phase is a dev loop: two browsers, one in-memory match, no bots and no 101-seat lobby.

## What works

- `server/` is a Node + `ws` process. `npm run server` listens on `0.0.0.0` and `ws://localhost:8787` (`PORT` overrides the port). GET `/` returns 200 so a host health check can pass. WebSocket upgrades on that same port are the match.
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

Offline, that same window adds pressure equal to the ghost count on one living sim. Each CPU fires on its own 8–12 second timer. A shot is 1–16 jammers: that many sprites if it picks you, or that much pressure if it picks another sim. There is no bot clock in N1. Later bots should use this per-seat cadence. The `grace` field on `matchStart` stays 10 for that later phase. Local CPU timers do not read it.

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

`npm run dev` always uses `ws://localhost:8787` unless the page has `?ws=`. A production build (`npm run build`, GitHub Pages, `npm run preview`) does not. It uses `VITE_WS_URL` when that was set at build time, and it must be `wss://` (a loopback `ws://` is allowed only for a local preview). If `VITE_WS_URL` is missing, **Online** shows a note and does not open a socket. It does not silently use localhost.

## Play with a friend

Both people open the Pages site: https://jbob007h.github.io/pacman-101/

If that URL 404s, the README explains how to turn Pages on (branch `gh-pages` / root, or GitHub Actions).

Each person types a name and clicks **Online** (on a local dev server the button says **Online (dev)**). Both join the same room. There are two seats. When both are in, both count down. Eat a frightened ghost in one browser. The other browser gets the inbound jammer. Dots and a full clear do not send an attack.

That public page only connects after the steps below. Until `VITE_WS_URL` is baked into the Pages build, Online explains that this build has no match server.

One room, in memory. A third person gets "Match is full". Closing the tab during play eliminates that seat. A server restart clears the room.

`?ws=` still overrides the URL for that page load, including on Pages: `?ws=wss://your-service.onrender.com`.

## Host the server on Render

This repo cannot create the Render account or the service. Jason does that once in the Render dashboard. After it exists, the Blueprint in `render.yaml` is enough to redeploy from GitHub.

1. Push the branch that contains `render.yaml` (this PR) so GitHub has it.
2. In [Render](https://dashboard.render.com), choose **New → Blueprint**, and connect the `jbob007h/pacman-101` repo. Render reads `render.yaml`.
3. The blueprint is a free Node web service. Build is `npm ci`. Start is `npm run server`. Health check is GET `/`. Node is 22. `tsx` is a runtime dependency so a production install can still run the TypeScript server. Render sets `PORT`. The process already binds `0.0.0.0`.
4. If the suggested service name is taken, pick another. Create the service and wait until the first deploy is live.
5. Copy the host Render shows, such as `https://your-service.onrender.com`. The browser URL is the same host with `wss://` and no path: `wss://your-service.onrender.com`. GitHub Pages is HTTPS, so `ws://` will not connect from that site.
6. In the GitHub repo, open **Settings → Secrets and variables → Actions → Variables → New repository variable**. Name: `VITE_WS_URL`. Value: that `wss://` URL. This is not a secret. Do not commit the host into the game source.
7. Redeploy Pages so Vite can inline the variable. **Actions → Deploy GitHub Pages → Run workflow** on this branch, or push a commit. Changing the variable does nothing until the next Pages build.
8. If Pages is set to deploy the `gh-pages` branch instead of GitHub Actions, that branch is a copy of `dist`. Rebuild with `VITE_WS_URL` set in the environment, then update `gh-pages`. The Actions variable is only read by `.github/workflows/pages.yml`.

A local `.env.example` shows the same variable. `npm run dev` ignores it. `npm run build` and `npm run preview` use it.

### Free tier

Render free web services spin down after about 15 minutes without traffic. The next visit has to boot the instance. That cold start is often 30–60 seconds and sometimes longer. The title line reads "Connecting to …" while it waits. If the first try fails, wait a minute and click Online again. Waking up restarts the process, so the in-memory room is empty afterward. There is no database. This is still one room and two seats, not a lobby.

## Not in N1

Lobby fill to 101, server bots, streamed mazes, client-chosen targets, and reconnect. Those stay N2–N4 in [networking-n0.md](networking-n0.md). The two-seat finish order is already the server's `matchEnd` list.
