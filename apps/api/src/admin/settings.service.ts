import type { AdminSettings } from '@oyo/shared';
import { inArray } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { PLATFORM, withScope, type Database, type Tx } from '../db/client.js';
import { auditLog, settings } from '../db/schema.js';
import { loadSettings } from '../settings/settings.js';

/** JSON with sorted keys: Postgres jsonb doesn't keep key order, so plain stringify misreports changes. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v ?? null);
}

const OPTIONAL = [
  'minimumOrderCents',
  'codLimitCents',
  'dispatcherRefundCapCents',
  'bankDetails',
] as const;

/** A20 (ADM-18): read and replace the business settings, audited before and after. */
export class SettingsAdminService {
  constructor(private readonly db: Database) {}

  get(): Promise<AdminSettings> {
    return withScope(this.db, PLATFORM, (tx) => this.read(tx));
  }

  private async read(tx: Tx): Promise<AdminSettings> {
    const s = await loadSettings(tx);
    return {
      deliveryFee: s.deliveryFee,
      timers: s.timers,
      riderCaps: s.riderCaps,
      riderPay: s.riderPay,
      minimumOrderCents: s.minimumOrderCents ?? null,
      codLimitCents: s.codLimitCents ?? null,
      dispatcherRefundCapCents: s.dispatcherRefundCapCents ?? null,
      bankDetails: s.bankDetails ?? null,
    };
  }

  /** New orders use the new values; orders already placed keep the fee they were quoted. */
  update(auth: AuthContext, input: AdminSettings): Promise<AdminSettings> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const before = await this.read(tx);
      const set = Object.entries(input).filter(([, v]) => v !== null) as [string, unknown][];
      for (const [key, value] of set) {
        await tx
          .insert(settings)
          .values({ key, value })
          .onConflictDoUpdate({ target: settings.key, set: { value } });
      }
      const cleared = OPTIONAL.filter((k) => input[k] === null);
      if (cleared.length) await tx.delete(settings).where(inArray(settings.key, [...cleared]));
      const changed = Object.keys(input).filter(
        (k) => stable(before[k as keyof AdminSettings]) !== stable(input[k as keyof AdminSettings]),
      );
      if (changed.length) {
        const pick = (o: AdminSettings) =>
          Object.fromEntries(changed.map((k) => [k, o[k as keyof AdminSettings]]));
        await tx.insert(auditLog).values({
          actorAccountId: auth.accountId,
          actorRole: auth.role,
          action: 'settings.updated',
          targetType: 'settings',
          targetId: changed.join(','),
          before: pick(before),
          after: pick(input),
          deviceId: auth.deviceId,
        });
      }
      return input;
    });
  }
}
