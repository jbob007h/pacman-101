# 101

Local battle maze inspired by Pac-Man 99. You play the center board. One hundred simulated opponents sit on mini-boards — fifty on the left, fifty on the right. Eating frightened ghosts throws jammers at them. Stack enough pressure and they are eliminated. Last one standing wins.

Play here is local by default. The battle-layer plan is [docs/networking-n0.md](docs/networking-n0.md). N1 is the jammer loop: [docs/networking-n1.md](docs/networking-n1.md). The live room is N2b: [docs/networking-n2b.md](docs/networking-n2b.md).

## Play online

https://jbob007h.github.io/pacman-101/

The static site is on the `gh-pages` branch. `.github/workflows/pages.yml` builds `dist` and can deploy it with GitHub Actions.

If that URL 404s, open the repo **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, set the branch to `gh-pages` and the folder to `/ (root)`, then Save. To use the workflow instead, set the source to **GitHub Actions**.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints. With the GitHub Pages base path, that is usually `http://localhost:5173/pacman-101/`.

Other scripts:

- `npm test` — maze, movement, jammer, and match-server tests
- `npm run typecheck`
- `npm run build` — typecheck and production bundle
- `npm run preview` — serve the production bundle
- `npm run server` — N1 match server on `ws://localhost:8787` (`PORT` overrides it; `render.yaml` starts this on Render)

## Online (dev)

Local **Start match** does not open a socket. Run the server, then the client:

```bash
npm run server
npm run dev
```

Open `http://localhost:5173/pacman-101/`, click **Online (dev)**, then **Ready**. The first Ready starts a 10 second lobby countdown. At 0 the room pads to 101 with CPU bots. Another browser can join and Ready before that hits 0, which means fewer bots. A 17th human in the lobby is turned away. Joining after the match has started spectates the roster only. Ghost eats still batch for 2 seconds into one attack. The server picks the target. `?ws=ws://host:port` points at a different server.

Friends on the public site use that same room after a Render service is up and the Pages build has `VITE_WS_URL` set to its `wss://` URL. Local play stays `ws://localhost:8787`. Steps, including the free-tier cold start: [docs/networking-n1.md](docs/networking-n1.md). Details: [docs/networking-n2b.md](docs/networking-n2b.md).

## Controls

- The game opens on a title screen. Type a name (it is remembered in this browser; a blank name becomes Pac), then Start match, Enter, or Space begins a match. Arrow keys do nothing until then.
- The match then counts Ready…, 3…, 2…, 1…, Hit it! Each beat is 60 simulation frames, one second at the locked 60Hz step. Pac stays put, and arrows are ignored, until Hit it! On that beat he moves left (the way he is facing) on his own. Arrows and WASD work after that. Reversing is instant; other turns happen at intersections. Each beat plays a short generated blip, and Hit it! plays a brighter go cue.
- Eat the large dots to frighten ghosts, then run into them to send jammers. Dot eats alternate a higher and a lower wakawaka tone.
- Keys `1`–`4` queue the next power mode: Standard, Stronger, Speed, Train. The queue turns on only when Pac eats a power pellet, and that pellet uses the new mode. The list sits over the left side grids. Standard is the normal pellet. Stronger makes that pellet last 4 seconds (a normal pellet uses the board table, 6 seconds on board 1) and doubles ghost-eat attack strength. Speed adds 3 Speed levels until a different mode turns on, and halves attack strength (rounded up). Train adds two ghosts to the train per sleeper woken, and every 4 of those wakes tries to spawn one white jammer. The wake counter resets when Train turns off and when the match restarts.
- `R` or Restart starts a new match. On the title screen, Restart starts the match. In an online match, `R` leaves and rejoins the room, and Menu disconnects. When you win, a congratulations screen comes up first. Click, tap, Space, or Enter opens the standings. After you are eliminated, a standings list shows all 101 players. People still alive have a blank place and stay marked in. Each later elimination locks the next place from the bottom and the blank closes. Menu returns to the title. Restart starts another match.
- Sound is generated in the browser (no sound files). `M`, or the Sound button on the title screen and in the header, mutes it. The choice is remembered in this browser. The button reads Muted while sound is off.
- Eating a frightened ghost freezes the maze for half a second, then play resumes.
- Eating a normal dot stops Pac for 1 simulation frame. A power pellet stops him for 3. Ghosts and jammers keep moving. The maze steps at a fixed 60Hz; the canvas can still draw on the display refresh, and a stalled tab catches up at most 5 frames.

Side panels: a number is an opponent, red fill is pressure, a gold border means they are attacking, a white flash is a fresh hit, a teal flash is a pellet or board clear shedding pressure, and an X means they are out. The Alive counter starts at 101 and includes you.

Each CPU attacks on its own timer: the first shot is 5–15 seconds after the match clock starts, and every shot after that rolls 5–15 seconds again. One shot rolls 1–16 jammers, aimed at one living seat at random (every other living opponent, plus you). That shot is cancelled with a 50% chance at match time 0, dropping 1% every 3 seconds until the chance is 0 at 150 seconds. A shot that is not cancelled sends that roll scaled by the same percent (`jammers * (100 - cancelPercent) / 100`, rounded). A scaled count that rounds to 0 is skipped. At the start that is about 1 in 100 shots aimed at your maze. A shot that picks you spawns that many jammers. A shot that picks another sim adds that much pressure. Your own attacks are ghost eats only: they batch for 2 seconds, then one living opponent takes pressure equal to the ghosts eaten. Dots and board clears do not send jammers. Every 2.5s, four living opponents shed pressure (34 for a pellet, 68 for a clear, a clear on 1 in 5 of those rolls) so the red bars are not a one-way climb. Passive recovery is 0.6 per second after a 1s lock. Your ghost eats are not delayed.

Walls next to a corridor are drawn as half a tile on the blocked side so the lanes look thin; the collision grid is unchanged. Pac, ghosts, and jammers are drawn at 2× size, still centered on their tile, so they can overhang those half-walls.

## Board speed

Eating the fruit under the ghost house refills the maze, bumps the Board counter, and speeds the next maze up. Board 1 is the slow pace. The ramp caps at board 6. Eating every pellet does not advance the board and does not reload dots: the maze stays empty, no jammer goes out, and Pac keeps a permanent movement bonus (1.6875 tiles/sec per clear, stacking for the rest of the match). Ghosts do not gain that bonus. Dots come back only when the fruit is eaten. A bouncing "Speed Up!" pops off Pac when that last pellet is eaten.

The Speed readout starts at 0. It goes up by 1 every time the board is cleared of pellets, including a clear that happens after the fruit has already been eaten and the dots refilled. It also goes up by 1 when fruit advances you off an even board (2, 4, 6, …). The 1.6875 tiles/sec bonus is the movement behind each clear's +1. It is added to Pac only. Ghost chase, fright, and Elroy stay on the board table. The even-board fruit point does not add that bonus; the board pace table is the fruit's speed change.

Fruit appears once half the pellets are eaten. That half is `ceil(total / 2)` of the dots plus power pellets on the board at the start of the current fill (the two tiles under the opening pose are already gone, and fruit itself does not count). Pac starts at tile position 13.5, 23, centered in the bottom corridor between columns 13 and 14. After the house-ring strip and the empty sleeper pads, the first fill has 234 of those (232 dots and 4 power pellets, minus those two tiles), so the fruit appears after 117 pellets. Later fills restore both dots, so that set is 236 and the half is 118. It sits on the tile in the middle of the corridor under the ghost house, column 14, row 17. Clearing the board does not remove a fruit that is already waiting, and it does not start another fruit cycle. The next fruit waits until that fruit is eaten and the next fill begins.

The side tunnels (the wrap row outside the ghost house) have no pellets. The rectangle of corridors wrapped around the ghost house — columns 9–18, rows 11–17 — has no dots or power pellets either. The sixteen sleeping-ghost pads (column 6 and column 21, rows 10–13 and 15–18) are empty too. Ghosts in chase, scatter, or frightened mode move at 55% speed while they are in those tunnels. Pac does not slow down there, and eaten ghost eyes stay fast.

Tiles per second, before the clear bonus:

| Board | Pac | Ghost chase | Frightened |
| --- | --- | --- | --- |
| 1 | 8.64 | 6.075 | 2.7675 |
| 2 | 9.6525 | 7.2225 | 3.1725 |
| 3 | 10.665 | 8.4375 | 3.645 |
| 4 | 11.6775 | 9.6525 | 4.1175 |
| 5 | 12.6225 | 10.8675 | 4.59 |
| 6+ | 13.5 | 12.015 | 5.0625 |

On board 1 the ghosts are well slower than Pac. Frightened ghosts stay under half of that board's chase speed, so a power pellet is a real opening. Later boards raise both speeds; chase closes on Pac, but a pellet still drops the ghosts to a crawl. Each full clear adds 1.6875 to Pac's tiles/sec on top of the row above, and adds 1 to the Speed readout. It does not add anything to ghost chase, fright, or Elroy. These paces are 90% of the previous 1.5× table (eyes 16.2, house bob 4.32, eyes entering the door 7.02). Leaving the house is slower still, 3.24 tiles/sec, until the ghost is fully out. Chase and scatter after that stay on the table. Elroy 1 matches the `Pac` column. Elroy 2 is 1.1× that column. Neither uses Pac's accumulated clear bonus.

## Cruise Elroy

When few pellets are left, the red ghost (Blinky) becomes Cruise Elroy. Elroy 1 moves at that board's Pac pace from the table above, before any Speed Up bonus. Elroy 2 moves at 1.1× that same base. A full clear speeds Pac up and leaves Elroy where it is. While either stage is on, Blinky chases Pac's tile even during scatter. Frightened Blinky, the other ghosts, and eyes keep their normal speeds. Eating the fruit refills the pellets, so Elroy turns off until the new board is eaten down again.

Pellets remaining (dots plus power pellets):

| Board | Elroy 1 | Elroy 2 |
| --- | --- | --- |
| 1 | 20 | 10 |
| 2 | 30 | 15 |
| 3 | 40 | 20 |
| 4 | 50 | 20 |
| 5+ | 60 | 20 |

## Sleeping ghosts and the train

Sixteen white ghosts sleep on the vertical corridors that cross the side tunnels: column 6 on the left and column 21 on the right. Each side has eight, on rows 10, 11, 12, 13, 15, 16, 17, and 18 (four above the tunnel row and four below). They sit on the tile center and are drawn smaller than the four main ghosts. The tunnel row itself is left clear. Eating the fruit puts all 16 back to sleep on those same tiles, the same as the opening board. A train that is already out stays on the maze: same leader, same followers, same spots. Waking a new sleeper appends to that train until it holds 32 followers (33 with the leader). The four main ghosts keep the position, mode, and identity they had at the advance. Clearing every pellet does not reload sleepers or the train.

Pac wakes a sleeper by touching it. That touch never eats the sleeper, even during a power pellet. Woken ghosts join **one** train behind the main ghost who was closest to that sleeper. If a train is already out, the new ghost goes to the end of it. The train holds at most 32 followers (33 with the leader). A touch at that cap does nothing.

A woken ghost flies in a straight line to its slot at 48 tiles/sec, through walls, much faster than a chasing ghost. Until it arrives (within 0.08 tiles) it is not a collide target: it cannot be eaten and it cannot kill Pac. After it joins, normal train spacing applies. Followers already in line still glide at 18 tiles/sec, and a hop longer than 1.75 tiles snaps so they do not cut through walls while reforming. The first wake always chooses the closest of the four main ghosts, in tile units, and the sleeper lines up behind that ghost. House, eyes, and frightened do not turn the sleeper into its own leader. On the tunnel row the short wrap is the distance, and a ghost caught mid-wrap is measured on the board.

The whole train copies the leader's mode. While that main ghost is not frightened, every follower — including one that just woke — is opaque and half the size of a normal ghost, colored in a cyan-to-magenta gradient by their place in line. They sit 1 tile behind the ghost ahead, or 0.5 tiles when that ghost is in a side tunnel. They do not kill Pac. When the leader's mode is frightened, every follower is drawn full size in the standard blue frightened look, and a follower who has finished joining can be eaten. A pellet timer on its own does not turn the train blue or make it edible. A leader who is in the house, eyes, or chase keeps the train small and inedible, including a house ghost that is only painted blue and a ghost that left the house lethal because of `skipFright`.

The leader is always one of the four main ghosts. Eating that leader still scores, pauses, and throws a jammer, but the ghost does not turn into eyes. The next train member's body becomes that main ghost: same id, color, and scatter corner, standing where the follower was, still frightened while the pellet lasts. When the pellet ends, that front ghost is the red ghost (or pink, cyan, or orange — whichever was leading). The rest of the train keeps the tiles they were already on. Roles shift up, and the line only starts to follow again once that new leader moves. The eat does not slide or stack them. If the train has no next member, that leader does go home as eyes and respawns through the house. The same eyes trip still happens for a main ghost who is not the train leader. A leader who is eyes, entering, or waiting in the house still owns the train: followers keep lining up on that ghost instead of leading on their own. Eating a follower in the middle removes them; the ghosts behind slide forward into the closed gap (about 18 tiles/sec, and a hop longer than 1.75 tiles snaps into place instead of cutting through walls).

Eating ghosts in a row shortens the freeze:

```
pause(n) = max(0.08s, 0.5s × 0.55^(n-1))
```

`n` is the eat number in the current chain. After 0.75 seconds of active time with no ghost eat, `n` goes back to 1. Time spent inside the eat pause does not count toward those 0.75 seconds.

Each ghost Pac eats, main or train, pops a single bouncing number: how many ghosts have been eaten since the pellet timer last hit zero. A second eat while it is still on screen replaces that same popup and moves it to the new bite. Eating another power pellet while the timer is still running keeps the count, so 2 then a fresh pellet then another ghost shows 3. The count returns to 0 only when the timer fully ends, and the next stretch starts at 1. The hop matches the "Speed Up!" callout and lasts 1.35 seconds.

A main ghost that is eaten and sent home sets `skipFright`. That ghost ignores the pellet already running: they keep their normal colors in the house and come back out in chase or scatter, able to kill Pac while the ring is still draining. A ghost waiting in the house, walking in, or walking out is painted blue while a pellet is active and `skipFright` is clear, but the mode stays house, entering, or leaving, so Pac still cannot eat them there. Eyes stay eyes. The next power pellet clears `skipFright` on every ghost. A ghost still in the house can turn blue on that new pellet without becoming edible, and they come out frightened if that pellet is still active when they leave. Ghosts still on the way home stay eyes. A leader handoff does not set the flag, because that ghost never goes home.

A power pellet's blue time depends on the board: 6, 5, 4, 3, 2, 5, 3, 2, 1, 5, 2, 1.5, 1, 3, 1, 1, 0, 2 seconds on boards 1 through 18. From board 19 on it is 0, except boards 22, 26, 30, 34, and every 4th board after that, which last 2 seconds. Stronger makes that pellet exactly 4 seconds, with no board table and no match-time modifier. Every other mode multiplies the board duration by a modifier that is 1 until 90 seconds of match time, then drops by 0.1 every 30 seconds, and never goes below 0.1. A 0 second board stays 0. A 0 second pellet still reverses ghosts that are chasing or scattering and clears white jammers, but it does not turn them blue or edible. A thick open ring sits on the ghost house, with a clear center so the house stays visible. It starts full and drains to empty over that pellet's duration; it has no digits. Eating any ghost while less than 1.5 seconds remain adds 1.5 seconds, and the ring refills to match the new remaining time.

## Inbound jammers

Opponents sometimes throw jammers onto your maze instead of at each other. Attack strength decides how many sprites that throw tries to spawn (`ceil(strength / 8)`, at most 8). The maze never holds more than 16, counting ones that are still fading in or dying. Anything past 16 is dropped.

They spawn in a quadrant Pac is not standing in and cannot touch Pac until the spawn-in finishes (1.6 seconds). The sprite starts large and pulses up and down, then settles to normal size. Then they chase.

An incoming attack is drawn from that opponent’s side panel to the middle of the ghost house. When it arrives the maze flashes, the screen shakes, particles burst, and only then do the jammers spawn. Outbound jammers are chosen only from opponents who are still alive.

The match clock starts at 0:00 when you take the first step. Red share of each attack after the opening one:

| Elapsed | Red share |
| --- | --- |
| 0:00–1:30 | white only |
| first attack at or after 1:30 | exactly one red, the rest white |
| 1:30–2:00 | 1/12 |
| 2:00–2:30 | 2/12 |
| 2:30–3:00 | 3/12 |
| 3:00–3:30 | 4/12 |
| 3:30–4:00 | 5/12 |
| 4:00–4:30 | 6/12 |
| 4:30–5:00 | 7/12 |
| 5:00–5:30 | 8/12 |
| 5:30–6:00 | 9/12 |
| 6:00–6:30 | 10/12 |
| 6:30–7:00 | 11/12 |
| 7:00+ | red only |

A white jammer dies when it hits Pac and slows Pac to 42% speed. That slow lasts 0.35s at the start and grows by 0.08s every 30s of match time, through 7:00 (14 steps, 1.47s). Whites chase faster than reds. A power pellet destroys every white jammer and freezes every red jammer in place until the pellet wears off. A live red jammer kills Pac when their bodies touch, including a graze, once it has finished fading in. Eating the fruit clears every red jammer off the board. The HUD clock starts at 0:00 on the first step. The jammer count is not shown.

## Layout

```
src/game.ts            composition root (the only place gameplay meets systems)
src/shared/events.ts   event bus and the shared API
src/gameplay/          maze, movement, Pac, ghosts
src/systems/           jammers, simulated opponents, match
src/render/            canvas, 50+50 panels, jammer bolts
```

Gameplay emits facts and does not know about the side boards:

- `dotEaten`
- `powerPelletEaten`
- `ghostEaten` (`strength` is the frightened combo, starting at 1). Train followers do not emit this
- `trainGhostEaten` (a follower in the ghost train; no jammer)
- `sleeperWoken`
- `boardCleared`
- `playerDied`

Systems turn those into outgoing jammers (`jammersSent`), eliminations (`simEliminated`, `playerEliminated`), and the occasional `incomingJammer`. Incoming junk is applied on the composition root through `Board.spawnInbound` — systems never import gameplay.

## Milestone 1

- Playable tile maze with dots, power pellets, walls, and a wrap tunnel
- Ghosts open in scatter, then follow the chase and scatter waves, turn frightened on a power pellet, and can be eaten
- Eaten ghosts send pressure at one simulated opponent; dots and a full clear do not attack
- Opponents die when pressure reaches 100; panels show alive, pressured, busy, and dead
- Each sim attacks on its own 5–15s timer. A shot rolls 1–16 jammers at one random living seat, including you at 1/alive odds, then the match-time cancel ramp may drop or shrink it. Pellet and clear relief pulls their pressure back down
- Match starts at 101 alive, counts down, and offers restart on death or victory

## Known gaps

- The build you can play by default is local. Online is one in-memory room: 16 humans, a 10 second lobby countdown, then CPU bots pad the field to 101 ([docs/networking-n2b.md](docs/networking-n2b.md)). A public match still needs a Render service and a Pages rebuild with `VITE_WS_URL` ([docs/networking-n1.md](docs/networking-n1.md)). Accounts and a ranked ladder are not built. Spectators see the roster, not a remote maze.
- Side boards are status panels, not live mazes or ghost AIs
- Incoming jammers are chasers on your maze. Whites slow Pac; reds kill him. They do not add junk tiles or steal controls
- One life. Blinky speeds up as Cruise Elroy; the other ghosts do not
- Ghost targeting is a simplified chase / scatter / frightened model
- Clearing every pellet leaves the maze empty and does not fire a jammer; eating the fruit reloads the dots and advances the board. Neither ends the match
- Drawn sprites and thin walls; not pixel art
