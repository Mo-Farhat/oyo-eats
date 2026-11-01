import {
  Inject,
  Injectable,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import type { Response } from 'express';
import { from, mergeMap, catchError, throwError, of, type Observable } from 'rxjs';
import type { AuthedRequest } from '../auth/decorators.js';
import { PLATFORM, withScope, type Database } from '../db/client.js';
import { idempotencyKeys } from '../db/schema.js';
import { DB } from '../tokens.js';
import { ApiError } from './api-error.js';
import { sha256 } from './crypto.js';

const TTL_MS = 24 * 60 * 60 * 1000;
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** Canonical JSON (sorted keys) so the same body always hashes the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

type Begin = { kind: 'proceed' } | { kind: 'replay'; body: unknown };

/**
 * Requires an `Idempotency-Key` header and makes the endpoint safe to retry (SEC-22):
 * - first request runs and its response is stored for 24 h, keyed by caller and key;
 * - a retry with the same key and body gets the stored response (header `Idempotent-Replayed`);
 * - the same key with a different body is refused (422), and so is a retry while the first is
 *   still running (409).
 * If the handler throws, the key is released so the client can retry. Handlers must therefore
 * not commit money movements and then throw.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(DB) private readonly db: Database) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthedRequest>();
    const response = http.getResponse<Response>();
    const accountId = request.auth?.accountId;
    if (!accountId) throw new Error('@Idempotent() needs a signed-in route');

    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !KEY_PATTERN.test(key))
      throw new ApiError('idempotency_key_required');
    const requestHash = sha256(`${request.method} ${request.path} ${canonical(request.body)}`);

    return from(this.begin(accountId, key, requestHash)).pipe(
      mergeMap((begin) => {
        if (begin.kind === 'replay') {
          // Nest applies the route's status code afterwards, as for the first response.
          response.setHeader('Idempotent-Replayed', 'true');
          return of(begin.body);
        }
        return next.handle().pipe(
          mergeMap(async (body: unknown) => {
            await this.complete(accountId, key, body);
            return body;
          }),
          catchError((error: unknown) =>
            from(this.release(accountId, key)).pipe(mergeMap(() => throwError(() => error))),
          ),
        );
      }),
    );
  }

  private begin(accountId: string, key: string, requestHash: string): Promise<Begin> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const now = new Date();
      // An expired record no longer protects anything; let the key start over.
      await tx
        .delete(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.accountId, accountId),
            eq(idempotencyKeys.key, key),
            lt(idempotencyKeys.expiresAt, now),
          ),
        );
      const inserted = await tx
        .insert(idempotencyKeys)
        .values({
          accountId,
          key,
          requestHash,
          createdAt: now,
          expiresAt: new Date(now.getTime() + TTL_MS),
        })
        .onConflictDoNothing()
        .returning({ key: idempotencyKeys.key });
      if (inserted.length > 0) return { kind: 'proceed' };

      const [existing] = await tx
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.accountId, accountId), eq(idempotencyKeys.key, key)));
      if (!existing || existing.requestHash !== requestHash)
        throw new ApiError('idempotency_key_reused');
      if (!existing.completedAt) throw new ApiError('idempotency_in_progress');
      return { kind: 'replay', body: existing.responseBody };
    });
  }

  private complete(accountId: string, key: string, body: unknown): Promise<unknown> {
    return withScope(this.db, PLATFORM, (tx) =>
      tx
        .update(idempotencyKeys)
        .set({ responseBody: body ?? null, completedAt: new Date() })
        .where(and(eq(idempotencyKeys.accountId, accountId), eq(idempotencyKeys.key, key))),
    );
  }

  private release(accountId: string, key: string): Promise<unknown> {
    return withScope(this.db, PLATFORM, (tx) =>
      tx
        .delete(idempotencyKeys)
        .where(and(eq(idempotencyKeys.accountId, accountId), eq(idempotencyKeys.key, key))),
    );
  }
}

/** Marks a money-moving endpoint: it requires an Idempotency-Key header. */
export const Idempotent = () => UseInterceptors(IdempotencyInterceptor);
