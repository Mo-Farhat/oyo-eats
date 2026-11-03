/*
 * A18 customers (ADM-15): search by any local phone format or name, flag, COD eligibility applied at
 * checkout, and blocking (owner only) signing the customer out at once.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDb, inRollback, testDatabaseUrl } from '../db/testing.js';
import { fixtureRestaurant, withHarness } from '../testing/harness.js';

afterAll(closeTestDb);

describe.skipIf(!testDatabaseUrl)('customers', () => {
  it(
    'finds, flags, limits and blocks a customer',
    () =>
      inRollback((tx) =>
        withHarness(tx, async (h) => {
          const r = await fixtureRestaurant(tx);
          const customer = await h.customer('+94773000100');
          await h.http('PATCH', '/me/profile', {
            token: customer,
            body: { displayName: 'Kamala Testwick' },
          });
          const address = await h.http('POST', '/me/addresses', {
            token: customer,
            body: { label: 'Home', lat: 9.665, lng: 80.0255, addressText: '1 Main Street' },
          });
          const body = {
            restaurantId: r.tenantId,
            addressId: address.body.id,
            items: [{ menuItemId: r.items.kottu, quantity: 1, modifierIds: [r.modifiers.hot] }],
          };
          await h.http('POST', '/orders', {
            token: customer,
            key: 'customers-0001',
            body: { ...body, paymentMethod: 'cod' },
          });

          const dispatcher = await h.staff('dispatcher');
          const owner = await h.staff('owner');
          const byPhone = (
            await h.http('GET', '/admin/customers?q=077%20300%200100', { token: dispatcher })
          ).body;
          expect(byPhone).toEqual([
            expect.objectContaining({
              name: 'Kamala Testwick',
              phone: '+94773000100',
              orders: 1,
              codBlocked: false,
            }),
          ]);
          const id = byPhone[0].id;
          const byName = (await h.http('GET', '/admin/customers?q=testwick', { token: dispatcher }))
            .body;
          expect(byName.map((c: { id: string }) => c.id)).toContain(id);
          expect((await h.http('GET', '/admin/customers', { token: customer })).status).toBe(403);

          // Flag and take away COD: checkout offers bank transfer only.
          const flagged = (
            await h.http('POST', `/admin/customers/${id}/flag`, {
              token: dispatcher,
              body: { note: 'Two fake COD orders' },
            })
          ).body;
          expect(flagged).toMatchObject({
            flagNote: 'Two fake COD orders',
            recent: [expect.objectContaining({ restaurantName: 'Fixture Kitchen' })],
          });
          await h.http('POST', `/admin/customers/${id}/cod`, {
            token: dispatcher,
            body: { allowed: false },
          });
          const quote = (await h.http('POST', '/orders/quote', { token: customer, body })).body;
          expect(quote.paymentMethods).not.toContain('cod');
          expect(
            (
              await h.http('POST', '/orders', {
                token: customer,
                key: 'customers-0002',
                body: { ...body, paymentMethod: 'cod' },
              })
            ).body.error,
          ).toBe('payment_method_unavailable');

          // Blocking: owner only, needs a reason, signs them out at once.
          expect(
            (
              await h.http('POST', `/admin/customers/${id}/block`, {
                token: dispatcher,
                body: { blocked: true, reason: 'Abuse' },
              })
            ).status,
          ).toBe(403);
          expect(
            (
              await h.http('POST', `/admin/customers/${id}/block`, {
                token: owner,
                body: { blocked: true },
              })
            ).body.error,
          ).toBe('invalid_input');
          const blocked = (
            await h.http('POST', `/admin/customers/${id}/block`, {
              token: owner,
              body: { blocked: true, reason: 'Abused a rider' },
            })
          ).body;
          expect(blocked.blocked).toBe(true);
          expect((await h.http('GET', '/me/profile', { token: customer })).status).toBe(401);
          await h.http('POST', `/admin/customers/${id}/block`, {
            token: owner,
            body: { blocked: false },
          });
          expect(
            (await h.http('GET', `/admin/customers/${id}`, { token: dispatcher })).body.blocked,
          ).toBe(false);
        }),
      ),
    120_000,
  );
});
