import type { TokensResponse } from '@oyo/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError, createApiClient } from './client';

const tokens = (n: number): TokensResponse => ({
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}`,
  accessExpiresAt: '',
  refreshExpiresAt: '',
});

const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** A fake API that accepts one access token and one refresh token at a time. */
function setup() {
  let current = tokens(1);
  const server = { access: 'access-1', refresh: 'refresh-1', next: 2 };
  const calls: string[] = [];
  const fetchFake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace('http://api', '');
    const headers = init?.headers as Record<string, string>;
    calls.push(
      `${init?.method} ${path} ${headers.authorization ?? ''} ${headers['x-device-id']}`.trim(),
    );
    if (path === '/auth/refresh') {
      const { refreshToken } = JSON.parse(String(init?.body));
      if (refreshToken !== server.refresh) return json(401, { error: 'invalid_token' });
      const issued = tokens(server.next++);
      server.access = issued.accessToken;
      server.refresh = issued.refreshToken;
      return json(200, issued);
    }
    if (headers.authorization !== `Bearer ${server.access}`)
      return json(401, { error: 'invalid_token' });
    return json(200, { ok: true, path });
  });
  const ended = vi.fn(async () => {});
  const client = createApiClient({
    baseUrl: 'http://api',
    getTokens: () => current,
    getDeviceId: () => 'device-1',
    onTokens: async (t) => void (current = t),
    onSessionEnded: ended,
    fetch: fetchFake as typeof fetch,
  });
  return { client, calls, ended, server, current: () => current };
}

describe('api client', () => {
  it('sends the access token and device id', async () => {
    const { client, calls } = setup();
    await expect(client.get('/me')).resolves.toEqual({ ok: true, path: '/me' });
    expect(calls).toEqual(['GET /me Bearer access-1 device-1']);
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const s = setup();
    s.server.access = 'expired'; // access-1 has expired; refresh-1 is still valid
    await expect(s.client.get('/me')).resolves.toEqual({ ok: true, path: '/me' });
    expect(s.calls).toEqual([
      'GET /me Bearer access-1 device-1',
      'POST /auth/refresh  device-1',
      'GET /me Bearer access-2 device-1',
    ]);
    expect(s.current().refreshToken).toBe('refresh-2');
    expect(s.ended).not.toHaveBeenCalled();
  });

  it('shares one refresh between concurrent 401s', async () => {
    let current = tokens(1);
    let refreshes = 0;
    const fetchFake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url).replace('http://api', '');
      const auth = (init?.headers as Record<string, string>).authorization;
      if (path === '/auth/refresh') {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, tokens(2));
      }
      return auth === 'Bearer access-2'
        ? json(200, { ok: true })
        : json(401, { error: 'invalid_token' });
    });
    const client = createApiClient({
      baseUrl: 'http://api',
      getTokens: () => current,
      getDeviceId: () => 'd',
      onTokens: async (t) => void (current = t),
      onSessionEnded: async () => {},
      fetch: fetchFake as typeof fetch,
    });
    await Promise.all([client.get('/a'), client.get('/b'), client.get('/c')]);
    expect(refreshes).toBe(1);
    expect(current.accessToken).toBe('access-2');
  });

  it('ends the session when the refresh token is rejected', async () => {
    const ended = vi.fn(async () => {});
    const client = createApiClient({
      baseUrl: 'http://api',
      getTokens: () => tokens(1),
      getDeviceId: () => 'd',
      onTokens: async () => {},
      onSessionEnded: ended,
      fetch: (async () => json(401, { error: 'invalid_token' })) as typeof fetch,
    });
    await expect(client.get('/me')).rejects.toMatchObject({ status: 401, code: 'invalid_token' });
    expect(ended).toHaveBeenCalledOnce();
  });

  it('does not refresh for public calls', async () => {
    const fetchFake = vi.fn(async () => json(401, { error: 'invalid_credentials' }));
    const client = createApiClient({
      baseUrl: 'http://api',
      getTokens: () => tokens(1),
      getDeviceId: () => 'd',
      onTokens: async () => {},
      onSessionEnded: async () => {},
      fetch: fetchFake as typeof fetch,
    });
    await expect(
      client.post('/auth/login', { username: 'x' }, { auth: false }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(fetchFake).toHaveBeenCalledOnce();
  });

  it('sends the idempotency key and maps network failures', async () => {
    let seen: Record<string, string> = {};
    const client = createApiClient({
      baseUrl: 'http://api',
      getTokens: () => tokens(1),
      getDeviceId: () => 'd',
      onTokens: async () => {},
      onSessionEnded: async () => {},
      fetch: (async (_url: string, init: RequestInit) => {
        seen = init.headers as Record<string, string>;
        return json(204, null);
      }) as typeof fetch,
    });
    await client.post('/pay', { amount: 1 }, { idempotencyKey: 'key-123456' });
    expect(seen['idempotency-key']).toBe('key-123456');

    const offline = createApiClient({
      baseUrl: 'http://api',
      getTokens: () => null,
      getDeviceId: () => 'd',
      onTokens: async () => {},
      onSessionEnded: async () => {},
      fetch: (async () => {
        throw new TypeError('Network request failed');
      }) as typeof fetch,
    });
    await expect(offline.get('/me')).rejects.toMatchObject({ code: 'network_error', status: 0 });
  });
});
