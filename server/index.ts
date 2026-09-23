import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { DEFAULT_PORT } from '../src/net/protocol';
import { MatchRoom, type SeatLink } from './match';

export interface MatchServer {
  port: number;
  close(): Promise<void>;
}

/**
 * One room, bound on `0.0.0.0`. `port` 0 asks the OS for a free port.
 * Plain HTTP (including GET /) returns 200 so a host health check can pass.
 * WebSocket upgrades on the same port are the match.
 */
export function startMatchServer(port = DEFAULT_PORT): Promise<MatchServer> {
  const room = new MatchRoom();
  const httpServer = createServer(answerHttp);
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (socket) => {
    let seat: number | null = null;
    const link: SeatLink = {
      send(message) {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      },
    };
    socket.on('message', (data) => {
      const raw = parseRaw(data);
      if (!raw) return;
      if (seat == null) {
        if (raw.type !== 'join') return;
        const joined = room.join(link, raw.name);
        if (!joined.ok) {
          link.send({ type: 'error', text: joined.text });
          socket.close();
          return;
        }
        seat = joined.seat;
        return;
      }
      room.handle(seat, raw);
    });
    socket.on('close', () => {
      if (seat != null) room.leave(seat);
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
