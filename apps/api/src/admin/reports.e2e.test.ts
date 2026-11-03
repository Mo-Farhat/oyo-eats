/*
 * A19 reports (ADM-17) and the audit log (SEC-31): figures for a period, per restaurant and rider,
 * owner only.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDb, inRollback, testDatabaseUrl } from '../db/testing.js';
import { deliveredCodOrder, onlineRider } from '../testing/flows.js';
import { fixtureRestaurant, withHarness } from '../testing/harness.js';

afterAll(closeTestDb);

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });

describe.skipIf(!testDatabaseUrl)('reports', () => {
  it(
    'reports a delivery in the period, for the owner only',
    () =>
      inRollback((tx) =>
        withHarness(tx, async (h) => {
          const owner = await h.staff('owner');
          const dispatcher = await h.staff('dispatcher');
          const rider = await onlineRider(h, tx, dispatcher, 'Report Rider', '+94771239999');
          const restaurant = await fixtureRestaurant(tx);
          const { order } = await deliveredCodOrder(h, tx, {
            dispatcher,
            rider,
            restaurant,
            customerPhone: '+94773000110',
            key: 'reports-0001',
          });
          const path = `/admin/reports?from=${today()}&to=${today()}`;
          expect((await h.http('GET', path, { token: dispatcher })).status).toBe(403);
          const r = (await h.http('GET', path, { token: owner })).body;
          expect(r.orders.delivered).toBeGreaterThanOrEqual(1);
          expect(r.money.grossCents).toBeGreaterThanOrEqual(order.totalCents);
          expect(
            r.restaurants.find((x: { id: string }) => x.id === restaurant.tenantId),
          ).toMatchObject({
            delivered: 1,
            foodCents: order.itemsCents + order.restaurantFeeCents,
          });
          expect(r.riders.find((x: { id: string }) => x.id === rider.id)).toMatchObject({
            delivered: 1,
          });
          expect(r.position.cashWithRidersCents).toBeGreaterThanOrEqual(order.totalCents);
          expect(r.times.avgDeliveryMinutes).not.toBeNull();
          expect(
            (
              await h.http('GET', `/admin/reports/csv?from=${today()}&to=${today()}`, {
                token: owner,
              })
            ).body,
          ).toContain('Fixture Kitchen');
          expect(
            (await h.http('GET', '/admin/reports?from=2026-01-01&to=2026-12-31', { token: owner }))
              .body.error,
          ).toBe('invalid_input');

          // Audit log: the rider's login creation is there, with who did it.
          expect((await h.http('GET', '/admin/audit', { token: dispatcher })).status).toBe(403);
          const audit = (await h.http('GET', '/admin/audit?action=account.', { token: owner }))
            .body;
          expect(audit).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ action: 'account.created', role: 'dispatcher' }),
            ]),
          );
        }),
      ),
    120_000,
  );
});
