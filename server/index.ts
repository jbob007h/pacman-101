import { WebSocketServer, type WebSocket } from 'ws';
import { DEFAULT_PORT } from '../src/net/protocol';
import { MatchRoom, type SeatLink } from './match';

export interface MatchServer {
  port: number;
  close(): Promise<void>;
}

/** One room on `ws://localhost:<port>`. `port` 0 asks the OS for a free port. */
export function startMatchServer(port = DEFAULT_PORT): Promise<MatchServer> {
  const room = new MatchRoom();
  const wss = new WebSocketServer({ port, host: '0.0.0.0' });

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
    wss.once('error', reject);
    wss.once('listening', () => {
      const address = wss.address();
      const bound = typeof address === 'object' && address ? address.port : port;
      resolve({
        port: bound,
        close: () =>
          new Promise((done, fail) => {
            wss.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
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
