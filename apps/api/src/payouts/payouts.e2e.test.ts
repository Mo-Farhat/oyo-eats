/*
 * T11 restaurant payouts and R10 rider earnings: what each is owed after a delivery, owner-only
 * for restaurants, and nobody sees anyone else's statements.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDb, inRollback, testDatabaseUrl } from '../db/testing.js';
import { deliveredCodOrder, onlineRider } from '../testing/flows.js';
import { fixtureRestaurant, withHarness } from '../testing/harness.js';

afterAll(closeTestDb);

describe.skipIf(!testDatabaseUrl)('payouts and earnings', () => {
  it(
    'shows each party what it is owed',
    () =>
      inRollback((tx) =>
        withHarness(tx, async (h) => {
          const dispatcher = await h.staff('dispatcher');
          const rider = await onlineRider(h, tx, dispatcher);
          const restaurant = await fixtureRestaurant(tx);
          const { order } = await deliveredCodOrder(h, tx, {
            dispatcher,
            rider,
            restaurant,
            customerPhone: '+94773000070',
            key: 'payouts-0001',
          });
          const pay = Math.round((order.deliveryFeeCents * 0.9) / 100) * 100;

          const earnings = (await h.http('GET', '/rider/earnings', { token: rider.token })).body;
          expect(earnings).toMatchObject({
            today: { deliveries: 1, payCents: pay },
            week: { deliveries: 1, payCents: pay },
            owedCents: pay,
            recent: [{ orderId: order.id, payCents: pay, restaurantName: 'Fixture Kitchen' }],
          });

          const staff = await h.staff('restaurant_staff', restaurant.tenantId);
          expect((await h.http('GET', '/restaurant/payouts', { token: staff })).status).toBe(403);
          const owner = await h.staff('restaurant_owner', restaurant.tenantId);
          expect((await h.http('GET', '/restaurant/payouts', { token: owner })).body).toMatchObject(
            {
              pending: { orderCount: 1, amountCents: order.itemsCents + order.restaurantFeeCents },
            },
          );

          // Another restaurant's owner can't open this restaurant's statements.
          const other = await fixtureRestaurant(tx, { lat: 9.67, lng: 80.03 }, 'Other Kitchen');
          const otherOwner = await h.staff('restaurant_owner', other.tenantId);
          const anyStatement = (await h.http('GET', '/restaurant/payouts', { token: otherOwner }))
            .body;
          expect(anyStatement.pending.orderCount).toBe(0);
          expect((await h.http('GET', '/rider/earnings', { token: owner })).status).toBe(403);
        }),
      ),
    120_000,
  );
});
