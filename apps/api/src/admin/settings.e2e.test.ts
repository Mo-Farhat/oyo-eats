/*
 * A20 settings (ADM-18): owner only, bounded, audited, and new quotes use the new values at once.
 */
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDb, inRollback, testDatabaseUrl } from '../db/testing.js';
import { fixtureRestaurant, withHarness } from '../testing/harness.js';

afterAll(closeTestDb);

describe.skipIf(!testDatabaseUrl)('settings', () => {
  it(
    'lets the owner change pricing for new orders',
    () =>
      inRollback((tx) =>
        withHarness(tx, async (h) => {
          const owner = await h.staff('owner');
          const dispatcher = await h.staff('dispatcher');
          expect((await h.http('GET', '/admin/settings', { token: dispatcher })).status).toBe(403);
          const current = (await h.http('GET', '/admin/settings', { token: owner })).body;
          expect(current.deliveryFee).toMatchObject({ baseFeeCents: expect.any(Number) });

          const r = await fixtureRestaurant(tx);
          const customer = await h.customer('+94773000060');
          const address = await h.http('POST', '/me/addresses', {
            token: customer,
            body: { label: 'Home', lat: 9.665, lng: 80.0255, addressText: '1 Main Street' },
          });
          const quote = () =>
            h.http('POST', '/orders/quote', {
              token: customer,
              body: {
                restaurantId: r.tenantId,
                addressId: address.body.id,
                items: [{ menuItemId: r.items.kottu, quantity: 1, modifierIds: [r.modifiers.hot] }],
              },
            });
          const before = (await quote()).body.deliveryFeeCents;

          expect(
            (
              await h.http('PUT', '/admin/settings', {
                token: owner,
                body: { ...current, deliveryFee: { ...current.deliveryFee, baseFeeCents: -1 } },
              })
            ).status,
          ).toBe(400);
          const saved = await h.http('PUT', '/admin/settings', {
            token: owner,
            body: {
              ...current,
              deliveryFee: {
                ...current.deliveryFee,
                baseFeeCents: current.deliveryFee.baseFeeCents + 5_000,
              },
              dispatcherRefundCapCents: 100_000,
            },
          });
          expect(saved.status).toBe(200);
          expect((await quote()).body.deliveryFeeCents).toBe(before + 5_000);
          const [audit] = (
            await tx.execute<{ after: Record<string, unknown> }>(
              sql`select before, after from audit_log where action = 'settings.updated' order by id desc limit 1`,
            )
          ).rows;
          expect(Object.keys(audit!.after).sort()).toEqual([
            'deliveryFee',
            'dispatcherRefundCapCents',
          ]);

          // A minimum order applies to the next quote.
          await h.http('PUT', '/admin/settings', {
            token: owner,
            body: { ...saved.body, minimumOrderCents: 10_000_000 },
          });
          expect((await quote()).body.error).toBe('minimum_order');

          // Clearing an optional setting removes it.
          await h.http('PUT', '/admin/settings', {
            token: owner,
            body: { ...current, minimumOrderCents: null },
          });
          expect(
            (await h.http('GET', '/admin/settings', { token: owner })).body.minimumOrderCents,
          ).toBeNull();
        }),
      ),
    90_000,
  );
});
