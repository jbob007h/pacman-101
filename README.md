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

- Arrow keys or WASD to move. The maze waits until the first key. Reversing is instant; other turns happen at intersections.
- Eat the large dots to frighten ghosts, then run into them to send jammers.
- `R` or Restart starts a new match. The restart prompt also shows when you die or win.
- Eating a frightened ghost freezes the maze for half a second, then play resumes.

Side panels: a number is an opponent, red fill is pressure, a gold border means they are attacking, a white flash is a fresh hit, and an X means they are out. The Alive counter starts at 101 and includes you.

## Board speed

Eating the fruit under the ghost house refills the maze, bumps the Board counter, and speeds the next maze up. Board 1 is the slow pace. The ramp caps at board 6. Eating every pellet does not advance the board: the maze refills, a wide jammer still goes out, and Pac keeps a small permanent movement bonus (0.35 tiles/sec per clear, stacking for the rest of the match). That bonus is not part of the on-screen Speed number.

The Speed readout starts at 0. It goes up by 1 only when fruit advances you off an even board (2, 4, 6, …). Leaving board 1, 3, or 5 does not change it.

Fruit appears once half the pellets are eaten. That half is `ceil(total / 2)` of the dots plus power pellets on the board at the start of the current fill (the spawn tile is already gone, and fruit itself does not count). It sits on the tile in the middle of the corridor under the ghost house, column 14, row 17. A second clear before you take the fruit stacks the movement bonus and does not spawn another fruit.

The side tunnels (the wrap row outside the ghost house) have no pellets. Ghosts in chase, scatter, or frightened mode move at 55% speed while they are in those tunnels. Pac does not slow down there, and eaten ghost eyes stay fast.

Tiles per second, before the clear bonus:

| Board | Pac | Ghost chase | Frightened |
| --- | --- | --- | --- |
| 1 | 6.4 | 4.5 | 2.05 |
| 2 | 7.15 | 5.35 | 2.35 |
| 3 | 7.9 | 6.25 | 2.7 |
| 4 | 8.65 | 7.15 | 3.05 |
| 5 | 9.35 | 8.05 | 3.4 |
| 6+ | 10.0 | 8.9 | 3.75 |

On board 1 the ghosts are well slower than Pac. Frightened ghosts stay under half of that board's chase speed, so a power pellet is a real opening. Later boards raise both speeds; chase closes on Pac, but a pellet still drops the ghosts to a crawl. Each full clear adds 0.35 to Pac's tiles/sec on top of the row above.

## Inbound jammers

Opponents sometimes throw jammers onto your maze instead of at each other. Attack strength decides how many sprites that throw tries to spawn (`ceil(strength / 8)`, at most 8). The maze never holds more than 16, counting ones that are still fading in or dying. Anything past 16 is dropped.

They spawn in a quadrant Pac is not standing in, scale up, and cannot touch Pac until that fade-in finishes. Then they chase.

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

A white jammer dies when it hits Pac and slows Pac to 42% speed. That slow lasts 1.2s at the start and grows by 0.25s every 30s of match time, through 7:00. A power pellet destroys every white jammer. A red jammer kills Pac on contact once it has finished fading in. During a power pellet the reds freeze in place and do not die. Eating the fruit clears every red jammer off the board.

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
- Incoming jammers are chasers on your maze. They slow Pac; they do not add junk tiles or steal controls
- One life, no sound, no Elroy speed curve
- Ghost targeting is a simplified chase / scatter / frightened model
- Clearing every pellet refills the maze and fires a wide jammer; eating the fruit is what advances the board. Neither ends the match
- Placeholder colors, not pixel art
