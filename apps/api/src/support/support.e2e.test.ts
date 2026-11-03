/*
 * Support and refunds (CUS-14, CUS-19, RID-13/14, ADM-16): a problem with a photo, a capped
 * refund charged to the restaurant and netted off its statement, the owner marking it paid, a cancel
 * request, a rider emergency, and the ledger agreeing throughout.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDb, inRollback, testDatabaseUrl } from '../db/testing.js';
import { balance } from '../ledger/ledger.js';
import { deliveredCodOrder, onlineRider } from '../testing/flows.js';
import { fixtureRestaurant, withHarness } from '../testing/harness.js';

afterAll(closeTestDb);

const photo = () =>
  sharp(randomBytes(48 * 48 * 3), { raw: { width: 48, height: 48, channels: 3 } })
    .jpeg()
    .withExif({ IFD0: { Make: 'Phone' } })
    .toBuffer();

function lastMonday() {
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' }));
  today.setDate(today.getDate() - (((today.getDay() + 6) % 7) + 7));
  return today.toLocaleDateString('en-CA');
}

describe.skipIf(!testDatabaseUrl)('support and refunds', () => {
  it(
    'takes a problem report through a capped refund to the restaurant statement',
    () =>
      inRollback((tx) =>
        withHarness(tx, async (h) => {
          const owner = await h.staff('owner');
          const dispatcher = await h.staff('dispatcher');
          const rider = await onlineRider(h, tx, dispatcher);
          const restaurant = await fixtureRestaurant(tx);
          const { order, customer } = await deliveredCodOrder(h, tx, {
            dispatcher,
            rider,
            restaurant,
            customerPhone: '+94773000080',
            key: 'support-0001',
          });

          // C19: a missing item, with a photo (re-encoded, metadata gone).
          const report = await h.upload(
            `/orders/${order.id}/problems`,
            customer,
            'photos',
            await photo(),
            {
              type: 'missing_item',
              description: 'The cheese kottu was missing',
            },
          );
          expect(report.status).toBe(201);
          expect(report.body[0]).toMatchObject({ type: 'missing_item', status: 'open' });
          const [stored] = [...h.storage.files.values()];
          expect((await sharp(stored!.data).metadata()).exif).toBeUndefined();

          const queue = (await h.http('GET', '/admin/cases', { token: dispatcher })).body;
          const item = queue.find(
            (c: { order: { id: string } | null }) => c.order?.id === order.id,
          );
          const detail = (await h.http('GET', `/admin/cases/${item.id}`, { token: dispatcher }))
            .body;
          expect(detail).toMatchObject({
            type: 'missing_item',
            reporter: { role: 'customer', phone: '+94773000080' },
            order: { paidCents: order.totalCents, refundableCents: order.totalCents },
            photos: [expect.stringMatching(/^memory:\/\/cases\//)],
          });

          // No cap set: dispatchers can't refund. With a cap, up to it.
          const refund = (token: string, amountCents: number, key: string) =>
            h.http('POST', `/admin/cases/${item.id}/refund`, {
              token,
              key,
              body: { amountCents, reasonCode: 'missing_item', attribution: 'restaurant' },
            });
          await tx.execute(sql`delete from settings where key = 'dispatcherRefundCapCents'`);
          expect((await refund(dispatcher, 30_000, 'support-key-r1-0000')).body.error).toBe(
            'refund_over_cap',
          );
          await tx.execute(
            sql`insert into settings (key, value) values ('dispatcherRefundCapCents', '50000'::jsonb)`,
          );
          expect((await refund(dispatcher, 60_000, 'support-key-r2-0000')).body.error).toBe(
            'refund_over_cap',
          );
          const payableBefore = await balance(tx, 'restaurant_payable', restaurant.tenantId);
          const refunded = await refund(dispatcher, 30_000, 'support-key-r3-0000');
          expect(refunded.body).toMatchObject({
            status: 'in_progress',
            order: { refundableCents: order.totalCents - 30_000 },
            refunds: [{ amountCents: 30_000, attribution: 'restaurant', status: 'owed' }],
          });
          // The owner isn't capped, but can't refund more than was paid.
          expect((await refund(owner, order.totalCents, 'support-key-r4-0000')).body.error).toBe(
            'refund_too_large',
          );

          // Ledger: charged to the restaurant, owed to the customer.
          expect(await balance(tx, 'restaurant_payable', restaurant.tenantId)).toBe(
            payableBefore + 30_000,
          );
          const customerId = (await h.http('GET', '/auth/me', { token: customer })).body.accountId;
          expect(await balance(tx, 'customer_credit', customerId)).toBe(-30_000);
          expect(
            (await h.http('GET', `/orders/${order.id}/cases`, { token: customer })).body[0].refunds,
          ).toEqual([{ amountCents: 30_000, status: 'owed' }]);

          // Paying it out: owner only.
          const refundId = refunded.body.refunds[0].id;
          expect(
            (
              await h.http('POST', `/admin/refunds/${refundId}/paid`, {
                token: dispatcher,
                key: 'support-key-p1-0000',
                body: {},
              })
            ).status,
          ).toBe(403);
          await h.http('POST', `/admin/refunds/${refundId}/paid`, {
            token: owner,
            key: 'support-key-p2-0000',
            body: { reference: 'CB-REF-1' },
          });
          expect(await balance(tx, 'customer_credit', customerId)).toBe(0);

          // Netted off the restaurant's statement for the week.
          const monday = lastMonday();
          const tuesday = new Date(`${monday}T10:00:00+05:30`);
          tuesday.setUTCDate(tuesday.getUTCDate() + 1);
          await tx.execute(
            sql`update orders set closed_at = ${tuesday.toISOString()} where id = ${order.id}`,
          );
          await tx.execute(
            sql`update refunds set created_at = ${tuesday.toISOString()} where order_id = ${order.id}`,
          );
          const statements = (
            await h.http('POST', '/admin/settlements/generate', {
              token: owner,
              body: { party: 'restaurant', periodStart: monday },
            })
          ).body;
          const mine = statements.find(
            (s: { partyId: string }) => s.partyId === restaurant.tenantId,
          );
          expect(mine.totalCents).toBe(order.itemsCents + order.restaurantFeeCents - 30_000);
          const lines = (await h.http('GET', `/admin/settlements/${mine.id}`, { token: owner }))
            .body.lines;
          expect(lines.map((l: { description: string }) => l.description)).toContain(
            `Refund #${order.reference} (Missing item)`,
          );

          // Closing the case tells the customer.
          await h.http('POST', `/admin/cases/${item.id}/resolve`, {
            token: dispatcher,
            body: { resolution: 'Refunded LKR 300 for the missing kottu.' },
          });
          const notes = (await h.http('GET', '/me/notifications', { token: customer })).body.items;
          expect(notes.map((n: { kind: string }) => n.kind)).toEqual(
            expect.arrayContaining(['refund_issued', 'case_resolved']),
          );
        }),
      ),
    180_000,
  );

  it(
    'handles a cancel request and a rider emergency',
    () =>
      inRollback((tx) =>
        withHarness(tx, async (h) => {
          const dispatcher = await h.staff('dispatcher');
          const rider = await onlineRider(h, tx, dispatcher, 'Roshan Silva', '+94771234999');
          const restaurant = await fixtureRestaurant(tx);
          const customer = await h.customer('+94773000081');
          const address = await h.http('POST', '/me/addresses', {
            token: customer,
            body: { label: 'Home', lat: 9.665, lng: 80.0255, addressText: '1 Main Street' },
          });
          const order = (
            await h.http('POST', '/orders', {
              token: customer,
              key: 'support-0002',
              body: {
                restaurantId: restaurant.tenantId,
                addressId: address.body.id,
                paymentMethod: 'cod',
                items: [
                  {
                    menuItemId: restaurant.items.kottu,
                    quantity: 1,
                    modifierIds: [restaurant.modifiers.hot],
                  },
                ],
              },
            })
          ).body;
          const kitchen = await h.staff('restaurant_staff', restaurant.tenantId);
          await h.http('POST', `/restaurant/orders/${order.id}/accept`, {
            token: kitchen,
            body: { prepMinutes: 10 },
          });

          // C14: after acceptance, cancelling is a request.
          expect(
            (await h.http('POST', `/orders/${order.id}/cancel`, { token: customer })).body.error,
          ).toBe('invalid_transition');
          const req = await h.http('POST', `/orders/${order.id}/cancel-request`, {
            token: customer,
            body: { reason: 'Ordered by mistake' },
          });
          expect(req.body[0]).toMatchObject({ type: 'cancel_request', status: 'open' });
          expect(
            (
              await h.http('POST', `/orders/${order.id}/cancel-request`, {
                token: customer,
                body: { reason: 'Again' },
              })
            ).body.error,
          ).toBe('case_open');
          // Nothing paid yet on a cash order: nothing to refund.
          const c = (await h.http('GET', '/admin/cases', { token: dispatcher })).body.find(
            (x: { order: { id: string } | null }) => x.order?.id === order.id,
          );
          expect(c.order.refundableCents).toBe(0);

          // R13: the rider's emergency contact, stored encrypted.
          const profile = await h.http('POST', '/rider/profile/emergency-contact', {
            token: rider.token,
            body: { name: 'Sunila Silva', phone: '0771112233' },
          });
          expect(profile.body.emergencyContact).toEqual({
            name: 'Sunila Silva',
            phone: '+94771112233',
          });

          // RID-14: emergency with a location rings for the office.
          const sos = await h.http('POST', '/rider/emergency', {
            token: rider.token,
            body: { type: 'emergency', lat: 9.66, lng: 80.02 },
          });
          expect(sos.status).toBe(201);
          const alert = (
            await h.http('GET', '/me/notifications', { token: dispatcher })
          ).body.items.find((n: { kind: string }) => n.kind === 'rider_emergency');
          expect(alert).toMatchObject({ title: expect.stringContaining('Roshan Silva') });
          expect(h.lastSms('+94771112233')).toMatch(
            /Roshan pressed the emergency button.*maps\.google\.com\/\?q=9\.66000,80\.02000/,
          );
          const sosCase = (
            await h.http('GET', `/admin/cases/${sos.body.id}`, { token: dispatcher })
          ).body;
          expect(sosCase).toMatchObject({ type: 'emergency', location: { lat: 9.66, lng: 80.02 } });
          // Customers can't reach the office queue.
          expect((await h.http('GET', '/admin/cases', { token: customer })).status).toBe(403);
        }),
      ),
    180_000,
  );
});
