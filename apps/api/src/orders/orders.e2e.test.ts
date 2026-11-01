/*
 * Customer ordering over HTTP (Milestone 2): browse, menu, quote, place, view, cancel, timers.
 * Real app on a rolled-back transaction; fixtures sit in Jaffna, away from the seeded demo data.
 */
import { SETTINGS_SEED_DEFAULTS, deliveryFee, haversineMeters } from '@oyo/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDb, inRollback, testDatabaseUrl } from '../db/testing.js';
import { fixtureRestaurant, withHarness, type Harness } from '../testing/harness.js';
import { ORDER_QUEUES } from './orders.service.js';

afterAll(closeTestDb);

const NEAR = { lat: 9.665, lng: 80.0255 }; // about 390 m north of the fixture
const FAR = { lat: 9.85, lng: 80.0255 }; // about 21 km away

async function addAddress(h: Harness, token: string, at = NEAR) {
  const res = await h.http('POST', '/me/addresses', {
    token,
    body: { label: 'Home', ...at, addressText: '12 Temple Road', note: 'Blue gate' },
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe.skipIf(!testDatabaseUrl)('customer ordering', () => {
  it('lists nearby restaurants and shows the menu with fee and ETA', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const r = await fixtureRestaurant(tx);
        const token = await h.customer('+94771000001');

        const list = await h.http('GET', `/restaurants?lat=${NEAR.lat}&lng=${NEAR.lng}`, { token });
        expect(list.status).toBe(200);
        expect(list.body.map((x: { id: string }) => x.id)).toEqual([r.tenantId]);
        const route = Math.round(haversineMeters(r.point, NEAR) * 1.3);
        expect(list.body[0]).toMatchObject({
          isOpen: true,
          cuisines: ['Kottu', 'Rice'],
          deliveryFeeCents: deliveryFee(route, SETTINGS_SEED_DEFAULTS.deliveryFee),
        });

        expect(
          (await h.http('GET', `/restaurants?lat=${FAR.lat}&lng=${FAR.lng}`, { token })).body,
        ).toEqual([]);
        expect(
          (await h.http('GET', `/restaurants?lat=${NEAR.lat}&lng=${NEAR.lng}&q=kottu`, { token }))
            .body,
        ).toHaveLength(1);
        expect(
          (await h.http('GET', `/restaurants?lat=${NEAR.lat}&lng=${NEAR.lng}&q=pizza`, { token }))
            .body,
        ).toHaveLength(0);
        expect(
          (
            await h.http('GET', `/restaurants?lat=${NEAR.lat}&lng=${NEAR.lng}&cuisine=Rice`, {
              token,
            })
          ).body,
        ).toHaveLength(1);

        const page = await h.http(
          'GET',
          `/restaurants/${r.tenantId}?lat=${NEAR.lat}&lng=${NEAR.lng}`,
          { token },
        );
        const names = page.body.categories[0].items.map((i: { name: string }) => i.name);
        expect(names).toEqual(['Chicken Kottu', 'Mutton Kottu']); // unapproved item hidden
        expect(page.body.categories[0].items[1].soldOut).toBe(true);
        expect(
          page.body.categories[0].items[0].groups.map((g: { name: string }) => g.name),
        ).toEqual(['Spice level', 'Add-ons']);
        expect(page.body.eta.max - page.body.eta.min).toBe(10);
        expect((await h.http('GET', '/restaurants/not-a-uuid', { token })).status).toBe(404);
      }),
    ));

  it('prices on the server and enforces menu rules', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const r = await fixtureRestaurant(tx);
        const token = await h.customer('+94771000002');
        const addressId = await addAddress(h, token);
        const draft = (items: unknown[]) => ({ restaurantId: r.tenantId, addressId, items });
        const kottu = (modifierIds: string[], quantity = 2) => ({
          menuItemId: r.items.kottu,
          quantity,
          modifierIds,
        });

        const quote = await h.http('POST', '/orders/quote', {
          token,
          body: draft([kottu([r.modifiers.hot, r.modifiers.cheese])]),
        });
        expect(quote.status).toBe(200);
        const fee = deliveryFee(
          Math.round(haversineMeters(r.point, NEAR) * 1.3),
          SETTINGS_SEED_DEFAULTS.deliveryFee,
        );
        expect(quote.body).toMatchObject({
          itemsCents: 2 * (135_000 + 15_000),
          deliveryFeeCents: fee,
          totalCents: 300_000 + fee,
          paymentMethods: ['cod', 'bank_transfer'],
        });

        const error = async (body: unknown) =>
          (await h.http('POST', '/orders/quote', { token, body })).body.error;
        expect(await error(draft([kottu([])]))).toBe('modifier_invalid'); // spice is required
        expect(await error(draft([kottu([r.modifiers.mild, r.modifiers.hot])]))).toBe(
          'modifier_invalid',
        ); // max 1
        expect(
          await error(draft([{ menuItemId: r.items.soldOut, quantity: 1, modifierIds: [] }])),
        ).toBe('item_unavailable');
        expect(
          await error(draft([{ menuItemId: r.items.pending, quantity: 1, modifierIds: [] }])),
        ).toBe('item_unavailable');
        expect(await error({ ...draft([kottu([r.modifiers.hot])]), totalCents: 1 })).toBe(
          'validation_failed',
        );

        const farAddress = await addAddress(h, token, FAR);
        expect(await error({ ...draft([kottu([r.modifiers.hot])]), addressId: farAddress })).toBe(
          'out_of_range',
        );
      }),
    ));

  it('places a COD order once per idempotency key and keeps it private', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const r = await fixtureRestaurant(tx);
        const token = await h.customer('+94771000003');
        const addressId = await addAddress(h, token);
        const body = {
          restaurantId: r.tenantId,
          addressId,
          paymentMethod: 'cod',
          items: [
            {
              menuItemId: r.items.kottu,
              quantity: 1,
              modifierIds: [r.modifiers.mild],
              note: 'No onions',
            },
          ],
        };

        expect((await h.http('POST', '/orders', { token, body })).body.error).toBe(
          'idempotency_key_required',
        );
        const first = await h.http('POST', '/orders', { token, body, key: 'order-key-0001' });
        const retry = await h.http('POST', '/orders', { token, body, key: 'order-key-0001' });
        expect(first.status).toBe(201);
        expect(retry.body.id).toBe(first.body.id);
        expect(retry.headers.get('idempotent-replayed')).toBe('true');
        expect(first.body).toMatchObject({
          status: 'awaiting_restaurant',
          stage: 'confirmed',
          canCancel: true,
          deliveryAddress: { addressText: '12 Temple Road', note: 'Blue gate' },
          lines: [
            {
              name: 'Chicken Kottu',
              quantity: 1,
              note: 'No onions',
              modifiers: [{ name: 'Mild', priceCents: 0 }],
            },
          ],
        });
        expect(first.body.reference).toMatch(/^[A-Z2-9]{6}$/);
        expect(first.body.timeline.map((e: { type: string }) => e.type)).toEqual(['placed']);
        expect(h.jobs.sent).toEqual([
          { queue: ORDER_QUEUES.restaurantTimeout, data: { orderId: first.body.id }, seconds: 300 },
        ]);

        const list = await h.http('GET', '/orders', { token });
        expect(list.body).toHaveLength(1);
        expect(list.body[0]).toMatchObject({
          id: first.body.id,
          itemCount: 1,
          restaurant: { name: 'Fixture Kitchen' },
        });

        const stranger = await h.customer('+94771000004');
        expect((await h.http('GET', `/orders/${first.body.id}`, { token: stranger })).status).toBe(
          404,
        );
        expect(
          (await h.http('POST', `/orders/${first.body.id}/cancel`, { token: stranger })).status,
        ).toBe(404);
      }),
    ));

  it('lets the customer cancel before the restaurant accepts, once', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const r = await fixtureRestaurant(tx);
        const token = await h.customer('+94771000005');
        const addressId = await addAddress(h, token);
        const placed = await h.http('POST', '/orders', {
          token,
          key: 'order-key-0002',
          body: {
            restaurantId: r.tenantId,
            addressId,
            paymentMethod: 'cod',
            items: [{ menuItemId: r.items.kottu, quantity: 1, modifierIds: [r.modifiers.hot] }],
          },
        });
        const cancelled = await h.http('POST', `/orders/${placed.body.id}/cancel`, { token });
        expect(cancelled.body).toMatchObject({
          status: 'cancelled',
          stage: null,
          canCancel: false,
        });
        expect(cancelled.body.timeline.map((e: { type: string }) => e.type)).toEqual([
          'placed',
          'cancelled_by_customer',
        ]);
        expect(
          (await h.http('POST', `/orders/${placed.body.id}/cancel`, { token })).body.error,
        ).toBe('invalid_transition');

        // The restaurant timer later finds nothing to do.
        await h.jobs.runAll(ORDER_QUEUES.restaurantTimeout);
        expect((await h.http('GET', `/orders/${placed.body.id}`, { token })).body.status).toBe(
          'cancelled',
        );
      }),
    ));

  it('runs the restaurant and payment timers', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const r = await fixtureRestaurant(tx);
        const token = await h.customer('+94771000006');
        const addressId = await addAddress(h, token);
        const place = (paymentMethod: string, key: string) =>
          h.http('POST', '/orders', {
            token,
            key,
            body: {
              restaurantId: r.tenantId,
              addressId,
              paymentMethod,
              items: [{ menuItemId: r.items.kottu, quantity: 1, modifierIds: [r.modifiers.hot] }],
            },
          });

        const cod = await place('cod', 'order-key-0003');
        const bank = await place('bank_transfer', 'order-key-0004');
        expect(bank.body).toMatchObject({ status: 'awaiting_payment', stage: 'placed' });
        expect(h.jobs.sent.find((j) => j.queue === ORDER_QUEUES.paymentTimeout)?.seconds).toBe(
          1800,
        );

        await h.jobs.runAll(ORDER_QUEUES.restaurantTimeout);
        await h.jobs.runAll(ORDER_QUEUES.paymentTimeout);
        expect((await h.http('GET', `/orders/${cod.body.id}`, { token })).body.status).toBe(
          'rejected',
        );
        expect((await h.http('GET', `/orders/${bank.body.id}`, { token })).body.status).toBe(
          'cancelled',
        );
      }),
    ));

  it('caps open orders at 3 per customer', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const r = await fixtureRestaurant(tx);
        const token = await h.customer('+94771000007');
        const addressId = await addAddress(h, token);
        const place = (key: string) =>
          h.http('POST', '/orders', {
            token,
            key,
            body: {
              restaurantId: r.tenantId,
              addressId,
              paymentMethod: 'cod',
              items: [{ menuItemId: r.items.kottu, quantity: 1, modifierIds: [r.modifiers.hot] }],
            },
          });
        for (const key of ['cap-key-0001', 'cap-key-0002', 'cap-key-0003'])
          expect((await place(key)).status).toBe(201);
        expect((await place('cap-key-0004')).body).toMatchObject({
          error: 'too_many_open_orders',
          limit: 3,
        });
      }),
    ));
});
