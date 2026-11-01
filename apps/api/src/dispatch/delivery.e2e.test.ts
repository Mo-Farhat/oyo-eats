/*
 * One delivery end to end over HTTP across all four faces: customer orders, restaurant accepts,
 * dispatch offers (soft lock, eligibility, decline, expiry), rider accepts, picks up and delivers
 * with cash. Plus the three-misses rule.
 */
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../db/client.js';
import { accounts } from '../db/schema.js';
import { encrypt } from '../common/crypto.js';
import type { Config } from '../config.js';
import { closeTestDb, inRollback, testDatabaseUrl } from '../db/testing.js';
import { CONFIG } from '../tokens.js';
import { fixtureRestaurant, withHarness, type Harness } from '../testing/harness.js';
import { DISPATCH_QUEUES } from './dispatch.service.js';

afterAll(closeTestDb);

async function rider(h: Harness, tx: Tx, name: string, at: { lat: number; lng: number }) {
  const token = await h.staff('rider');
  const me = await h.http('GET', '/auth/me', { token });
  await tx
    .update(accounts)
    .set({
      displayName: name,
      phoneCiphertext: encrypt(h.app.get<Config>(CONFIG).encryptionKey, '+94771110000'),
    })
    .where(eq(accounts.id, me.body.accountId));
  await tx.execute(
    sql`insert into riders (account_id, vehicle_type, plate) values (${me.body.accountId}, 'motorbike', 'WP ABC-1234')`,
  );
  expect((await h.http('POST', '/rider/status', { token, body: { online: true } })).status).toBe(
    204,
  );
  expect(
    (await h.http('POST', '/rider/location', { token, body: { ...at, batteryPercent: 80 } }))
      .status,
  ).toBe(204);
  return { token, id: me.body.accountId as string };
}

async function readyToAssign(h: Harness, tx: Tx) {
  const r = await fixtureRestaurant(tx);
  const customer = await h.customer('+94775000001');
  const address = await h.http('POST', '/me/addresses', {
    token: customer,
    body: {
      label: 'Home',
      lat: 9.665,
      lng: 80.0255,
      addressText: '12 Temple Road',
      note: 'Blue gate',
    },
  });
  const order = (
    await h.http('POST', '/orders', {
      token: customer,
      key: 'delivery-key-0001',
      body: {
        restaurantId: r.tenantId,
        addressId: address.body.id,
        paymentMethod: 'cod',
        items: [{ menuItemId: r.items.kottu, quantity: 1, modifierIds: [r.modifiers.hot] }],
      },
    })
  ).body;
  const kitchen = await h.staff('restaurant_staff', r.tenantId);
  expect(
    (
      await h.http('POST', `/restaurant/orders/${order.id}/accept`, {
        token: kitchen,
        body: { prepMinutes: 15 },
      })
    ).status,
  ).toBe(204);
  return { r, customer, order, kitchen };
}

describe.skipIf(!testDatabaseUrl)('a delivery end to end', () => {
  it(
    'goes from order to delivered with dispatch rules enforced on the way',
    () =>
      inRollback((tx) =>
        withHarness(tx, async (h) => {
          const { customer, order, kitchen } = await readyToAssign(h, tx);
          const near = await rider(h, tx, 'Kasun Perera', { lat: 9.6625, lng: 80.0255 });
          const far = await rider(h, tx, 'Dinesh Silva', { lat: 9.7, lng: 80.0255 });
          const dispatcher = await h.staff('dispatcher');
          const other = await h.staff('dispatcher');

          const board = (await h.http('GET', '/admin/board', { token: dispatcher })).body;
          // The shared dev database can hold other open orders; look only at this one.
          expect(board.unassigned.map((o: { id: string }) => o.id)).toContain(order.id);
          expect((await h.http('GET', '/admin/board', { token: customer })).status).toBe(403);

          // Candidates: eligible, nearest first.
          const candidates = (
            await h.http('GET', `/admin/orders/${order.id}/candidates`, { token: dispatcher })
          ).body;
          expect(candidates.slice(0, 2).map((c: { id: string }) => c.id)).toEqual([
            near.id,
            far.id,
          ]);
          expect(candidates[0]).toMatchObject({ eligible: true, activeJobs: 0, cashHeldCents: 0 });

          // The first dispatcher holds a 30 s lock; a second one is refused.
          expect(
            (await h.http('POST', `/admin/orders/${order.id}/lock`, { token: dispatcher })).status,
          ).toBe(200);
          expect(
            (await h.http('POST', `/admin/orders/${order.id}/lock`, { token: other })).body.error,
          ).toBe('locked');
          expect(
            (
              await h.http('POST', `/admin/orders/${order.id}/offer`, {
                token: other,
                body: { riderId: near.id },
              })
            ).body.error,
          ).toBe('locked');

          // Offer to the nearest rider, who declines: never offered this order again.
          const offer1 = (
            await h.http('POST', `/admin/orders/${order.id}/offer`, {
              token: dispatcher,
              body: { riderId: near.id },
            })
          ).body;
          const seen = (await h.http('GET', '/rider/state', { token: near.token })).body;
          expect(seen.offer).toMatchObject({
            id: offer1.offerId,
            reference: order.reference,
            itemCount: 1,
          });
          expect(seen.offer.payoutCents).toBe(
            Math.round((order.deliveryFeeCents * 0.9) / 100) * 100,
          );
          expect(JSON.stringify(seen)).not.toMatch(/Temple Road|Blue gate|\+9477/); // area only before accepting
          expect(
            (
              await h.http('POST', `/rider/offers/${offer1.offerId}/decline`, {
                token: near.token,
                body: { reason: 'too_far' },
              })
            ).status,
          ).toBe(204);
          const again = await h.http('POST', `/admin/orders/${order.id}/offer`, {
            token: dispatcher,
            body: { riderId: near.id },
          });
          expect(again.body).toMatchObject({ error: 'rider_not_eligible', reasons: ['declined'] });

          // Offer to the second rider; it times out, then is offered again and accepted.
          const offer2 = (
            await h.http('POST', `/admin/orders/${order.id}/offer`, {
              token: dispatcher,
              body: { riderId: far.id },
            })
          ).body;
          await h.jobs.runAll(DISPATCH_QUEUES.offerExpire);
          expect(
            (await h.http('POST', `/rider/offers/${offer2.offerId}/accept`, { token: far.token }))
              .body.error,
          ).toBe('invalid_transition');
          const offer3 = (
            await h.http('POST', `/admin/orders/${order.id}/offer`, {
              token: dispatcher,
              body: { riderId: far.id },
            })
          ).body;
          expect(
            (await h.http('POST', `/rider/offers/${offer3.offerId}/accept`, { token: far.token }))
              .status,
          ).toBe(204);
          expect(
            (await h.http('POST', '/rider/status', { token: far.token, body: { online: false } }))
              .body.error,
          ).toBe('rider_busy');

          // Accepted: the rider now sees the customer's contact details (SEC-12).
          const job = (await h.http('GET', '/rider/state', { token: far.token })).body.jobs[0];
          expect(job).toMatchObject({
            orderId: order.id,
            collectCents: order.totalCents,
            customer: { address: '12 Temple Road', note: 'Blue gate', phone: '+94775000001' },
          });
          expect(
            (await h.http('GET', `/orders/${order.id}`, { token: customer })).body,
          ).toMatchObject({
            stage: 'rider_assigned',
            rider: { name: 'Dinesh', plate: 'WP ABC-1234', phone: '+94771110000' },
          });

          // Pickup needs the food ready; then deliver with the cash.
          expect(
            (await h.http('POST', `/rider/orders/${order.id}/pickup`, { token: far.token })).body
              .error,
          ).toBe('invalid_transition');
          await h.http('POST', `/restaurant/orders/${order.id}/ready`, { token: kitchen });
          expect(
            (await h.http('POST', `/rider/orders/${order.id}/pickup`, { token: far.token })).status,
          ).toBe(204);
          expect(
            (
              await h.http('POST', `/rider/orders/${order.id}/deliver`, {
                token: near.token,
                body: {},
              })
            ).status,
          ).toBe(404);
          const deliver = (body: unknown) =>
            h.http('POST', `/rider/orders/${order.id}/deliver`, { token: far.token, body });
          expect((await deliver({})).body.error).toBe('cash_required');
          expect((await deliver({ cashCollectedCents: order.totalCents - 100 })).body.error).toBe(
            'variance_reason_required',
          );
          expect((await deliver({ cashCollectedCents: order.totalCents })).status).toBe(204);

          expect(
            (await h.http('GET', `/orders/${order.id}`, { token: customer })).body,
          ).toMatchObject({ status: 'delivered', canRate: true, rider: { phone: null } });
          const after = (await h.http('GET', '/rider/state', { token: far.token })).body;
          expect(after).toMatchObject({ jobs: [], cashHeldCents: order.totalCents });
          expect(
            (await h.http('GET', '/admin/board', { token: dispatcher })).body.doneToday.map(
              (o: { id: string }) => o.id,
            ),
          ).toContain(order.id);
          const types = (
            await h.http('GET', `/orders/${order.id}`, { token: customer })
          ).body.timeline.map((e: { type: string }) => e.type);
          expect(types).toEqual([
            'placed',
            'restaurant_accepted',
            'offer_sent',
            'offer_declined',
            'offer_sent',
            'offer_expired',
            'offer_sent',
            'offer_accepted',
            'marked_ready',
            'picked_up',
            'delivered',
          ]);
        }),
      ),
    120_000,
  );

  it(
    'takes a rider offline after three missed offers in a row',
    () =>
      inRollback((tx) =>
        withHarness(tx, async (h) => {
          const { order } = await readyToAssign(h, tx);
          const r = await rider(h, tx, 'Sunil Fernando', { lat: 9.6625, lng: 80.0255 });
          const dispatcher = await h.staff('dispatcher');
          for (let i = 0; i < 3; i++) {
            expect(
              (
                await h.http('POST', `/admin/orders/${order.id}/offer`, {
                  token: dispatcher,
                  body: { riderId: r.id },
                })
              ).status,
            ).toBe(201);
            await h.jobs.runAll(DISPATCH_QUEUES.offerExpire);
          }
          expect((await h.http('GET', '/rider/state', { token: r.token })).body).toMatchObject({
            online: false,
            consecutiveMisses: 3,
          });
          const c = (
            await h.http('GET', `/admin/orders/${order.id}/candidates`, { token: dispatcher })
          ).body.find((x: { id: string }) => x.id === r.id);
          expect(c).toMatchObject({ eligible: false, reasons: ['offline'] });
        }),
      ),
    120_000,
  );
});
