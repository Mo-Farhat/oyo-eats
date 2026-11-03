import type { AdminReport, AuditEntry } from '@oyo/shared';
import { sql } from 'drizzle-orm';
import { ApiError } from '../common/api-error.js';
import { PLATFORM, withScope, type Database } from '../db/client.js';
import { auditLog } from '../db/schema.js';
import { balance } from '../ledger/ledger.js';

const DAY_MS = 86_400_000;
type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const mins = (v: unknown) =>
  v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10;

/** A19 (ADM-17) reports and the audit log (SEC-31). Owner only. */
export class ReportsService {
  constructor(private readonly db: Database) {}

  report(from: string, to: string): Promise<AdminReport> {
    const start = new Date(`${from}T00:00:00+05:30`);
    const end = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + DAY_MS);
    if (end <= start || end.getTime() - start.getTime() > 92 * DAY_MS)
      throw new ApiError('invalid_input', { field: 'to', reason: 'range' });
    const s = start.toISOString();
    const e = end.toISOString();
    return withScope(this.db, PLATFORM, async (tx) => {
      const q = async (query: ReturnType<typeof sql>) => (await tx.execute<Row>(query)).rows;
      const [orderRows, money, times, reasons, days, restaurants, riders, refunds] =
        await Promise.all([
          q(sql`select status, payment_method, count(*)::int as n from orders
              where placed_at >= ${s} and placed_at < ${e} and status <> 'awaiting_payment'
              group by 1, 2`),
          q(sql`select coalesce(sum(o.total_cents),0) as gross, coalesce(sum(o.delivery_fee_cents),0) as fee,
                     coalesce(sum(o.items_cents + o.restaurant_fee_cents),0) as food,
                     coalesce(sum(f.payout_cents),0) as pay
              from orders o
              left join offers f on f.order_id = o.id and f.rider_id = o.rider_id and f.outcome = 'accepted'
              where o.status = 'delivered' and o.closed_at >= ${s} and o.closed_at < ${e}`),
          q(sql`with d as (
                select extract(epoch from o.closed_at - o.placed_at) / 60 as total,
                       (select extract(epoch from min(a.occurred_at) - o.placed_at) / 60 from order_events a
                        where a.order_id = o.id and a.type = 'restaurant_accepted') as accept
                from orders o where o.status = 'delivered' and o.closed_at >= ${s} and o.closed_at < ${e})
              select avg(total) as avg, percentile_cont(0.9) within group (order by total) as p90,
                     avg(accept) as accept from d`),
          q(sql`select coalesce(e.payload->>'reason', e.type) as reason, count(*)::int as n
              from order_events e
              where e.occurred_at >= ${s} and e.occurred_at < ${e}
                and e.type in ('restaurant_rejected','restaurant_timed_out','cancelled_by_customer',
                               'cancelled_by_admin','delivery_failed','payment_expired','offer_declined')
              group by 1 order by 2 desc limit 12`),
          q(sql`select to_char(o.closed_at at time zone 'Asia/Colombo', 'YYYY-MM-DD') as date,
                     count(*)::int as n, coalesce(sum(o.total_cents),0) as gross
              from orders o where o.status = 'delivered' and o.closed_at >= ${s} and o.closed_at < ${e}
              group by 1 order by 1 desc`),
          q(sql`select r.id, r.name,
                     count(*) filter (where o.status = 'delivered')::int as delivered,
                     coalesce(sum(o.items_cents + o.restaurant_fee_cents) filter (where o.status = 'delivered'),0) as food,
                     count(*) filter (where o.status = 'rejected')::int as rejected,
                     (select round(avg(v.rating)::numeric, 1) from reviews v
                      where v.tenant_id = r.id and v.subject = 'restaurant' and not v.hidden) as rating
              from restaurants r join orders o on o.tenant_id = r.id
              where o.placed_at >= ${s} and o.placed_at < ${e}
              group by r.id, r.name order by 4 desc`),
          q(sql`select a.id, a.display_name as name,
                     count(o.id) filter (where o.status = 'delivered')::int as delivered,
                     avg(extract(epoch from o.closed_at - o.placed_at) / 60) filter (where o.status = 'delivered') as avg,
                     (select count(*)::int from offers f where f.rider_id = a.id and f.outcome = 'declined'
                        and f.sent_at >= ${s} and f.sent_at < ${e}) as declined
              from accounts a join orders o on o.rider_id = a.id
              where a.role = 'rider' and o.closed_at >= ${s} and o.closed_at < ${e}
              group by a.id, a.display_name order by 3 desc`),
          q(
            sql`select coalesce(sum(amount_cents),0) as cents from refunds where created_at >= ${s} and created_at < ${e}`,
          ),
        ]);
      const count = (pred: (r: Row) => boolean) =>
        orderRows.filter(pred).reduce((n, r) => n + num(r.n), 0);
      const [cash, restaurantsOwed, ridersOwed, customersOwed] = await Promise.all([
        balance(tx, 'rider_cash'),
        balance(tx, 'restaurant_payable'),
        balance(tx, 'rider_payable'),
        balance(tx, 'customer_credit'),
      ]);
      return {
        from,
        to,
        orders: {
          placed: count(() => true),
          delivered: count((r) => r.status === 'delivered'),
          cancelled: count((r) => r.status === 'cancelled'),
          rejected: count((r) => r.status === 'rejected'),
          failed: count((r) => r.status === 'failed'),
          cod: count((r) => r.payment_method === 'cod'),
          bankTransfer: count((r) => r.payment_method === 'bank_transfer'),
        },
        money: {
          grossCents: num(money[0]?.gross),
          deliveryFeeCents: num(money[0]?.fee),
          foodCents: num(money[0]?.food),
          riderPayCents: num(money[0]?.pay),
          refundsCents: num(refunds[0]?.cents),
        },
        // Liabilities are credits (negative) in the ledger; shown as positive amounts owed.
        position: {
          cashWithRidersCents: cash,
          owedToRestaurantsCents: Math.max(0, -restaurantsOwed),
          owedToRidersCents: Math.max(0, -ridersOwed),
          owedToCustomersCents: Math.max(0, -customersOwed),
        },
        times: {
          avgDeliveryMinutes: mins(times[0]?.avg),
          p90DeliveryMinutes: mins(times[0]?.p90),
          avgAcceptMinutes: mins(times[0]?.accept),
        },
        reasons: reasons.map((r) => ({ reason: String(r.reason), count: num(r.n) })),
        days: days.map((d) => ({
          date: String(d.date),
          delivered: num(d.n),
          grossCents: num(d.gross),
        })),
        restaurants: restaurants.map((r) => ({
          id: String(r.id),
          name: String(r.name),
          delivered: num(r.delivered),
          foodCents: num(r.food),
          rejected: num(r.rejected),
          rating: r.rating === null ? null : Number(r.rating),
        })),
        riders: riders.map((r) => ({
          id: String(r.id),
          name: String(r.name),
          delivered: num(r.delivered),
          avgMinutes: mins(r.avg),
          declined: num(r.declined),
        })),
      };
    });
  }

  async csv(from: string, to: string): Promise<string> {
    const r = await this.report(from, to);
    const lines = [
      'date,delivered,gross_lkr',
      ...r.days.map((d) => `${d.date},${d.delivered},${(d.grossCents / 100).toFixed(2)}`),
    ];
    lines.push('', 'restaurant,delivered,food_lkr,rejected,rating');
    for (const x of r.restaurants)
      lines.push(
        `"${x.name.replace(/"/g, '""')}",${x.delivered},${(x.foodCents / 100).toFixed(2)},${x.rejected},${x.rating ?? ''}`,
      );
    lines.push('', 'rider,delivered,avg_minutes,declined');
    for (const x of r.riders)
      lines.push(
        `"${x.name.replace(/"/g, '""')}",${x.delivered},${x.avgMinutes ?? ''},${x.declined}`,
      );
    return lines.join('\n') + '\n';
  }

  /** SEC-31: the latest entries, newest first, optionally one action prefix (e.g. "refund."). */
  audit(prefix?: string): Promise<AuditEntry[]> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const rows = (
        await tx.execute<Row>(sql`
          select l.id, l.occurred_at, coalesce(a.display_name, 'System') as actor, l.actor_role, l.action,
                 l.target_type, l.target_id, l.after
          from ${auditLog} l left join accounts a on a.id = l.actor_account_id
          ${prefix ? sql`where l.action like ${`${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}` : sql``}
          order by l.id desc limit 150`)
      ).rows;
      return rows.map((r) => ({
        id: num(r.id),
        at: new Date(r.occurred_at as string).toISOString(),
        actor: String(r.actor),
        role: String(r.actor_role),
        action: String(r.action),
        target: `${r.target_type}${r.target_id ? ` ${String(r.target_id).slice(0, 8)}` : ''}`,
        details: (r.after as Record<string, unknown> | null) ?? null,
      }));
    });
  }
}
