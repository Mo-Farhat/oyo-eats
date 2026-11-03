import type { ApiErrorBody, TokensResponse } from '@oyo/shared';

/** A failed API call. `code` is the API's error code, or `network_error` when offline. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.error);
  }
  get code(): string {
    return this.body.error;
  }
}

export interface ApiClientDeps {
  baseUrl: string;
  getTokens(): TokensResponse | null;
  getDeviceId(): string;
  onTokens(tokens: TokensResponse): Promise<void>;
  /** Called when the refresh token is rejected: the session is over. */
  onSessionEnded(): Promise<void>;
  fetch?: typeof fetch;
}

export interface RequestOptions {
  body?: unknown;
  /** Send the access token (default) and refresh it once on 401. */
  auth?: boolean;
  /** Required by money-moving endpoints (SEC-22). Reuse the same key when retrying. */
  idempotencyKey?: string;
}

export function createApiClient(deps: ApiClientDeps) {
  const doFetch = deps.fetch ?? fetch;
  let refreshing: Promise<boolean> | null = null;

  async function send(method: string, path: string, opts: RequestOptions, accessToken?: string) {
    const headers: Record<string, string> = { 'x-device-id': deps.getDeviceId() };
    const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
    // FormData sets its own multipart content type (with the boundary).
    if (opts.body !== undefined && !isForm) headers['content-type'] = 'application/json';
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
    try {
      return await doFetch(`${deps.baseUrl}${path}`, {
        method,
        headers,
        body:
          opts.body === undefined
            ? undefined
            : isForm
              ? (opts.body as FormData)
              : JSON.stringify(opts.body),
      });
    } catch {
      throw new ApiRequestError(0, { error: 'network_error' });
    }
  }

  /** One refresh at a time; concurrent 401s wait for the same refresh. */
  function refresh(): Promise<boolean> {
    refreshing ??= (async () => {
      const refreshToken = deps.getTokens()?.refreshToken;
      if (!refreshToken) return false;
      const res = await send('POST', '/auth/refresh', { body: { refreshToken }, auth: false });
      if (!res.ok) {
        if (res.status === 401) await deps.onSessionEnded();
        return false;
      }
      await deps.onTokens((await res.json()) as TokensResponse);
      return true;
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const auth = opts.auth ?? true;
    let res = await send(method, path, opts, auth ? deps.getTokens()?.accessToken : undefined);
    if (auth && res.status === 401 && (await refresh())) {
      res = await send(method, path, opts, deps.getTokens()?.accessToken);
    }
    if (res.status === 204) return undefined as T;
    // Exports (CSV) come back as text.
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && type && !type.includes('json')) return (await res.text()) as T;
    const body = (await res.json().catch(() => ({ error: 'bad_response' }))) as unknown;
    if (!res.ok) throw new ApiRequestError(res.status, body as ApiErrorBody);
    return body as T;
  }

  return {
    get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, opts),
    post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>) =>
      request<T>('POST', path, { ...opts, body }),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
    put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
    delete: <T>(path: string) => request<T>('DELETE', path),
    request,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
