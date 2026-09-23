import { DEFAULT_WS_URL } from './protocol';

export interface SocketUrlInput {
  /** `?ws=` value, or null when the query is absent. */
  query: string | null;
  /** `import.meta.env.DEV`. True for `npm run dev`. */
  dev: boolean;
  /** `import.meta.env.VITE_WS_URL`, inlined at build time. */
  configured: string | undefined;
}

export type SocketUrlResult = { ok: true; url: string } | { ok: false; reason: string };

export const MISSING_SOCKET_URL =
  'No match server in this build. Set VITE_WS_URL to a wss:// address and redeploy, or open this page with ?ws=wss://…';

export const INSECURE_SOCKET_URL =
  'The match URL in this build must start with wss://. An HTTPS page cannot open ws://. Set VITE_WS_URL and redeploy.';

/**
 * Pick the match socket.
 * `?ws=` wins. Dev uses localhost. A production build uses `VITE_WS_URL` when it is `wss://`
 * (or a loopback `ws://` for a local preview). With no production URL, this returns a reason
 * and does not fall back to localhost.
 */
export function resolveSocketUrl(input: SocketUrlInput): SocketUrlResult {
  const query = input.query?.trim() ?? '';
  if (query.length > 0) return { ok: true, url: query };

  if (input.dev) return { ok: true, url: DEFAULT_WS_URL };

  const configured = typeof input.configured === 'string' ? input.configured.trim() : '';
  if (configured.length === 0) return { ok: false, reason: MISSING_SOCKET_URL };
  if (isAllowedProductionUrl(configured)) return { ok: true, url: configured };
  return { ok: false, reason: INSECURE_SOCKET_URL };
}

function isAllowedProductionUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'wss:') return parsed.hostname.length > 0;
  if (parsed.protocol !== 'ws:') return false;
  return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
}
