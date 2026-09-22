import { Board } from './gameplay/board';
import { drawFrame, type DrawInput } from './render/draw';
import { BoltField } from './render/fx';
import { boardRect, panelCenter } from './render/layout';
import type { Dir } from './shared/types';
import { EventBus } from './shared/events';
import type { JamReason } from './shared/events';
import type { Rng } from './shared/rng';
import { Match, type MatchPhase } from './systems/match';
import { SimWorld } from './systems/sims';

export interface HudState {
  score: number;
  remaining: number;
  phase: MatchPhase;
  status: string;
  overlay: { title: string; body: string } | null;
}

/**
 * Composition root. Gameplay and systems only meet here (and on the event bus).
 */
export class Game {
  readonly bus = new EventBus();
  readonly board: Board;
  readonly sims: SimWorld;
  readonly match: Match;
  private readonly fx = new BoltField();
  private banner = '';
  private bannerT = 0;
  elapsed = 0;

  constructor(rng: Rng = Math.random) {
    this.board = new Board(this.bus, rng);
    this.sims = new SimWorld(this.bus, rng);
    this.match = new Match(this.bus, this.sims);
    this.bus.on('jammersSent', (event) => {
      if (event.reason === 'sim') return;
      const board = boardRect();
      const origin = { x: board.x + board.w / 2, y: board.y + board.h / 2 };
      this.fx.launch(
        origin,
        event.targets.map((id) => panelCenter(id)),
      );
      this.setBanner(`${reasonLabel(event.reason)} ${event.strength} → ${formatTargets(event.targets)}`);
    });
    this.bus.on('simEliminated', (event) => {
      this.setBanner(`Eliminated #${event.simId}`);
    });
    this.bus.on('incomingJammer', (event) => {
      this.board.applyIncomingJammer(event.strength);
      this.setBanner(`Incoming jammer from #${event.fromSimId}`);
    });
  }

  setDirection(dir: Dir | null): void {
    if (this.match.phase !== 'playing') return;
    this.board.setDirection(dir);
  }

  update(dt: number): void {
    const step = Math.min(0.05, Math.max(0, dt));
    this.elapsed += step;
    if (this.bannerT > 0) this.bannerT = Math.max(0, this.bannerT - step);
    if (this.match.phase !== 'won') this.board.update(step);
    const started = this.board.pac.dir.x !== 0 || this.board.pac.dir.y !== 0;
    if (this.match.phase === 'playing' && started) this.sims.update(step);
    this.fx.update(step);
  }

  restart(): void {
    this.board.reset();
    this.sims.reset();
    this.match.reset();
    this.fx.clear();
    this.banner = '';
    this.bannerT = 0;
    this.elapsed = 0;
  }

  hud(): HudState {
    const phase = this.match.phase;
    return {
      score: this.board.score,
      remaining: this.match.remaining(),
      phase,
      status: this.statusLine(),
      overlay: this.overlay(),
    };
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const input: DrawInput = {
      maze: this.board.maze,
      pac: this.board.pac,
      ghosts: this.board.ghosts,
      sims: this.sims.sims,
      bolts: this.fx.bolts,
      incoming: this.board.incoming,
      frightened: this.board.frightened,
      deathTime: this.board.deathTime,
      time: this.elapsed,
    };
    drawFrame(ctx, input);
  }

  private statusLine(): string {
    if (this.bannerT > 0) return this.banner;
    if (this.match.phase === 'playing' && this.board.pac.dir.x === 0 && this.board.pac.dir.y === 0) {
      return 'Press an arrow key or WASD to start';
    }
    if (this.match.phase === 'won') return 'You are the last one standing';
    if (this.match.phase === 'lost') return 'Eliminated';
    if (this.board.incoming > 0) return 'Jammed — ghosts are faster';
    if (this.board.frightened > 0) return 'Ghosts are frightened — eat them to jam opponents';
    return 'Large dots frighten ghosts. Eating them sends jammers sideways.';
  }

  private overlay(): HudState['overlay'] {
    if (this.match.phase === 'won') {
      return {
        title: 'You win',
        body: `Last player standing. Score ${this.board.score}.`,
      };
    }
    if (this.match.phase === 'lost' && this.board.deathTime > 0.85) {
      return {
        title: 'Eliminated',
        body: `${this.sims.aliveCount()} opponents remain. Score ${this.board.score}.`,
      };
    }
    return null;
  }

  private setBanner(text: string): void {
    this.banner = text;
    this.bannerT = 2.2;
  }
}

function reasonLabel(reason: JamReason): string {
  switch (reason) {
    case 'ghost':
      return 'Ghost jam';
    case 'dots':
      return 'Dot pressure';
    case 'clear':
      return 'Board clear';
    case 'sim':
      return 'Sim jam';
    default:
      return 'Jam';
  }
}

function formatTargets(ids: readonly number[]): string {
  const shown = ids
    .slice(0, 4)
    .map((id) => `#${id}`)
    .join(' ');
  return ids.length > 4 ? `${shown} +${ids.length - 4}` : shown;
}
