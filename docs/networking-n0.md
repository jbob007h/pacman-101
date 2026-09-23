# N0 — networking design

This note locks the authority model. N1 is implemented: a two-player jammer loop on a WebSocket server. Local `npm run server` is the dev path. The same process can run on Render so GitHub Pages connects with `wss://`. See [networking-n1.md](networking-n1.md). The default game is still the local 101-sim battle.

The local client is an HTML/TypeScript canvas app. Online play adds a small **authoritative match server**. The first wire protocol is **WebSocket**. There is no peer-to-peer match truth.

## What syncs

Only the **battle layer** moves over the wire:

- who is alive or dead
- pressure (or a pressure band the roster can draw)
- jammer / attack events
- eliminations
- placement and the final rankings

Each player's maze stays **mostly local**: Pac, ghosts, dots, fruit, trains, and the feel of the board are not replicated. The server does not run 101 mazes. A remote opponent is a roster seat, not a second canvas.

That matches the local split already in the code. Gameplay emits facts about your board (`ghostEaten`, `boardCleared`, `playerDied`). Only ghost eats become attacks. Online, the server becomes the systems side for targeting, pressure, elimination, and the winner.

## Authority

**The server picks attack targets.** A client never chooses who gets hit, the final pressure total, elimination order, or the match winner.

Clients send **earn-attack** events only: something they did on their own maze, with a type and a strength. The earn types follow the local attacks:

| Earn type | Local fact | Meaning |
| --- | --- | --- |
| `ghost` | `ghostEaten` / `trainGhostEaten`, batched | Ate one or more frightened ghosts in a 2-second window. Strength is that count. |

Dot milestones and board clears are not attack earns. The server ignores `dots` and `clear`.

Strength is a claim about that local event (how big the eat or clear was). The server may clamp it. The server decides the target list, how much pressure lands, and whether anyone is eliminated.

Bot attacks are the same kind of apply step, but the server generates them. They are not earn-attacks from a client.

## Earn, then apply

1. **Client earns.** The maze resolves locally. The client sends `earnAttack` with type and strength. It does not include a target id.
2. **Server validates.** Rate limits and basic rules (the match is in play, this seat is alive, the type is `ghost`, strength is in range). `dots` and `clear` are not applied.
3. **Server picks and applies.** Living seats are chosen uniformly at random. No pressure bias. The server adds pressure, decides jammer intent for the victim, and may mark eliminations.
4. **Server broadcasts.** Other seats get a `rosterDelta`. The victim also gets `jammerInbound` (who it came from, strength, and enough to spawn the local inbound jammer).
5. **Victim plays it locally.** The inbound jammer is a local maze object, same as today. If it kills Pac, the client sends `deathReport`. The server confirms with `playerEliminated` and the locked place. A client death report that the server did not confirm does not change the roster.

CPU-versus-CPU attacks skip step 1. The server runs them on its clock and still broadcasts `rosterDelta` / `jammerInbound`.

## Opponent view

The roster is about 100 seats, the same spirit as the side panels:

- alive or out
- pressure band (enough to fill the red bar)
- flash / busy (hit, attacking, relief)
- name

Not a remote maze, not ghost positions, not dots.

## Bots

The server pads the match to 101 with **pressure-sim fillers**. They reuse the local sim mindset: pressure, a slow attack clock, relief, no maze AI. Bot attacks are server-side. Humans and bots share one seat list, so a uniform pick can land on either.

Local bot attacks wait `SIM_ATTACK_GRACE` (10 seconds) after the match clock starts. Server-driven bot attacks should respect a similar grace. Dot and clear earns are not delayed. Ghost eats batch for 2 seconds, then one earn goes out, matching local play.

## Anti-trust

Clients are not trusted for win, death, or pressure totals.

- Target choice, applied pressure, elimination order, placement, and the winner are server state.
- `deathReport` is a claim. `playerEliminated` is the confirmation. Placement is whatever the server locked (`place = survivors + 1`, same rule as the local standings).
- The last confirmed living seat wins. The client shows the congratulations card, then the rankings, from `matchEnd`. It does not decide that it won.

## Match flow

1. **Lobby / name.** `join` with a display name. The server assigns a seat.
2. **Fill.** Humans ready in. Server-side bots pad the field to 101.
3. **Countdown.** `matchStart` carries the shared clock. Each client runs its own maze from then on.
4. **Grace.** Bot attacks stay quiet for the opening grace. Earn-attacks may be sent immediately.
5. **Play.** Earn → validate → pick → apply → roster delta and inbound jammer, until one seat is left.
6. **End.** `matchEnd` names the winner and the locked placements. The client shows **Congratulations!**, then one click (or Space / Enter) opens the rankings. That screen already exists locally; online it renders the server's placements instead of the local ranking set.

## Messages

Names and purpose only. Not a schema.

| Message | Direction | Purpose |
| --- | --- | --- |
| `join` | client → server | Enter the lobby with a display name. |
| `ready` | client → server | This human is ready to start. |
| `lobby` | server → client | Seat list so far: who is human, who is a bot, who is ready, when the fill hits 101. |
| `matchStart` | server → client | Countdown is armed. Includes seat id, roster snapshot, and the grace deadline. |
| `earnAttack` | client → server | Local earn. Type (`ghost`, `dots`, `clear`) and strength. No target. |
| `jammerInbound` | server → client | This seat is the victim. Spawn the local inbound jammer. |
| `rosterDelta` | server → client | Thin seat updates: pressure band, alive, flash/busy, name if it changed. |
| `deathReport` | client → server | "My maze died." A claim, not an elimination. |
| `playerEliminated` | server → client | Server confirmed a death and locked that seat's place. |
| `matchEnd` | server → client | Winner, final placements, and that the match is over. |
| `ping` | both | Clock and liveness. Not gameplay authority. |

`rosterDelta` is a patch. A full `lobby` or the snapshot inside `matchStart` is the baseline. N4 can add an explicit resync if a delta is missed.

## Phases

| Phase | What it is |
| --- | --- |
| **N0** | This note. Message sketch, authority, non-goals. |
| **N1** | **Implemented.** Two-player jammer loop. See [networking-n1.md](networking-n1.md). |
| **N2** | Lobby, bot fill to 101, and roster sync for the side panels. |
| **N3** | Full match end online: server `matchEnd`, then the local congratulations screen, then rankings from server placements. |
| **N4** | Reconnect, late-join rules, and stronger validation than the N1 rate limits. |

## Non-goals (N0 and N1)

- No peer-to-peer match truth. Clients do not agree the winner among themselves.
- No streaming of opponent mazes, ghost paths, or dot maps.
- No client-side target picking. `earnAttack` does not carry a target.
- No accounts, ranked ladder, or persistence beyond one match.
- N1 does not need 101 seats, bots, reconnect, or the congratulations flow on the wire. Those wait for N2 and N3.
