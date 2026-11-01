/*
 * The restaurant face over HTTP (T01-T06): board, accept, delay, ready, reject with sold-out
 * items, the Open switch, and isolation between restaurants (tenant RLS).
 */
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../db/client.js';
import { closeTestDb, inRollback, testDatabaseUrl } from '../db/testing.js';
import { fixtureRestaurant, withHarness, type Harness } from '../testing/harness.js';

afterAll(closeTestDb);

async function setup(h: Harness, tx: Tx) {
  const r = await fixtureRestaurant(tx);
  const customer = await h.customer('+94774000001');
  await tx.execute(
    sql`update accounts set display_name = 'Nimali Fernando' where phone_hash is not null and display_name = ''`,
  );
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
  let n = 0;
  const place = async (paymentMethod = 'cod', menuItemId = r.items.kottu) => {
    const res = await h.http('POST', '/orders', {
      token: customer,
      key: `rest-key-${++n}-0000`,
      body: {
        restaurantId: r.tenantId,
        addressId: address.body.id,
        paymentMethod,
        items: [
          { menuItemId, quantity: 2, modifierIds: [r.modifiers.hot], note: 'No chilli in one' },
        ],
      },
    });
    expect(res.status).toBe(201);
    return res.body as { id: string; reference: string };
  };
  const kitchen = await h.staff('restaurant_staff', r.tenantId);
  return { r, customer, place, kitchen };
}

describe.skipIf(!testDatabaseUrl)('restaurant orders', () => {
  it('runs an order from new to ready, and the customer sees each step', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const { customer, place, kitchen } = await setup(h, tx);
        const order = await place();
        await place('bank_transfer'); // unpaid: never shown to the kitchen

        const board = (await h.http('GET', '/restaurant/board', { token: kitchen })).body;
        expect(board.restaurant).toMatchObject({ name: 'Fixture Kitchen', open: true });
        expect(board.new).toHaveLength(1);
        expect(board.new[0]).toMatchObject({
          id: order.id,
          customerFirstName: 'Nimali',
          paid: false,
          itemCount: 2,
          lines: [
            { name: 'Chicken Kottu', quantity: 2, modifiers: ['Hot'], note: 'No chilli in one' },
          ],
        });
        expect(
          new Date(board.new[0].respondBy).getTime() - new Date(board.new[0].placedAt).getTime(),
        ).toBeGreaterThan(299_000);
        // No phone or address reaches the restaurant (section 6).
        expect(JSON.stringify(board)).not.toMatch(/Temple Road|Blue gate|\+9477/);

        const act = (path: string, body?: unknown) =>
          h.http('POST', `/restaurant/orders/${order.id}/${path}`, { token: kitchen, body });
        expect((await act('accept', { prepMinutes: 2 })).body.error).toBe('validation_failed');
        expect((await act('accept', { prepMinutes: 20 })).status).toBe(204);
        expect((await act('accept', { prepMinutes: 20 })).body.error).toBe('invalid_transition');
        expect((await act('delay', { minutes: 5 })).status).toBe(204);

        const preparing = (await h.http('GET', '/restaurant/board', { token: kitchen })).body
          .preparing[0];
        expect(preparing).toMatchObject({ id: order.id, prepMinutes: 25 });
        const seen = (await h.http('GET', `/orders/${order.id}`, { token: customer })).body;
        expect(seen.stage).toBe('preparing');
        expect(new Date(seen.readyBy).getTime() - new Date(preparing.acceptedAt).getTime()).toBe(
          25 * 60_000,
        );

        expect((await act('ready')).status).toBe(204);
        expect(
          (await h.http('GET', '/restaurant/board', { token: kitchen })).body.ready[0].id,
        ).toBe(order.id);
        expect((await h.http('GET', `/orders/${order.id}`, { token: customer })).body.stage).toBe(
          'ready',
        );
        expect((await act('delay', { minutes: 5 })).body.error).toBe('invalid_transition');
      }),
    ));

  it('rejects with a reason and marks the missing item sold out', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const { r, customer, place, kitchen } = await setup(h, tx);
        const order = await place();
        const res = await h.http('POST', `/restaurant/orders/${order.id}/reject`, {
          token: kitchen,
          body: { reason: 'item_unavailable', soldOutItemIds: [r.items.kottu] },
        });
        expect(res.status).toBe(204);
        expect((await h.http('GET', `/orders/${order.id}`, { token: customer })).body.status).toBe(
          'rejected',
        );
        const [item] = (
          await tx.execute<{ sold_out: boolean }>(
            sql`select sold_out from menu_items where id = ${r.items.kottu}`,
          )
        ).rows;
        expect(item!.sold_out).toBe(true);
        const board = (await h.http('GET', '/restaurant/board', { token: kitchen })).body;
        expect(board.done.map((o: { id: string }) => o.id)).toContain(order.id);
      }),
    ));

  it('keeps restaurants out of each other’s orders, and customers out of the kitchen', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const { customer, place } = await setup(h, tx);
        const order = await place();
        const other = await fixtureRestaurant(tx, { lat: 9.7, lng: 80.0 }, 'Other Kitchen');
        const otherKitchen = await h.staff('restaurant_staff', other.tenantId);

        expect(
          (await h.http('GET', '/restaurant/board', { token: otherKitchen })).body.new,
        ).toEqual([]);
        const accept = await h.http('POST', `/restaurant/orders/${order.id}/accept`, {
          token: otherKitchen,
          body: { prepMinutes: 20 },
        });
        expect(accept.status).toBe(404);
        expect((await h.http('GET', '/restaurant/board', { token: customer })).status).toBe(403);
      }),
    ));

  it('stops new orders while the Open switch is off', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const { r, customer, place } = await setup(h, tx);
        const owner = await h.staff('restaurant_owner', r.tenantId);
        expect(
          (await h.http('POST', '/restaurant/status', { token: owner, body: { open: false } }))
            .status,
        ).toBe(204);
        expect(
          (await h.http('GET', '/restaurant/board', { token: owner })).body.restaurant.open,
        ).toBe(false);
        const list = await h.http('GET', `/restaurants?lat=9.665&lng=80.0255`, { token: customer });
        expect(list.body.find((x: { id: string }) => x.id === r.tenantId).isOpen).toBe(false);

        await h.http('POST', '/restaurant/status', { token: owner, body: { open: true } });
        await place();
      }),
    ));
});
