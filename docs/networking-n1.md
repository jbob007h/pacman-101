# N1 — two-player jammer loop

Implemented. Local single-player is still the default. This phase shipped a dev loop: two browsers, one in-memory match, no bots.

**N2a supersedes the two-seat cap.** The server now takes up to 8 humans and pads the rest with CPU bots. Follow [networking-n2a.md](networking-n2a.md) to play. The sections below are what N1 proved; where they say "two seats" or "a third join is rejected", that limit is gone.

## What works

- `server/` is a Node + `ws` process. `npm run server` listens on `0.0.0.0` and `ws://localhost:8787` (`PORT` overrides the port). GET `/` returns 200 so a host health check can pass. WebSocket upgrades on that same port are the match.
- One in-memory room. N1 allowed two human seats and rejected a third join. N2a raises that to 8 humans and pads empty seats with bots.
- Messages: `join`, `ready`, `lobby`, `matchStart`, `earnAttack`, `jammerInbound`, `rosterDelta`, `deathReport`, `playerEliminated`, `matchEnd`, `ping`.
- The client sends `earnAttack` only for a ghost batch: type `ghost` plus the ghost count. `dots` and `clear` are ignored, and so is a `target` field. Ghost strength below 1 is dropped. Other ghost strengths are clamped to 1–200. More than 12 earns in a second are dropped.
- The server picks the other living seat, adds pressure, and sends `jammerInbound` only to that seat. The victim plays the existing inbound jammer (panel flight into the ghost house, then local chasers).
- `rosterDelta` updates the live side panels (pressure, hit flash, busy). N1 parked the other 99 panels so the alive counter read 2. N2a parks down to the 8-seat roster instead.
- A local maze death sends `deathReport`. The server confirms with `playerEliminated`. Pressure at 100, or a disconnect during play, eliminates that seat and `matchEnd` names the other seat. The client then uses the existing win congratulations or death standings.
- `join` stores each typed name (trimmed, 16 characters, blank becomes Pac). `matchEnd.placements` is the same list on every client: seat, that name, and place. The loser is 2nd; the winner is 1st. Online standings render that list. They do not invent CPU names for the human seats. A win still shows congratulations first. A loss still waits out the death pause. Offline standings stay the local 101.
- Offline **Start match** never opens a socket. Online is **Online (dev)** on the title screen, or `?online=1`. `?ws=` overrides the socket URL.

## Ghost attack window

`GHOST_ATTACK_WINDOW` is 2 seconds. The first frightened-ghost eat (a main ghost or a train follower) opens the window. Further eats in those 2 seconds only increment a count. Nothing is sent per bite.

When the window ends, the client sends **one** `earnAttack` with type `ghost` and strength equal to that count. The server still picks the other living seat. The victim spawns **that many** inbound jammers — one per ghost — not `ceil(pressure / 8)`. One ghost alone is one jammer, two seconds later. Three ghosts inside the window are one attack that delivers three jammers. The next eat opens a new window.

A single eat used to send strength `48 + chain * 22`. The victim turned that into several sprites (`inboundCount`), so one ghost looked like a handful of jammers. Ghost strength is now the count.

An empty window never sends. Time passing, a power pellet, ordinary dots, and a full clear do not open it and do not send an attack. Eating ghosts is the only player attack.

Offline, that same window adds pressure equal to the ghost count on one living sim. Each CPU fires on its own 8–12 second timer. A shot is 1–16 jammers: that many sprites if it picks you, or that much pressure if it picks another sim. There was no bot clock in N1. N2a bots use this per-seat cadence. The `grace` field on `matchStart` stays 10 and is not a gate. Local CPU timers do not read it.

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

Each person types a name and clicks **Online** (on a local dev server the button says **Online (dev)**), then **Ready**. N1 started as soon as two humans were in. N2a waits until every human already in the lobby is Ready, then fills the room to 8. Eat a frightened ghost in one browser. The server picks one living seat. Dots and a full clear do not send an attack.

That public page only connects after the steps below. Until `VITE_WS_URL` is baked into the Pages build, Online explains that this build has no match server.

One room, in memory. N1 told a third person "Match is full". N2a says that only when a ninth human joins, or when a match is already going. Closing the tab during play eliminates that human seat. A server restart clears the room.

`?ws=` still overrides the URL for that page load, including on Pages: `?ws=wss://your-service.onrender.com`.

## Host the server on Render

This repo cannot create the Render account or the service. Jason does that once in the Render dashboard. After it exists, the Blueprint in `render.yaml` is enough to redeploy from GitHub.

1. Push the branch that contains `render.yaml` (this PR) so GitHub has it.
2. In [Render](https://dashboard.render.com), choose **New → Blueprint**, and connect the `jbob007h/pacman-101` repo. Render reads `render.yaml`.
3. The blueprint is a free Node web service. Build is `npm ci`. Start is `npm run server`. Health check is GET `/`. Node is 22. `tsx` is a runtime dependency so a production install can still run the TypeScript server. Render sets `PORT`. The process already binds `0.0.0.0`.
   `npm ci` only works when `package-lock.json` is in the commit Render builds. That file is on this PR branch. It is not on `main` until the PR merges. If the service branch is `main`, the build stops with "The `npm ci` command can only install with an existing package-lock.json". In the Render service, set the branch to `cursor/pacman-101-milestone-1-cf5f` and redeploy.
   If you create the Web Service by hand and the branch you picked still has no lockfile, set the Build Command to `npm install` for that deploy. Change it back to `npm ci` once `package-lock.json` is on the branch.
4. If the suggested service name is taken, pick another. Create the service and wait until the first deploy is live.
5. Copy the host Render shows, such as `https://your-service.onrender.com`. The browser URL is the same host with `wss://` and no path: `wss://your-service.onrender.com`. GitHub Pages is HTTPS, so `ws://` will not connect from that site.
6. In the GitHub repo, open **Settings → Secrets and variables → Actions → Variables → New repository variable**. Name: `VITE_WS_URL`. Value: that `wss://` URL. This is not a secret. Do not commit the host into the game source.
7. Redeploy Pages so Vite can inline the variable. **Actions → Deploy GitHub Pages → Run workflow** on this branch, or push a commit. Changing the variable does nothing until the next Pages build.
8. If Pages is set to deploy the `gh-pages` branch instead of GitHub Actions, that branch is a copy of `dist`. Rebuild with `VITE_WS_URL` set in the environment, then update `gh-pages`. The Actions variable is only read by `.github/workflows/pages.yml`.

A local `.env.example` shows the same variable. `npm run dev` ignores it and uses `ws://localhost:8787`. `npm run build` and `npm run preview` use `VITE_WS_URL`. Do not hardcode the Render host in the client.

### Free tier

Render free web services spin down after about 15 minutes without traffic. The next visit has to boot the instance. That cold start is often 30–60 seconds and sometimes longer. The title line reads "Connecting to …" while it waits. If the first try fails, wait a minute and click Online again. Waking up restarts the process, so the in-memory room is empty afterward. There is no database. N2a is still one in-memory room. It holds 8 seats, not a directory of rooms.

## Not in N1

Lobby fill, server bots, streamed mazes, client-chosen targets, and reconnect were out of N1. N2a now has the lobby, an 8-seat bot fill, and roster panels. See [networking-n2a.md](networking-n2a.md). Fill to 101 is N2b. Streamed mazes stay out. Reconnect stays N4 in [networking-n0.md](networking-n0.md). Finish order is still the server's `matchEnd` list, and N2a includes the bot names on that list.
