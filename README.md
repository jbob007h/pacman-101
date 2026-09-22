# 101

Local battle maze inspired by Pac-Man 99. You play the center board. One hundred simulated opponents sit on mini-boards — fifty on the left, fifty on the right. Eating a frightened ghost (or clearing dots) throws jammers at them. Stack enough pressure and they are eliminated. Last one standing wins.

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

- `npm test` — maze, movement, and jammer tests
- `npm run typecheck`
- `npm run build` — typecheck and production bundle
- `npm run preview` — serve the production bundle

## Controls

- The game opens on a title screen. Start match, Enter, or Space begins a match. Arrow keys do nothing until then.
- The match then counts Ready…, 3…, 2…, 1…, Hit it! Each beat is 60 simulation frames, one second at the locked 60Hz step. Pac stays put, and arrows are ignored, until Hit it! On that beat he moves left (the way he is facing) on his own. Arrows and WASD work after that. Reversing is instant; other turns happen at intersections. Each beat plays a short generated blip, and Hit it! plays a brighter go cue.
- Eat the large dots to frighten ghosts, then run into them to send jammers. Dot eats alternate a higher and a lower wakawaka tone.
- `R` or Restart starts a new match. On the title screen, Restart starts the match. The restart prompt also shows when you die or win.
- Sound is generated in the browser (no sound files). `M`, or the Sound button on the title screen and in the header, mutes it. The choice is remembered in this browser. The button reads Muted while sound is off.
- Eating a frightened ghost freezes the maze for half a second, then play resumes.
- Eating a normal dot stops Pac for 1 simulation frame. A power pellet stops him for 3. Ghosts and jammers keep moving. The maze steps at a fixed 60Hz; the canvas can still draw on the display refresh, and a stalled tab catches up at most 5 frames.

Side panels: a number is an opponent, red fill is pressure, a gold border means they are attacking, a white flash is a fresh hit, and an X means they are out. The Alive counter starts at 101 and includes you.

Walls next to a corridor are drawn as half a tile on the blocked side so the lanes look thin; the collision grid is unchanged. Pac, ghosts, and jammers are drawn at 2× size, still centered on their tile, so they can overhang those half-walls.

## Board speed

Eating the fruit under the ghost house refills the maze, bumps the Board counter, and speeds the next maze up. Board 1 is the slow pace. The ramp caps at board 6. Eating every pellet does not advance the board and does not reload dots: the maze stays empty, a wide jammer still goes out, and Pac keeps a small permanent movement bonus (0.35 tiles/sec per clear, stacking for the rest of the match). Dots come back only when the fruit is eaten.

The Speed readout starts at 0. It goes up by 1 every time the board is cleared of pellets. It also goes up by 1 when fruit advances you off an even board (2, 4, 6, …). The 0.35 tiles/sec bonus is separate from that number.

Fruit appears once half the pellets are eaten. That half is `ceil(total / 2)` of the dots plus power pellets on the board at the start of the current fill (the spawn tile is already gone, and fruit itself does not count). After the house-ring strip, the first fill has 251 of those (248 dots and 4 power pellets, minus the spawn tile), so the fruit appears after 126 pellets. Later fills restore the spawn dot, so that set is 252 and the half is 126 as well. It sits on the tile in the middle of the corridor under the ghost house, column 14, row 17. Clearing the board does not remove a fruit that is already waiting, and it does not start another fruit cycle. The next fruit waits until that fruit is eaten and the next fill begins.

The side tunnels (the wrap row outside the ghost house) have no pellets. The rectangle of corridors wrapped around the ghost house — columns 9–18, rows 11–17 — has no dots or power pellets either. Ghosts in chase, scatter, or frightened mode move at 55% speed while they are in those tunnels. Pac does not slow down there, and eaten ghost eyes stay fast.

Tiles per second, before the clear bonus:

| Board | Pac | Ghost chase | Frightened |
| --- | --- | --- | --- |
| 1 | 6.4 | 4.5 | 2.05 |
| 2 | 7.15 | 5.35 | 2.35 |
| 3 | 7.9 | 6.25 | 2.7 |
| 4 | 8.65 | 7.15 | 3.05 |
| 5 | 9.35 | 8.05 | 3.4 |
| 6+ | 10.0 | 8.9 | 3.75 |

On board 1 the ghosts are well slower than Pac. Frightened ghosts stay under half of that board's chase speed, so a power pellet is a real opening. Later boards raise both speeds; chase closes on Pac, but a pellet still drops the ghosts to a crawl. Each full clear adds 0.35 to Pac's tiles/sec on top of the row above, and adds 1 to the Speed readout.

## Cruise Elroy

When few pellets are left, the red ghost (Blinky) becomes Cruise Elroy. Elroy 1 moves at Pac's current unslowed pace. Elroy 2 moves at 1.1× that pace. While either stage is on, Blinky chases Pac's tile even during scatter. Frightened Blinky, the other ghosts, and eyes keep their normal speeds. Eating the fruit refills the pellets, so Elroy turns off until the new board is eaten down again.

Pellets remaining (dots plus power pellets):

| Board | Elroy 1 | Elroy 2 |
| --- | --- | --- |
| 1 | 20 | 10 |
| 2 | 30 | 15 |
| 3 | 40 | 20 |
| 4 | 50 | 20 |
| 5+ | 60 | 20 |

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

A white jammer dies when it hits Pac and slows Pac to 42% speed. That slow lasts 0.6s at the start and grows by 0.12s every 30s of match time, through 7:00. Whites chase faster than reds. A power pellet destroys every white jammer and freezes every red jammer in place until the pellet wears off. A live red jammer kills Pac when their bodies touch, including a graze, once it has finished fading in. Eating the fruit clears every red jammer off the board. The HUD clock starts at 0:00 on the first step. The jammer count is not shown.

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
- `ghostEaten` (`strength` is the frightened combo, starting at 1)
- `boardCleared`
- `playerDied`

Systems turn those into outgoing jammers (`jammersSent`), eliminations (`simEliminated`, `playerEliminated`), and the occasional `incomingJammer`. Incoming junk is applied on the composition root through `Board.spawnInbound` — systems never import gameplay.

## Milestone 1

- Playable tile maze with dots, power pellets, walls, and a wrap tunnel
- Ghosts chase (with a short scatter cycle), turn frightened on a power pellet, and can be eaten
- Eaten ghosts and dot milestones send pressure at simulated opponents; a full clear hits several at once
- Opponents die when pressure reaches 100; panels show alive, pressured, busy, and dead
- Sims also lean on each other, and sometimes throw white or red jammers onto your maze
- Match starts at 101 alive, counts down, and offers restart on death or victory

## Known gaps

- Local only: no networking, accounts, or ranked play
- Side boards are status panels, not live mazes or ghost AIs
- Incoming jammers are chasers on your maze. Whites slow Pac; reds kill him. They do not add junk tiles or steal controls
- One life. Blinky speeds up as Cruise Elroy; the other ghosts do not
- Ghost targeting is a simplified chase / scatter / frightened model
- Clearing every pellet leaves the maze empty and fires a wide jammer; eating the fruit reloads the dots and advances the board. Neither ends the match
- Drawn sprites and thin walls; not pixel art
