import type { AttackKind, ClientMessage, RosterSeat, ServerMessage } from './protocol';

export interface SessionHandlers {
  onNote(text: string): void;
  onLobby(message: Extract<ServerMessage, { type: 'lobby' }>): void;
  onSpectate(message: Extract<ServerMessage, { type: 'spectate' }>): void;
  onMatchStart(message: Extract<ServerMessage, { type: 'matchStart' }>): void;
  onJammer(message: Extract<ServerMessage, { type: 'jammerInbound' }>): void;
  onRoster(message: Extract<ServerMessage, { type: 'rosterDelta' }>): void;
  onEliminated(message: Extract<ServerMessage, { type: 'playerEliminated' }>): void;
  onMatchEnd(message: Extract<ServerMessage, { type: 'matchEnd' }>): void;
}

/**
 * Browser socket for one seat. Offline play never constructs a connection.
 * The client sends earns and death claims. It does not pick targets.
 */
export class NetSession {
  seat = 0;
  /** Roster-only viewer. Cannot earn or report a death. */
  spectating = false;
  phase: 'idle' | 'connecting' | 'lobby' | 'spectating' | 'playing' | 'done' = 'idle';
  private socket: WebSocket | null = null;
  private url = '';
  private name = 'Pac';
  private readied = false;
  private generation = 0;
  private intentional = false;
  private failed = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly handlers: SessionHandlers) {}

  get active(): boolean {
    return this.phase !== 'idle';
  }

  /** True after this seat has sent `ready` for the current lobby. */
  get hasReadied(): boolean {
    return this.readied;
  }

  connect(url: string, name: string): void {
    this.stop();
    this.intentional = false;
    this.failed = false;
    this.readied = false;
    this.spectating = false;
    this.seat = 0;
    this.url = url;
    this.name = name;
    this.phase = 'connecting';
    const generation = this.generation;
    this.handlers.onNote(`Connecting to ${url}…`);
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.fail(generation, connectionFailureNote(url));
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (generation !== this.generation) return;
      this.send({ type: 'join', name: this.name });
      this.pingTimer = setInterval(() => {
        if (generation !== this.generation) return;
        this.send({ type: 'ping' });
      }, 5000);
    });
    socket.addEventListener('message', (event) => {
      if (generation !== this.generation) return;
      if (typeof event.data !== 'string') return;
      this.onRaw(event.data);
    });
    socket.addEventListener('error', () => {
      if (this.phase !== 'connecting') return;
      this.fail(generation, connectionFailureNote(this.url));
    });
    socket.addEventListener('close', () => {
      if (generation !== this.generation || this.intentional || this.failed) return;
      this.phase = 'idle';
      this.handlers.onNote('Disconnected from the match server.');
    });
  }

  rejoin(): void {
    if (!this.url) return;
    this.connect(this.url, this.name);
  }

  /** Lobby only. A solo human starting alone is a legal ready. */
  sendReady(): void {
    if (this.spectating || this.phase !== 'lobby' || this.readied) return;
    this.readied = true;
    this.send({ type: 'ready' });
  }

  sendEarn(attack: AttackKind, strength: number): void {
    if (this.spectating || this.phase !== 'playing') return;
    this.send({ type: 'earnAttack', attack, strength });
  }

  sendDeath(): void {
    if (this.spectating || this.phase !== 'playing') return;
    this.send({ type: 'deathReport' });
  }

  stop(): void {
    this.generation += 1;
    this.intentional = true;
    this.spectating = false;
    this.phase = 'idle';
    if (this.pingTimer != null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }

  private fail(generation: number, text: string): void {
    if (generation !== this.generation) return;
    this.failed = true;
    this.spectating = false;
    this.phase = 'idle';
    this.handlers.onNote(text);
    this.socket?.close();
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private onRaw(data: string): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }
    if (message.type === 'ping') return;
    if (message.type === 'error') {
      this.intentional = true;
      this.spectating = false;
      this.phase = 'idle';
      this.handlers.onNote(message.text);
      return;
    }
    if (message.type === 'lobby') {
      this.spectating = false;
      this.seat = message.you;
      this.phase = 'lobby';
      this.handlers.onNote(describeLobby(message.seats, message.need, message.countdownMs));
      this.handlers.onLobby(message);
      return;
    }
    if (message.type === 'spectate') {
      this.spectating = true;
      this.seat = 0;
      this.phase = 'spectating';
      this.readied = false;
      this.handlers.onNote('Spectating this match. No maze view.');
      this.handlers.onSpectate(message);
      return;
    }
    if (message.type === 'matchStart') {
      this.seat = message.you;
      this.phase = 'playing';
      this.handlers.onNote('');
      this.handlers.onMatchStart(message);
      return;
    }
    if (message.type === 'jammerInbound') {
      this.handlers.onJammer(message);
      return;
    }
    if (message.type === 'rosterDelta') {
      this.handlers.onRoster(message);
      return;
    }
    if (message.type === 'playerEliminated') {
      this.handlers.onEliminated(message);
      return;
    }
    if (message.type === 'matchEnd') {
      this.readied = false;
      if (!this.spectating) this.phase = 'done';
      this.handlers.onMatchEnd(message);
    }
  }
}

/** Title-screen line while humans are still joining. Bots are not in the lobby yet. */
export function describeLobby(seats: readonly RosterSeat[], roomSize: number, countdownMs: number | null = null): string {
  const humans = seats.filter((seat) => !seat.bot);
  const ready = humans.filter((seat) => seat.ready).length;
  const names = humans.map((seat) => `${seat.name}${seat.ready ? ' (ready)' : ''}`).join(', ');
  const who = names.length > 0 ? names : 'Nobody yet';
  if (countdownMs == null) {
    return `${who}. ${ready} of ${humans.length} ready. The first Ready starts a 10s countdown, then empty seats fill to ${roomSize}.`;
  }
  const secs = Math.max(0, Math.ceil(countdownMs / 1000));
  return `${who}. Starting in ${secs}s. Empty seats fill to ${roomSize}.`;
}

function connectionFailureNote(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      return 'Could not connect. Start the server with npm run server.';
    }
  } catch {
    // A bad ?ws= value still needs a visible failure.
  }
  return 'Could not connect. A free Render server sleeps after idle time and can take a minute to wake. Try Online again.';
}
