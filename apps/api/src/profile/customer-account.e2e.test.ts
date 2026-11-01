/*
 * After the order (C12, C13, C15): ratings and reviews, receipts, profile, verified phone change,
 * and account deletion. Orders are marked delivered directly, as the restaurant and rider faces
 * that move them there come in later milestones.
 */
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../db/client.js';
import { closeTestDb, inRollback, testDatabaseUrl } from '../db/testing.js';
import { fixtureRestaurant, withHarness, type Harness } from '../testing/harness.js';

afterAll(closeTestDb);

async function placedOrder(h: Harness, tx: Tx, phone: string, key: string) {
  const r = await fixtureRestaurant(tx);
  const token = await h.customer(phone);
  const address = await h.http('POST', '/me/addresses', {
    token,
    body: {
      label: 'Home',
      lat: 9.665,
      lng: 80.0255,
      addressText: '12 Temple Road',
      note: 'Blue gate',
    },
  });
  const order = await h.http('POST', '/orders', {
    token,
    key,
    body: {
      restaurantId: r.tenantId,
      addressId: address.body.id,
      paymentMethod: 'cod',
      items: [
        {
          menuItemId: r.items.kottu,
          quantity: 2,
          modifierIds: [r.modifiers.hot],
          note: 'Call me at 0771234567',
        },
      ],
    },
  });
  expect(order.status).toBe(201);
  return { token, order: order.body, r };
}

const deliver = (tx: Tx, orderId: string, hoursAgo = 0) =>
  tx.execute(sql`
    update orders set status = 'delivered', kitchen_status = 'ready', delivery_status = 'assigned',
      closed_at = now() - make_interval(hours => ${hoursAgo})
    where id = ${orderId}`);

describe.skipIf(!testDatabaseUrl)('ratings and reviews', () => {
  it('rates a delivered order, edits it inside 24 hours, and shows it on the restaurant page', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const { token, order, r } = await placedOrder(h, tx, '+94773000001', 'rate-key-0001');
        const rate = (body: unknown) =>
          h.http('POST', `/orders/${order.id}/ratings`, { token, body });
        const good = {
          restaurant: { rating: 4, tags: ['Tasty', 'Hot & fresh'], body: 'A bit salty' },
        };

        expect((await rate(good)).body.error).toBe('rating_closed'); // not delivered yet
        await deliver(tx, order.id);
        expect((await rate(good)).status).toBe(204);
        expect((await rate({ restaurant: { rating: 5, tags: ['Tasty'] } })).status).toBe(204); // edit
        expect((await rate({ restaurant: { rating: 6 } })).body.error).toBe('validation_failed');
        expect((await rate({ restaurant: { rating: 5, tags: ['Amazing'] } })).body.error).toBe(
          'validation_failed',
        );
        expect((await rate({ ...good, rider: { rating: 5 } })).body).toMatchObject({
          error: 'not_found',
          what: 'rider',
        });

        const detail = (await h.http('GET', `/orders/${order.id}`, { token })).body;
        expect(detail.ratings).toEqual({
          restaurant: { rating: 5, tags: ['Tasty'], body: null },
          rider: null,
        });
        expect(detail.myRating).toBe(5);
        expect(detail.canRate).toBe(true);
        expect(new Date(detail.rateUntil).getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);

        await tx.execute(
          sql`update accounts set display_name = 'Nimali Fernando' where id = (select customer_id from orders where id = ${order.id})`,
        );
        const reviews = await h.http('GET', `/restaurants/${r.tenantId}/reviews`, { token });
        expect(reviews.body).toEqual([
          expect.objectContaining({ rating: 5, author: 'Nimali', tags: ['Tasty'] }),
        ]);
        const page = await h.http('GET', `/restaurants/${r.tenantId}`, { token });
        expect(page.body).toMatchObject({ rating: 5, ratingCount: 1 });

        const stranger = await h.customer('+94773000002');
        expect(
          (await h.http('POST', `/orders/${order.id}/ratings`, { token: stranger, body: good }))
            .status,
        ).toBe(404);
      }),
    ));

  it('locks ratings 24 hours after delivery', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const { token, order } = await placedOrder(h, tx, '+94773000003', 'rate-key-0002');
        await deliver(tx, order.id, 25);
        const res = await h.http('POST', `/orders/${order.id}/ratings`, {
          token,
          body: { restaurant: { rating: 3 } },
        });
        expect(res.body.error).toBe('rating_closed');
        expect((await h.http('GET', '/orders', { token })).body[0]).toMatchObject({
          canRate: false,
          myRating: null,
        });
      }),
    ));
});

describe.skipIf(!testDatabaseUrl)('receipts', () => {
  it('produces a PDF for delivered orders only', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const { token, order } = await placedOrder(h, tx, '+94773000004', 'receipt-key-0001');
        expect((await h.http('POST', `/orders/${order.id}/receipt`, { token })).body.error).toBe(
          'invalid_transition',
        );
        await deliver(tx, order.id);
        const res = await h.http('POST', `/orders/${order.id}/receipt`, { token });
        expect(res.body.url).toBe(`memory://receipts/${order.id}.pdf?ttl=300`);
        const file = h.storage.files.get(`receipts/${order.id}.pdf`)!;
        expect(file.contentType).toBe('application/pdf');
        expect(file.data.subarray(0, 5).toString()).toBe('%PDF-');
      }),
    ));
});

describe.skipIf(!testDatabaseUrl)('profile', () => {
  it('reads and edits the profile, and changes phone only after verifying the new number', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const token = await h.customer('+94773000005');
        expect((await h.http('GET', '/me/profile', { token })).body).toEqual({
          displayName: '',
          phone: '+94773000005',
          marketingOptIn: false,
          hasOpenOrders: false,
        });
        const updated = await h.http('PATCH', '/me/profile', {
          token,
          body: { displayName: 'Nimali', marketingOptIn: true },
        });
        expect(updated.body).toMatchObject({ displayName: 'Nimali', marketingOptIn: true });

        await h.customer('+94773000006');
        expect(
          (await h.http('POST', '/me/phone/request', { token, body: { phone: '0773000006' } })).body
            .error,
        ).toBe('phone_taken');
        expect(
          (await h.http('POST', '/me/phone/request', { token, body: { phone: '0773000005' } })).body
            .error,
        ).toBe('phone_unchanged');

        expect(
          (await h.http('POST', '/me/phone/request', { token, body: { phone: '0773000007' } }))
            .status,
        ).toBe(202);
        expect(
          (
            await h.http('POST', '/me/phone/verify', {
              token,
              body: { phone: '0773000007', code: '000000' },
            })
          ).body.error,
        ).toMatch(/otp_invalid|otp_locked/);
        const code = h.lastSms('+94773000007')!.match(/\d{6}/)![0];
        expect(
          (await h.http('POST', '/me/phone/verify', { token, body: { phone: '0773000007', code } }))
            .status,
        ).toBe(204);
        expect((await h.http('GET', '/me/profile', { token })).body.phone).toBe('+94773000007');
      }),
    ));

  it('blocks deletion during an open order, then deletes and anonymises', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const { token, order } = await placedOrder(h, tx, '+94773000008', 'delete-key-0001');
        expect((await h.http('DELETE', '/me', { token })).body.error).toBe('account_busy');
        await deliver(tx, order.id);
        await h.http('POST', `/orders/${order.id}/ratings`, {
          token,
          body: { restaurant: { rating: 4, body: 'Ask for Sunil' } },
        });

        expect((await h.http('DELETE', '/me', { token })).status).toBe(204);
        expect((await h.http('GET', '/me/profile', { token })).status).toBe(401);

        const [row] = (
          await tx.execute<Record<string, unknown>>(sql`
            select a.status, a.display_name, a.phone_ciphertext, a.phone_hash,
              o.delivery_address_ciphertext, o.delivery_note_ciphertext, ST_X(o.delivery_location) as lng,
              (select count(*)::int from customer_addresses where customer_id = a.id) as addresses,
              (select note from order_items where order_id = o.id limit 1) as item_note,
              (select body from reviews where order_id = o.id) as review_body,
              (select rating from reviews where order_id = o.id) as review_rating,
              o.total_cents::int as total_cents
            from orders o join accounts a on a.id = o.customer_id where o.id = ${order.id}`)
        ).rows;
        expect(row).toMatchObject({
          status: 'deactivated',
          display_name: '',
          phone_ciphertext: null,
          delivery_address_ciphertext: null,
          delivery_note_ciphertext: null,
          addresses: 0,
          item_note: null,
          review_body: null,
          review_rating: 4,
          total_cents: order.totalCents,
        });
        expect(String(row!.phone_hash)).toMatch(/^deleted:/);
        expect(Number(row!.lng)).toBe(80.03); // blurred to two decimals
      }),
    ));
});
