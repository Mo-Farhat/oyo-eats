/*
 * T12: reviews with replies (RES-12), history and daily sales (RES-13), and the owner's own staff
 * logins (RES-01), each limited to the restaurant's own records.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDb, inRollback, testDatabaseUrl } from '../db/testing.js';
import { deliveredCodOrder, onlineRider } from '../testing/flows.js';
import { fixtureRestaurant, withHarness } from '../testing/harness.js';

afterAll(closeTestDb);

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });

describe.skipIf(!testDatabaseUrl)('restaurant insights and staff', () => {
  it(
    'lets a restaurant reply to reviews, see its sales and run its own staff',
    () =>
      inRollback((tx) =>
        withHarness(tx, async (h) => {
          const dispatcher = await h.staff('dispatcher');
          const rider = await onlineRider(h, tx, dispatcher);
          const restaurant = await fixtureRestaurant(tx);
          const other = await fixtureRestaurant(tx, { lat: 9.67, lng: 80.03 }, 'Other Kitchen');
          const { order, customer, kitchen } = await deliveredCodOrder(h, tx, {
            dispatcher,
            rider,
            restaurant,
            customerPhone: '+94773000090',
            key: 'insights-0001',
          });
          await h.http('PATCH', '/me/profile', {
            token: customer,
            body: { displayName: 'Nimal Fernando' },
          });
          expect(
            (
              await h.http('POST', `/orders/${order.id}/ratings`, {
                token: customer,
                body: { restaurant: { rating: 2, body: 'Too salty' } },
              })
            ).status,
          ).toBeLessThan(300);

          // RES-12: the kitchen sees it (first name only) and replies.
          const list = (await h.http('GET', '/restaurant/reviews', { token: kitchen })).body;
          expect(list).toMatchObject({ rating: 2, count: 1 });
          expect(list.reviews[0]).toMatchObject({
            author: 'Nimal',
            body: 'Too salty',
            orderReference: order.reference,
          });
          const otherKitchen = await h.staff('restaurant_staff', other.tenantId);
          expect(
            (
              await h.http('POST', `/restaurant/reviews/${list.reviews[0].id}/reply`, {
                token: otherKitchen,
                body: { reply: 'Not ours' },
              })
            ).status,
          ).toBe(404);
          await h.http('POST', `/restaurant/reviews/${list.reviews[0].id}/reply`, {
            token: kitchen,
            body: { reply: 'Sorry, Nimal. We have told the cook.' },
          });
          const publicReviews = (
            await h.http('GET', `/restaurants/${restaurant.tenantId}/reviews`, { token: customer })
          ).body;
          expect(publicReviews[0]).toMatchObject({ reply: 'Sorry, Nimal. We have told the cook.' });
          // The office can hide an abusive review.
          await h.http('POST', `/admin/reviews/${list.reviews[0].id}/hidden`, {
            token: dispatcher,
            body: { hidden: true },
          });
          expect(
            (
              await h.http('GET', `/restaurants/${restaurant.tenantId}/reviews`, {
                token: customer,
              })
            ).body,
          ).toEqual([]);

          // RES-13: today's sales.
          const history = (
            await h.http('GET', `/restaurant/history?from=${today()}&to=${today()}`, {
              token: kitchen,
            })
          ).body;
          expect(history.totals).toEqual({
            delivered: 1,
            salesCents: order.itemsCents + order.restaurantFeeCents,
            cancelled: 0,
          });
          expect(history.orders.map((o: { id: string }) => o.id)).toContain(order.id);
          const csv = await h.http('GET', `/restaurant/history/csv?from=${today()}&to=${today()}`, {
            token: kitchen,
          });
          expect(csv.body).toContain(order.reference);
          expect(
            (
              await h.http('GET', `/restaurant/history?from=2026-01-01&to=2026-12-31`, {
                token: kitchen,
              })
            ).body.error,
          ).toBe('invalid_input');
          expect(
            (
              await h.http('GET', `/restaurant/history?from=${today()}&to=${today()}`, {
                token: otherKitchen,
              })
            ).body.totals.delivered,
          ).toBe(0);

          // RES-01: the owner runs their own kitchen logins, and only those.
          const owner = await h.staff('restaurant_owner', restaurant.tenantId);
          expect((await h.http('GET', '/restaurant/staff', { token: kitchen })).status).toBe(403);
          const created = await h.http('POST', '/restaurant/staff', {
            token: owner,
            body: { displayName: 'Saman Kitchen' },
          });
          expect(created.status).toBe(201);
          const staff = (await h.http('GET', '/restaurant/staff', { token: owner })).body;
          expect(staff.every((a: { tenantId: string }) => a.tenantId === restaurant.tenantId)).toBe(
            true,
          );
          expect(staff.map((a: { id: string }) => a.id)).toContain(created.body.accountId);
          expect(
            (
              await h.http('POST', `/restaurant/staff/${created.body.accountId}/reset-password`, {
                token: owner,
              })
            ).status,
          ).toBe(201);
          // Not another restaurant's staff, and not another owner.
          const otherStaffId = (await h.http('GET', '/auth/me', { token: otherKitchen })).body
            .accountId;
          expect(
            (
              await h.http('POST', `/restaurant/staff/${otherStaffId}/reset-password`, {
                token: owner,
              })
            ).body.error,
          ).toBe('forbidden');
          const ownerTwo = await h.staff('restaurant_owner', restaurant.tenantId);
          const ownerTwoId = (await h.http('GET', '/auth/me', { token: ownerTwo })).body.accountId;
          expect(
            (
              await h.http('POST', `/restaurant/staff/${ownerTwoId}/status`, {
                token: owner,
                body: { active: false },
              })
            ).body.error,
          ).toBe('forbidden');
          // And not through the office routes either.
          expect(
            (
              await h.http('POST', '/admin/accounts', {
                token: owner,
                body: { role: 'restaurant_staff', displayName: 'Sneaky', tenantId: other.tenantId },
              })
            ).status,
          ).toBe(403);
        }),
      ),
    180_000,
  );
});
