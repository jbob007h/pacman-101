# N2a — eight-seat room with CPU fillers

Superseded by [networking-n2b.md](networking-n2b.md). The live room is 101 seats, 16 humans, a 10 second countdown after the first Ready, and roster spectate. This note is the N2a behavior that shipped before that.

Implemented on top of the N1 jammer loop. Local single-player is still the default, and **Start match** still never opens a socket. Online is one in-memory room of **8 seats** (humans and CPU bots together). N2b raises the fill toward 101 by changing `ROOM_SIZE` in `src/net/protocol.ts`. The human join cap is the separate constant `MAX_HUMANS` (also 8 today).

## What changed from N1

- Up to 8 humans can join. The next one still gets "Match is full". A match that has already started also rejects a new join with that same text.
- Humans join, then click **Ready**. The match starts when every human already in the lobby is Ready. One human alone is enough: solo online practice is allowed.
- At the whistle the server pads every empty seat with a CPU bot, then sends `matchStart` with the full 8-seat roster. Eight ready humans means zero bots.
- Each bot is a pressure filler, not a maze. It uses the offline CPU cadence: its own 5–15s timer from match start, then a 1–16 jammer roll at one other living seat, equal odds, scaled by the match-time cancel ramp. `matchStart.grace` stays 10 and is not a gate.
- A human `earnAttack` is still ghost-only, with no target. The server picks any other living seat, human or bot. Human → bot updates pressure and the roster only. Bot → human also sends `jammerInbound`. Bot → bot is pressure only.
- `deathReport` is still a claim. `playerEliminated` confirms it and locks that seat's place. Disconnect during play eliminates that human. Bots stay until pressure or the rules take them out.
- When **your** seat is eliminated, standings open after the same death pause, even if other humans and bots are still playing. Eliminated seats show the server place and name. Seats still alive stay on the list with a blank place. Later `playerEliminated` events and roster updates rewrite that list in place. `matchEnd` replaces it with the final order, including the winner and every bot name. Opening standings does not end the match for anyone else. The last survivor still gets congratulations before standings.
- The client parks the offline 100-panel field down to the other seats in the roster, so the alive counter reads 8 (you included), not 101. Those panels show name, pressure, alive, hit flash, and busy.

Authority is unchanged from [networking-n0.md](networking-n0.md). Mazes stay local. Clients do not pick targets.

## Run it locally

Terminal 1:

```bash
npm run server
```

Terminal 2:

```bash
npm run dev
```

`npm run dev` uses `ws://localhost:8787` unless the page has `?ws=`. A production build uses `VITE_WS_URL` and does not fall back to localhost. Do not hardcode the Render host. Health check is still GET `/`. Start command is still `npm run server`.

### One browser, seven CPUs

1. Open `http://localhost:5173/pacman-101/`.
2. Type a name. Click **Online (dev)** (the button says **Online** on a production build).
3. The title stays up with the lobby line and a **Ready** button. Click **Ready**.
4. The match counts down. Alive reads **8**. Seven side panels show CPU names (the same cute names as offline). The other offline panels are hidden.
5. Eat a frightened ghost. After the 2-second batch, one living seat takes that many jammers worth of pressure. If the server picked you, you see the inbound jammer. Bots also shoot on their own 5–15s timers.

### Two browsers, fewer bots

1. Start the server and `npm run dev` as above.
2. Open two tabs at `http://localhost:5173/pacman-101/`.
3. In **both** tabs, click **Online (dev)** and wait until both names show in the lobby line. Do this **before** either tab clicks Ready. If the first tab readies first, the room starts with seven CPUs and the second tab gets "Match is full".
4. Click **Ready** in both tabs.
5. Alive reads 8. The roster is the two humans plus six CPUs.

**Start match** in either tab closes the socket and plays the local 101-sim battle. `R` during an online session leaves and rejoins the lobby (you must Ready again). Menu disconnects.

Friends on the public site use the same room after the Render steps in [networking-n1.md](networking-n1.md). The Pages build still needs `VITE_WS_URL`. The room is no longer two seats: a ninth human is the one who sees "Match is full".
