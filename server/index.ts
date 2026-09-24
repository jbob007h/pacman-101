import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { DEFAULT_PORT } from '../src/net/protocol';
import { MatchRoom, type SeatLink } from './match';

export interface MatchServer {
  port: number;
  close(): Promise<void>;
}

export interface MatchServerOptions {
  /** Override the lobby wait. Production uses {@link LOBBY_COUNTDOWN_MS}. */
  countdownMs?: number;
  now?: () => number;
  rng?: () => number;
}

/**
 * One room, bound on `0.0.0.0`. `port` 0 asks the OS for a free port.
 * Plain HTTP (including GET /) returns 200 so a host health check can pass.
 * WebSocket upgrades on the same port are the match.
 */
export function startMatchServer(port = DEFAULT_PORT, options: MatchServerOptions = {}): Promise<MatchServer> {
  const room = new MatchRoom(options.now, options.rng, options.countdownMs);
  const httpServer = createServer(answerHttp);
  const wss = new WebSocketServer({ server: httpServer });
  const timer = setInterval(() => room.tick(), 100);

  wss.on('connection', (socket) => {
    let joined = false;
    const link: SeatLink = {
      send(message) {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      },
    };
    socket.on('message', (data) => {
      const raw = parseRaw(data);
      if (!raw) return;
      if (!joined) {
        if (raw.type !== 'join') return;
        const result = room.join(link, raw.name);
        if (!result.ok) {
          link.send({ type: 'error', text: result.text });
          socket.close();
          return;
        }
        joined = true;
        return;
      }
      room.onMessage(link, raw);
    });
    socket.on('close', () => {
      if (joined) room.disconnect(link);
    });
  });

  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    httpServer.once('error', onError);
    httpServer.listen(port, '0.0.0.0', () => {
      httpServer.off('error', onError);
      const address = httpServer.address();
      const bound = typeof address === 'object' && address ? address.port : port;
      resolve({
        port: bound,
        close: () =>
          new Promise((done, fail) => {
            clearInterval(timer);
            for (const client of wss.clients) client.terminate();
            wss.close();
            httpServer.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}

function answerHttp(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end('101 match server\n');
}

function parseRaw(data: WebSocket.RawData): { type?: unknown; name?: unknown } | null {
  try {
    const parsed: unknown = JSON.parse(data.toString());
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as { type?: unknown; name?: unknown };
  } catch {
    return null;
  }
}
