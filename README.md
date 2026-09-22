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

Clearing the maze refills the dots, bumps the Board counter, and speeds the next maze up. Board 1 is the slow pace. The ramp caps at board 6.

Tiles per second:

| Board | Pac | Ghost chase | Frightened |
| --- | --- | --- | --- |
| 1 | 6.4 | 4.5 | 2.05 |
| 2 | 7.15 | 5.35 | 2.35 |
| 3 | 7.9 | 6.25 | 2.7 |
| 4 | 8.65 | 7.15 | 3.05 |
| 5 | 9.35 | 8.05 | 3.4 |
| 6+ | 10.0 | 8.9 | 3.75 |

On board 1 the ghosts are well slower than Pac. Frightened ghosts stay under half of that board's chase speed, so a power pellet is a real opening. Later boards raise both speeds; chase closes on Pac, but a pellet still drops the ghosts to a crawl. An incoming jammer speeds chase ghosts only, not frightened ones.

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

Systems turn those into outgoing jammers (`jammersSent`), eliminations (`simEliminated`, `playerEliminated`), and the occasional `incomingJammer`. Incoming junk is applied on the composition root through `Board.applyIncomingJammer` — systems never import gameplay.

## Milestone 1

- Playable tile maze with dots, power pellets, walls, and a wrap tunnel
- Ghosts chase (with a short scatter cycle), turn frightened on a power pellet, and can be eaten
- Eaten ghosts and dot milestones send pressure at simulated opponents; a full clear hits several at once
- Opponents die when pressure reaches 100; panels show alive, pressured, busy, and dead
- Sims also lean on each other, and sometimes speed up your ghosts for a few seconds
- Match starts at 101 alive, counts down, and offers restart on death or victory

## Known gaps

- Local only: no networking, accounts, or ranked play
- Side boards are status panels, not live mazes or ghost AIs
- Incoming jammers only make your ghosts faster — no junk items, slow tiles, or stolen controls
- One life, no sound, no fruit, no Elroy speed curve, no tunnel slowdown
- Ghost targeting is a simplified chase / scatter / frightened model
- Clearing the board refills it and fires a wide jammer; it does not end the match
- Placeholder colors, not pixel art
