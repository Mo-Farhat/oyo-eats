import { Logger } from '@nestjs/common';
import { orderNotifications, type Audience } from '@oyo/shared';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { PLATFORM, withScope, type Database, type Tx } from '../db/client.js';
import {
  accounts,
  bankSlips,
  notificationRuns,
  notifications,
  orderEvents,
  orders,
  pushTokens,
  restaurants,
} from '../db/schema.js';
import { decrypt } from '../common/crypto.js';
import { loadSettings } from '../settings/settings.js';
import type { SmsSender } from '../sms/sms.js';
import type { PushSender } from './push.js';

/** Events older than this when first seen are not notified (a deploy or outage shouldn't spam). */
const FRESH_WINDOW = sql`interval '10 minutes'`;

export interface InAppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  createdAt: string;
  read: boolean;
}

/**
 * Turns committed order events into notifications (one row per person) and pushes them (section 10).
 * Safe to run on several servers at once: both steps lock with SKIP LOCKED.
 */
export class NotificationsService {
  private readonly log = new Logger('Notifications');
  private running = false;

  constructor(
    private readonly db: Database,
    private readonly sender: PushSender,
    /** NOT-01: critical messages that can't be pushed go by SMS instead. */
    private readonly fallback?: { sms: SmsSender; encryptionKey: Buffer },
  ) {}

  /** A short SMS with the same text as the push (no address or phone in it, NOT-05). */
  private async smsFallback(tx: Tx, n: typeof notifications.$inferSelect): Promise<boolean> {
    if (!this.fallback) return false;
    const [a] = await tx
      .select({ phone: accounts.phoneCiphertext })
      .from(accounts)
      .where(eq(accounts.id, n.accountId));
    if (!a?.phone) return false;
    const text = `Oyo Eats: ${n.title}. ${n.body}`.slice(0, 300);
    try {
      await this.fallback.sms.send(decrypt(this.fallback.encryptionKey, a.phone), text);
      return true;
    } catch (e) {
      this.log.warn(`SMS fallback failed: ${String(e)}`);
      return false;
    }
  }

  /** Expand, then push. Overlapping calls on one server coalesce. */
  async runOnce(): Promise<{ created: number; pushed: number }> {
    if (this.running) return { created: 0, pushed: 0 };
    this.running = true;
    try {
      const created = (await this.expand()) + (await this.escalateUnassigned());
      const pushed = await this.push();
      return { created, pushed };
    } catch (e) {
      this.log.warn(`Notification run failed: ${String(e)}`);
      return { created: 0, pushed: 0 };
    } finally {
      this.running = false;
    }
  }

  private async recipients(
    tx: Tx,
    audience: Audience,
    o: typeof orders.$inferSelect,
    riderId: string | null,
  ) {
    switch (audience) {
      case 'customer':
        return [o.customerId];
      case 'rider':
        return riderId ? [riderId] : [];
      case 'restaurant':
        return (
          await tx
            .select({ id: accounts.id })
            .from(accounts)
            .where(and(eq(accounts.tenantId, o.tenantId), eq(accounts.status, 'active')))
        ).map((a) => a.id);
      case 'dispatch':
        return (
          await tx
            .select({ id: accounts.id })
            .from(accounts)
            .where(
              and(inArray(accounts.role, ['dispatcher', 'owner']), eq(accounts.status, 'active')),
            )
        ).map((a) => a.id);
    }
  }

  /** Order events not yet notified become notification rows. */
  async expand(limit = 50): Promise<number> {
    return withScope(this.db, PLATFORM, async (tx) => {
      // Claim a batch: the run row is the lock (order_events itself is append-only). A second
      // server racing for the same event waits on the key, then skips it.
      const claimed = await tx.execute<{ event_id: string }>(sql`
        insert into ${notificationRuns} (event_id)
        select e.id from ${orderEvents} e
        where e.occurred_at > now() - ${FRESH_WINDOW}
          and not exists (select 1 from ${notificationRuns} r where r.event_id = e.id)
        order by e.seq
        limit ${limit}
        on conflict do nothing
        returning event_id`);
      const ids = claimed.rows.map((r) => r.event_id);
      if (!ids.length) return 0;
      const events = await tx
        .select({ event: orderEvents, order: orders, restaurantName: restaurants.name })
        .from(orderEvents)
        .innerJoin(orders, eq(orders.id, orderEvents.orderId))
        .innerJoin(restaurants, eq(restaurants.id, orders.tenantId))
        .where(inArray(orderEvents.id, ids))
        .orderBy(orderEvents.seq);
      let created = 0;
      for (const { event, order, restaurantName } of events) {
        const payload = (event.payload ?? {}) as Record<string, unknown>;
        const riderId = typeof payload.riderId === 'string' ? payload.riderId : order.riderId;
        const [rider] = riderId
          ? await tx
              .select({ name: accounts.displayName })
              .from(accounts)
              .where(eq(accounts.id, riderId))
          : [];
        const prepaid =
          order.paymentMethod === 'bank_transfer' &&
          (
            await tx
              .select({ id: bankSlips.id })
              .from(bankSlips)
              .where(
                and(
                  eq(bankSlips.orderId, order.id),
                  inArray(bankSlips.status, ['pending', 'approved']),
                ),
              )
          ).length > 0;
        const templates = orderNotifications({
          type: event.type,
          reference: order.reference,
          restaurantName,
          paymentMethod: order.paymentMethod,
          riderName: rider?.name ?? null,
          prepMinutes: order.prepMinutes,
          payload,
          prepaid,
        });
        const rows = [];
        for (const t of templates) {
          for (const accountId of await this.recipients(tx, t.audience, order, riderId)) {
            rows.push({
              accountId,
              kind: event.type,
              title: t.title,
              body: t.body,
              data: { orderId: order.id, audience: t.audience },
              critical: !!t.critical,
            });
          }
        }
        if (rows.length) await tx.insert(notifications).values(rows);
        created += rows.length;
      }
      return created;
    });
  }

  /**
   * Unassigned beyond the alert time (section 10): every active dispatcher gets one critical
   * alert per order. Same rule as the board's "late" badge.
   */
  async escalateUnassigned(): Promise<number> {
    return withScope(this.db, PLATFORM, async (tx) => {
      // One server at a time, so an order is never alerted twice.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('notifications:unassigned'))`);
      const { timers } = await loadSettings(tx);
      const late = await tx.execute<{
        id: string;
        reference: string;
        restaurant: string;
        minutes: number;
      }>(sql`
        select o.id, o.reference, r.name as restaurant,
               floor(extract(epoch from now() - a.at) / 60)::int as minutes
        from ${orders} o
        join ${restaurants} r on r.id = o.tenant_id
        join lateral (
          select max(e.occurred_at) as at from ${orderEvents} e
          where e.order_id = o.id and e.type = 'restaurant_accepted'
        ) a on a.at is not null
        where o.status = 'active' and o.delivery_status = 'unassigned'
          and a.at <= now() - make_interval(secs => ${timers.unassignedAlertSeconds})
          and not exists (
            select 1 from ${notifications} n
            where n.kind = 'unassigned_alert' and n.data->>'orderId' = o.id::text
          )
        limit 20`);
      if (!late.rows.length) return 0;
      const dispatchers = (
        await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(
            and(inArray(accounts.role, ['dispatcher', 'owner']), eq(accounts.status, 'active')),
          )
      ).map((a) => a.id);
      const rows = late.rows.flatMap((o) =>
        dispatchers.map((accountId) => ({
          accountId,
          kind: 'unassigned_alert',
          title: `#${o.reference} needs a rider`,
          body: `${o.restaurant} accepted it ${o.minutes} min ago. Assign a rider now.`,
          data: { orderId: o.id, audience: 'dispatch' },
          critical: true,
        })),
      );
      if (rows.length) await tx.insert(notifications).values(rows);
      return rows.length;
    });
  }

  /** Sends pending pushes; people without a registered phone are marked no_device. */
  async push(limit = 100): Promise<number> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const pending = await tx
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.pushStatus, 'pending'),
            gt(notifications.createdAt, sql`now() - interval '1 hour'`),
          ),
        )
        .orderBy(notifications.createdAt)
        .limit(limit)
        .for('update', { skipLocked: true });
      if (!pending.length) return 0;
      const tokens = await tx
        .select()
        .from(pushTokens)
        .where(inArray(pushTokens.accountId, [...new Set(pending.map((p) => p.accountId))]));
      const messages = pending.flatMap((n) =>
        tokens
          .filter((t) => t.accountId === n.accountId)
          .map((t) => ({
            n,
            token: t,
            message: {
              to: t.token,
              title: n.title,
              body: n.body,
              data: { ...(n.data as Record<string, unknown>), notificationId: n.id },
              critical: n.critical,
            },
          })),
      );
      const results = messages.length ? await this.sender.send(messages.map((m) => m.message)) : [];
      const now = new Date();
      let sent = 0;
      for (const n of pending) {
        const mine = messages
          .map((m, i) => ({ ...m, r: results[i]! }))
          .filter((m) => m.n.id === n.id);
        const ok = mine.some((m) => m.r.ok);
        let status: string = !mine.length
          ? 'no_device'
          : ok
            ? 'sent'
            : n.pushAttempts >= 2
              ? 'failed'
              : 'pending';
        // NOT-01: a critical message with no way to push it goes by SMS.
        if (
          n.critical &&
          (status === 'no_device' || status === 'failed') &&
          (await this.smsFallback(tx, n))
        )
          status = 'sms';
        if (ok) sent++;
        await tx
          .update(notifications)
          .set({
            pushStatus: status,
            pushAttempts: n.pushAttempts + (mine.length ? 1 : 0),
            pushError: ok || !mine.length ? null : (mine[0]!.r.error ?? 'error'),
            sentAt: ok ? now : null,
          })
          .where(eq(notifications.id, n.id));
        const dead = mine.filter((m) => m.r.unregistered).map((m) => m.token.id);
        if (dead.length) await tx.delete(pushTokens).where(inArray(pushTokens.id, dead));
      }
      return sent;
    });
  }

  /** NOT-06: the in-app list, last 30 days. */
  list(auth: AuthContext): Promise<{ items: InAppNotification[]; unread: number }> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const rows = await tx
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.accountId, auth.accountId),
            gt(notifications.createdAt, sql`now() - interval '30 days'`),
          ),
        )
        .orderBy(desc(notifications.createdAt))
        .limit(100);
      return {
        items: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          body: r.body,
          data: r.data as Record<string, unknown>,
          createdAt: r.createdAt.toISOString(),
          read: r.readAt !== null,
        })),
        unread: rows.filter((r) => !r.readAt).length,
      };
    });
  }

  markAllRead(auth: AuthContext): Promise<void> {
    return withScope(this.db, PLATFORM, async (tx) => {
      await tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.accountId, auth.accountId), isNull(notifications.readAt)));
    });
  }

  /** A phone's Expo push token. A token moves with whoever signed in on that phone last. */
  registerToken(auth: AuthContext, token: string, platform?: string): Promise<void> {
    return withScope(this.db, PLATFORM, async (tx) => {
      await tx
        .insert(pushTokens)
        .values({
          accountId: auth.accountId,
          token,
          platform,
          deviceId: auth.deviceId,
          lastSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: pushTokens.token,
          set: {
            accountId: auth.accountId,
            platform,
            deviceId: auth.deviceId,
            lastSeenAt: new Date(),
          },
        });
    });
  }

  /** On sign-out the phone stops getting this person's pushes. */
  removeToken(auth: AuthContext, token: string): Promise<void> {
    return withScope(this.db, PLATFORM, async (tx) => {
      await tx
        .delete(pushTokens)
        .where(and(eq(pushTokens.token, token), eq(pushTokens.accountId, auth.accountId)));
    });
  }
}
