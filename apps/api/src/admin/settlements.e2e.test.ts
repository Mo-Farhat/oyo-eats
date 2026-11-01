/*
 * Restaurant statements and rider payouts (A16, A17, ADM-13, ADM-14): generate for a past week,
 * review, mark paid (checksum, ledger, frozen), and never cover an order twice.
 */
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDb, inRollback, testDatabaseUrl } from '../db/testing.js';
import { balance } from '../ledger/ledger.js';
import { deliveredCodOrder, onlineRider } from '../testing/flows.js';
import { withHarness } from '../testing/harness.js';

afterAll(closeTestDb);

/** Monday of last week, Asia/Colombo. */
function lastMonday() {
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' }));
  const back = ((today.getDay() + 6) % 7) + 7;
  today.setDate(today.getDate() - back);
  return today.toLocaleDateString('en-CA');
}

describe.skipIf(!testDatabaseUrl)('settlements', () => {
  it(
    'settles a restaurant and pays a rider for last week, once',
    () =>
      inRollback((tx) =>
        withHarness(tx, async (h) => {
          const owner = await h.staff('owner');
          const dispatcher = await h.staff('dispatcher');
          const rider = await onlineRider(h, tx, dispatcher);
          const { order, restaurant } = await deliveredCodOrder(h, tx, {
            dispatcher,
            rider,
            customerPhone: '+94773000020',
            key: 'settle-0001',
          });
          const monday = lastMonday();
          // Delivered on Tuesday of last week (10:00 Colombo).
          const tuesday = new Date(`${monday}T10:00:00+05:30`);
          tuesday.setUTCDate(tuesday.getUTCDate() + 1);
          await tx.execute(
            sql`update orders set closed_at = ${tuesday.toISOString()} where id = ${order.id}`,
          );

          const food = order.itemsCents + order.restaurantFeeCents;
          expect(
            (
              await h.http('POST', '/admin/settlements/generate', {
                token: dispatcher,
                body: { party: 'restaurant', periodStart: monday },
              })
            ).status,
          ).toBe(403);
          // A period that hasn't ended can't be settled yet.
          const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });
          expect(
            (
              await h.http('POST', '/admin/settlements/generate', {
                token: owner,
                body: { party: 'restaurant', periodStart: today },
              })
            ).body.error,
          ).toBe('invalid_input');

          const generated = (
            await h.http('POST', '/admin/settlements/generate', {
              token: owner,
              body: { party: 'restaurant', periodStart: monday },
            })
          ).body;
          const mine = generated.find(
            (s: { partyId: string }) => s.partyId === restaurant.tenantId,
          );
          expect(mine).toMatchObject({ status: 'draft', totalCents: food, lineCount: 1 });

          // Regenerating replaces the draft rather than doubling it.
          const again = (
            await h.http('POST', '/admin/settlements/generate', {
              token: owner,
              body: { party: 'restaurant', periodStart: monday },
            })
          ).body.find((s: { partyId: string }) => s.partyId === restaurant.tenantId);
          expect(again.totalCents).toBe(food);
          expect(again.id).not.toBe(mine.id);

          // Paying needs a review first; then it's frozen with a checksum and posted.
          expect(
            (
              await h.http('POST', `/admin/settlements/${again.id}/paid`, {
                token: owner,
                key: 'pay-early',
                body: {},
              })
            ).body.error,
          ).toBe('invalid_transition');
          await h.http('POST', `/admin/settlements/${again.id}/review`, { token: owner });
          const before = await balance(tx, 'business_bank');
          const paid = (
            await h.http('POST', `/admin/settlements/${again.id}/paid`, {
              token: owner,
              key: 'pay-restaurant',
              body: { reference: 'BOC-TRX-77' },
            })
          ).body;
          expect(paid).toMatchObject({
            status: 'paid',
            checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
          });
          expect(await balance(tx, 'restaurant_payable', restaurant.tenantId)).toBe(0);
          expect(await balance(tx, 'business_bank')).toBe(before - food);
          // Frozen once paid (in a savepoint, so the failure doesn't abort the test transaction).
          await expect(
            tx.transaction((sp) =>
              sp.execute(sql`update settlements set total_cents = 1 where id = ${again.id}`),
            ),
          ).rejects.toThrow();

          // The order can't land on another restaurant statement.
          const third = (
            await h.http('POST', '/admin/settlements/generate', {
              token: owner,
              body: { party: 'restaurant', periodStart: monday },
            })
          ).body;
          expect(
            third.find((s: { partyId: string }) => s.partyId === restaurant.tenantId),
          ).toBeUndefined();

          // Rider payout for the same week: the pay fixed on the offer.
          const riderRun = (
            await h.http('POST', '/admin/settlements/generate', {
              token: owner,
              body: { party: 'rider', periodStart: monday },
            })
          ).body.find((s: { partyId: string }) => s.partyId === rider.id);
          expect(riderRun.totalCents).toBe(-(await balance(tx, 'rider_payable', rider.id)));
          const csv = await h.http('GET', `/admin/settlements/${riderRun.id}/csv`, {
            token: owner,
          });
          expect(csv.status).toBe(200);
          expect(csv.body).toContain('Delivery #');
          await h.http('POST', `/admin/settlements/${riderRun.id}/review`, { token: owner });
          await h.http('POST', `/admin/settlements/${riderRun.id}/paid`, {
            token: owner,
            key: 'pay-rider',
            body: {},
          });
          expect(await balance(tx, 'rider_payable', rider.id)).toBe(0);
        }),
      ),
    180_000,
  );
});
