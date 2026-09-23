import { describe, expect, it } from 'vitest';
import { DEFAULT_WS_URL } from '../src/net/protocol';
import { INSECURE_SOCKET_URL, MISSING_SOCKET_URL, resolveSocketUrl } from '../src/net/socketUrl';

describe('resolveSocketUrl', () => {
  it('lets ?ws= win in dev and in production', () => {
    expect(resolveSocketUrl({ query: 'wss://override.example/match', dev: true, configured: undefined })).toEqual({
      ok: true,
      url: 'wss://override.example/match',
    });
    expect(
      resolveSocketUrl({
        query: '  ws://127.0.0.1:9999  ',
        dev: false,
        configured: 'wss://built.example',
      }),
    ).toEqual({ ok: true, url: 'ws://127.0.0.1:9999' });
  });

  it('uses localhost only while developing', () => {
    const resolved = resolveSocketUrl({
      query: null,
      dev: true,
      configured: 'wss://should-not-win.example',
    });
    expect(resolved).toEqual({ ok: true, url: DEFAULT_WS_URL });
    expect(DEFAULT_WS_URL).toBe('ws://localhost:8787');
  });

  it('uses a production wss URL when one was baked in', () => {
    expect(
      resolveSocketUrl({
        query: '',
        dev: false,
        configured: '  wss://your-service.onrender.com  ',
      }),
    ).toEqual({ ok: true, url: 'wss://your-service.onrender.com' });
  });

  it('refuses a production build that has no match URL', () => {
    for (const configured of [undefined, '', '   ']) {
      const resolved = resolveSocketUrl({ query: null, dev: false, configured });
      expect(resolved.ok).toBe(false);
      if (resolved.ok) return;
      expect(resolved.reason).toBe(MISSING_SOCKET_URL);
      expect(resolved.reason).not.toContain('localhost');
      expect(JSON.stringify(resolved)).not.toContain(DEFAULT_WS_URL);
    }
  });

  it('rejects a production ws:// host that is not loopback', () => {
    const resolved = resolveSocketUrl({
      query: null,
      dev: false,
      configured: 'ws://example.com:8787',
    });
    expect(resolved).toEqual({ ok: false, reason: INSECURE_SOCKET_URL });
  });

  it('allows a loopback ws:// URL in a production preview', () => {
    expect(resolveSocketUrl({ query: null, dev: false, configured: 'ws://localhost:8787' })).toEqual({
      ok: true,
      url: 'ws://localhost:8787',
    });
    expect(resolveSocketUrl({ query: null, dev: false, configured: 'ws://127.0.0.1:8787' })).toEqual({
      ok: true,
      url: 'ws://127.0.0.1:8787',
    });
  });
});
