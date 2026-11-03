/*
 * Restaurant menu and hours (T07-T10, RES-08 to RES-10) and approvals (A15, ADM-12): stock is
 * instant, new items and price changes wait for the owner, customers only ever see approved
 * values, and hours, closures and pauses apply at once.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDb, inRollback, testDatabaseUrl } from '../db/testing.js';
import { fixtureRestaurant, withHarness } from '../testing/harness.js';

afterAll(closeTestDb);

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });

describe.skipIf(!testDatabaseUrl)('restaurant menu and approvals', () => {
  it(
    'keeps customers on approved values until the owner decides',
    () =>
      inRollback((tx) =>
        withHarness(tx, async (h) => {
          const r = await fixtureRestaurant(tx);
          const other = await fixtureRestaurant(tx, { lat: 9.67, lng: 80.03 }, 'Other Kitchen');
          const kitchen = await h.staff('restaurant_staff', r.tenantId);
          const otherKitchen = await h.staff('restaurant_staff', other.tenantId);
          const owner = await h.staff('owner');
          const dispatcher = await h.staff('dispatcher');
          const customer = await h.customer('+94773000030');
          const customerItem = async () =>
            (await h.http('GET', `/restaurants/${r.tenantId}`, { token: customer })).body.categories
              .flatMap((c: { items: { id: string }[] }) => c.items)
              .find((i: { id: string }) => i.id === r.items.kottu);

          const menu = (await h.http('GET', '/restaurant/menu', { token: kitchen })).body;
          const kottu = menu.categories[0].items.find(
            (i: { id: string }) => i.id === r.items.kottu,
          );
          expect(kottu).toMatchObject({ status: 'live', pendingChange: null });
          const livePrice = kottu.priceCents;

          // Stock: instant, and only for your own items.
          expect(
            (
              await h.http('POST', `/restaurant/menu/items/${r.items.kottu}/stock`, {
                token: kitchen,
                body: { soldOut: true },
              })
            ).status,
          ).toBe(204);
          expect((await customerItem()).soldOut).toBe(true);
          expect(
            (
              await h.http('POST', `/restaurant/menu/items/${r.items.kottu}/stock`, {
                token: otherKitchen,
                body: { soldOut: false },
              })
            ).status,
          ).toBe(404);
          await h.http('POST', `/restaurant/menu/items/${r.items.kottu}/stock`, {
            token: kitchen,
            body: { soldOut: false },
          });

          // A price change waits; customers keep the live price.
          const change = await h.http('POST', `/restaurant/menu/items/${r.items.kottu}/changes`, {
            token: kitchen,
            body: { priceCents: livePrice + 10_000 },
          });
          expect(change.status).toBe(201);
          expect(
            (
              await h.http('POST', `/restaurant/menu/items/${r.items.kottu}/changes`, {
                token: kitchen,
                body: { name: 'Renamed' },
              })
            ).body.error,
          ).toBe('change_pending');
          expect((await customerItem()).priceCents).toBe(livePrice);

          // A new item is hidden until approved.
          const added = await h.http('POST', '/restaurant/menu/items', {
            token: kitchen,
            body: {
              categoryId: menu.categories[0].id,
              name: 'Cheese Seafood Kottu',
              priceCents: 180_000,
              groups: [
                {
                  name: 'Portion',
                  minSelect: 1,
                  maxSelect: 1,
                  options: [
                    { name: 'Regular', priceCents: 0 },
                    { name: 'Large', priceCents: 40_000 },
                  ],
                },
              ],
            },
          });
          expect(added.status).toBe(201);
          const page = (await h.http('GET', `/restaurants/${r.tenantId}`, { token: customer }))
            .body;
          expect(
            page.categories
              .flatMap((c: { items: { id: string }[] }) => c.items)
              .map((i: { id: string }) => i.id),
          ).not.toContain(added.body.id);
          const mine = (await h.http('GET', '/restaurant/menu', { token: kitchen })).body;
          expect(mine.pendingRequests).toBe(2);

          // The owner reviews; dispatchers can't.
          expect((await h.http('GET', '/admin/menu-requests', { token: dispatcher })).status).toBe(
            403,
          );
          const queue = (
            await h.http('GET', '/admin/menu-requests', { token: owner })
          ).body.pending.filter((q: { restaurantId: string }) => q.restaurantId === r.tenantId);
          const priceReq = queue.find((q: { kind: string }) => q.kind === 'edit');
          const newReq = queue.find((q: { kind: string }) => q.kind === 'new_item');
          expect(priceReq).toMatchObject({
            before: { priceCents: livePrice },
            after: { priceCents: livePrice + 10_000 },
          });
          expect(newReq).toMatchObject({
            after: { name: 'Cheese Seafood Kottu', priceCents: 180_000 },
            groups: [{ name: 'Portion', required: true }],
          });
          expect(
            (
              await h.http('POST', `/admin/menu-requests/${newReq.id}/review`, {
                token: owner,
                body: { approve: false },
              })
            ).status,
          ).toBe(400);
          await h.http('POST', `/admin/menu-requests/${newReq.id}/review`, {
            token: owner,
            body: { approve: false, note: 'Photo needed and price looks high' },
          });
          await h.http('POST', `/admin/menu-requests/${priceReq.id}/review`, {
            token: owner,
            body: { approve: true },
          });
          expect((await customerItem()).priceCents).toBe(livePrice + 10_000);
          const history = (await h.http('GET', '/restaurant/menu/requests', { token: kitchen }))
            .body;
          expect(history.find((x: { id: string }) => x.id === newReq.id)).toMatchObject({
            status: 'rejected',
            adminNote: 'Photo needed and price looks high',
          });
          expect(
            (
              await h.http('POST', `/admin/menu-requests/${priceReq.id}/review`, {
                token: owner,
                body: { approve: true },
              })
            ).body.error,
          ).toBe('invalid_transition');

          // Withdrawing a waiting change; other restaurants can't see or touch it.
          const again = (
            await h.http('POST', `/restaurant/menu/items/${r.items.kottu}/changes`, {
              token: kitchen,
              body: { description: 'With extra cheese' },
            })
          ).body;
          expect(
            (
              await h.http('DELETE', `/restaurant/menu/requests/${again.requestId}`, {
                token: otherKitchen,
              })
            ).status,
          ).toBe(404);
          expect(
            (
              await h.http('DELETE', `/restaurant/menu/requests/${again.requestId}`, {
                token: kitchen,
              })
            ).status,
          ).toBe(204);
          expect(
            (await h.http('GET', '/restaurant/menu/requests', { token: otherKitchen })).body.map(
              (x: { id: string }) => x.id,
            ),
          ).not.toContain(priceReq.id);
        }),
      ),
    120_000,
  );

  it(
    'applies hours, closures and pauses at once',
    () =>
      inRollback((tx) =>
        withHarness(tx, async (h) => {
          const r = await fixtureRestaurant(tx);
          const kitchen = await h.staff('restaurant_staff', r.tenantId);
          let hours = (await h.http('GET', '/restaurant/hours', { token: kitchen })).body;
          expect(hours).toMatchObject({ isOpen: true, pausedUntil: null });

          hours = (
            await h.http('POST', '/restaurant/hours/closures', {
              token: kitchen,
              body: { date: today(), closed: true },
            })
          ).body;
          expect(hours.isOpen).toBe(false);
          expect(hours.closures).toHaveLength(1);
          hours = (
            await h.http('DELETE', `/restaurant/hours/closures/${hours.closures[0].id}`, {
              token: kitchen,
            })
          ).body;
          expect(hours.isOpen).toBe(true);
          expect(
            (
              await h.http('POST', '/restaurant/hours/closures', {
                token: kitchen,
                body: { date: '2020-01-01', closed: true },
              })
            ).body.error,
          ).toBe('invalid_input');

          // Pause for 15 minutes, then reopen.
          await h.http('POST', '/restaurant/status', {
            token: kitchen,
            body: { open: false, minutes: 15 },
          });
          hours = (await h.http('GET', '/restaurant/hours', { token: kitchen })).body;
          expect(hours.isOpen).toBe(false);
          const left = new Date(hours.pausedUntil).getTime() - Date.now();
          expect(left).toBeGreaterThan(14 * 60_000);
          expect(left).toBeLessThanOrEqual(15 * 60_000);
          await h.http('POST', '/restaurant/status', { token: kitchen, body: { open: true } });

          // Weekly hours: closed every day means closed now.
          hours = (
            await h.http('PUT', '/restaurant/hours', { token: kitchen, body: { weekly: [] } })
          ).body;
          expect(hours).toMatchObject({ weekly: [], isOpen: false });
        }),
      ),
    120_000,
  );
});
