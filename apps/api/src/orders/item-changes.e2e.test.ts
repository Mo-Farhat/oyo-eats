/*
 * RES-05 over HTTP: the kitchen marks part of an accepted order unavailable, the customer swaps or
 * removes it (or the timer removes it), and totals, refunds and cancellation follow.
 */
import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../db/client.js';
import { menuItems, orderItems, refunds, supportCases } from '../db/schema.js';
import { closeTestDb, inRollback, testDatabaseUrl } from '../db/testing.js';
import { ORDER_QUEUES } from './queues.js';
import { fixtureRestaurant, withHarness, type Harness } from '../testing/harness.js';

afterAll(closeTestDb);

async function setup(h: Harness, tx: Tx, phone: string) {
  const r = await fixtureRestaurant(tx);
  const [cat] = (
    await tx.execute<{ id: string }>(
      sql`select id from menu_categories where tenant_id = ${r.tenantId}`,
    )
  ).rows;
  const plain = async (name: string, price: number) =>
    (
      await tx.execute<{ id: string }>(sql`
        insert into menu_items (tenant_id, category_id, name, price_cents, approval_status)
        values (${r.tenantId}, ${cat!.id}, ${name}, ${price}, 'approved') returning id`)
    ).rows[0]!.id;
  const eggKottu = await plain('Egg Kottu', 100_000);
  const cheeseKottu = await plain('Cheese Kottu', 160_000);
  const customer = await h.customer(phone);
  const address = await h.http('POST', '/me/addresses', {
    token: customer,
    body: { label: 'Home', lat: 9.665, lng: 80.0255, addressText: '12 Temple Road' },
  });
  const kitchen = await h.staff('restaurant_staff', r.tenantId);
  const place = async (
    paymentMethod: 'cod' | 'bank_transfer',
    items: { menuItemId: string; quantity: number; modifierIds: string[] }[],
  ) => {
    const res = await h.http('POST', '/orders', {
      token: customer,
      key: `itemchg-${phone.replace(/\D/g, '')}-${paymentMethod}`,
      body: { restaurantId: r.tenantId, addressId: address.body.id, paymentMethod, items },
    });
    expect(res.status).toBe(201);
    return res.body as { id: string; totalCents: number; deliveryFeeCents: number };
  };
  const accept = async (id: string) =>
    expect(
      (
        await h.http('POST', `/restaurant/orders/${id}/accept`, {
          token: kitchen,
          body: { prepMinutes: 15 },
        })
      ).status,
    ).toBe(204);
  const lineIds = async (id: string) =>
    (await h.http('GET', '/restaurant/board', { token: kitchen })).body.preparing.find(
      (o: { id: string }) => o.id === id,
    ).lines as { id: string; name: string; quantity: number; modifiers: string[] }[];
  return { r, eggKottu, cheeseKottu, customer, kitchen, place, accept, lineIds };
}

describe.skipIf(!testDatabaseUrl)('unavailable items (RES-05)', () => {
  it('cash order: the customer takes the substitute and the total follows', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const s = await setup(h, tx, '+94775100001');
        // 2 x Chicken Kottu (Hot) at 1,350.
        const order = await s.place('cod', [
          { menuItemId: s.r.items.kottu, quantity: 2, modifierIds: [s.r.modifiers.hot] },
        ]);
        await s.accept(order.id);
        const [line] = await s.lineIds(order.id);

        const mark = (body: object) =>
          h.http('POST', `/restaurant/orders/${order.id}/unavailable`, {
            token: s.kitchen,
            body,
          });
        // Not one of its items, or "available" as many as ordered: refused.
        expect((await mark({ orderItemId: line!.id, availableQuantity: 2 })).body.error).toBe(
          'invalid_input',
        );
        expect(
          (
            await mark({
              orderItemId: line!.id,
              availableQuantity: 1,
              substituteMenuItemId: s.r.items.soldOut,
            })
          ).body.error,
        ).toBe('invalid_input');
        expect(
          (
            await mark({
              orderItemId: line!.id,
              availableQuantity: 1,
              substituteMenuItemId: s.eggKottu,
            })
          ).status,
        ).toBe(204);
        expect(
          (await mark({ orderItemId: line!.id, substituteMenuItemId: s.eggKottu })).body.error,
        ).toBe('item_change_pending');

        // The kitchen waits for the answer; the customer sees the choice.
        const board = (await h.http('GET', '/restaurant/board', { token: s.kitchen })).body;
        expect(board.preparing[0].itemChanges).toMatchObject([
          { name: 'Chicken Kottu', quantity: 2, availableQuantity: 1, status: 'pending' },
        ]);
        expect(
          (await h.http('POST', `/restaurant/orders/${order.id}/ready`, { token: s.kitchen })).body
            .error,
        ).toBe('item_change_pending');
        const seen = (await h.http('GET', `/orders/${order.id}`, { token: s.customer })).body;
        expect(seen.itemChanges).toMatchObject([
          {
            missingCents: 135_000,
            substitute: { name: 'Egg Kottu', unitPriceCents: 100_000, totalCents: 100_000 },
            status: 'pending',
          },
        ]);
        expect(h.jobs.sent.filter((j) => j.queue === ORDER_QUEUES.itemChangeTimeout)).toEqual([
          { queue: ORDER_QUEUES.itemChangeTimeout, data: expect.any(Object), seconds: 180 },
        ]);

        const changeId = seen.itemChanges[0].id;
        const answer = await h.http('POST', `/orders/${order.id}/item-changes/${changeId}`, {
          token: s.customer,
          body: { choice: 'substitute' },
        });
        expect(answer.status).toBe(200);
        expect(answer.body.lines).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'Chicken Kottu',
              quantity: 1,
              lineTotalCents: 135_000,
            }),
            expect.objectContaining({
              name: 'Egg Kottu',
              quantity: 1,
              lineTotalCents: 100_000,
              note: 'Instead of Chicken Kottu',
            }),
          ]),
        );
        expect(answer.body.itemsCents).toBe(235_000);
        expect(answer.body.totalCents).toBe(order.totalCents - 35_000);
        expect(answer.body.itemChanges[0]).toMatchObject({
          status: 'substituted',
          resolvedBy: 'customer',
          refundCents: 0,
        });
        expect(answer.body.timeline.map((e: { type: string }) => e.type)).toEqual(
          expect.arrayContaining(['item_unavailable', 'item_change_resolved']),
        );
        // Answered once only; the timer then finds nothing to do.
        expect(
          (
            await h.http('POST', `/orders/${order.id}/item-changes/${changeId}`, {
              token: s.customer,
              body: { choice: 'remove' },
            })
          ).body.error,
        ).toBe('invalid_transition');
        await h.jobs.runAll(ORDER_QUEUES.itemChangeTimeout);
        expect(
          (await h.http('GET', `/orders/${order.id}`, { token: s.customer })).body.itemsCents,
        ).toBe(235_000);
        expect(
          (await h.http('POST', `/restaurant/orders/${order.id}/ready`, { token: s.kitchen }))
            .status,
        ).toBe(204);
      }),
    ));

  it('bank transfer: no answer removes the item and the office owes the difference', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        await tx.execute(sql`
          insert into settings (key, value) values ('bankDetails', ${JSON.stringify({
            bankName: 'Test Bank',
            branch: 'Jaffna',
            accountName: 'Oyo Eats',
            accountNumber: '1234 5678',
          })}::jsonb)
          on conflict (key) do update set value = excluded.value`);
        const s = await setup(h, tx, '+94775100002');
        // Two lines: Hot at 1,350 and Mild with a fried egg at 1,450.
        const order = await s.place('bank_transfer', [
          { menuItemId: s.r.items.kottu, quantity: 1, modifierIds: [s.r.modifiers.hot] },
          {
            menuItemId: s.r.items.kottu,
            quantity: 1,
            modifierIds: [s.r.modifiers.mild, s.r.modifiers.egg],
          },
        ]);
        const slip = await sharp(randomBytes(64 * 48 * 3), {
          raw: { width: 64, height: 48, channels: 3 },
        })
          .jpeg()
          .toBuffer();
        expect((await h.upload(`/orders/${order.id}/slip`, s.customer, 'slip', slip)).status).toBe(
          204,
        );
        const dispatcher = await h.staff('dispatcher');
        const queue = (await h.http('GET', '/admin/slips', { token: dispatcher })).body;
        const mine = queue.find((q: { orderId: string }) => q.orderId === order.id);
        expect(
          (await h.http('POST', `/admin/slips/${mine.slipId}/approve`, { token: dispatcher }))
            .status,
        ).toBeLessThan(300);
        await s.accept(order.id);
        const lines = await s.lineIds(order.id);
        const withEgg = lines.find((l) => l.modifiers.includes('Fried egg'))!;

        // A prepaid order can't be charged more, so a dearer substitute is refused.
        const mark = (substituteMenuItemId: string) =>
          h.http('POST', `/restaurant/orders/${order.id}/unavailable`, {
            token: s.kitchen,
            body: { orderItemId: withEgg.id, substituteMenuItemId },
          });
        expect((await mark(s.cheeseKottu)).body.error).toBe('substitute_costs_more');
        expect((await mark(s.eggKottu)).status).toBe(204);

        await h.jobs.runAll(ORDER_QUEUES.itemChangeTimeout);
        const after = (await h.http('GET', `/orders/${order.id}`, { token: s.customer })).body;
        expect(after.status).toBe('active');
        expect(after.lines).toHaveLength(1);
        expect(after.itemsCents).toBe(135_000);
        expect(after.totalCents).toBe(order.totalCents - 145_000);
        expect(after.itemChanges[0]).toMatchObject({
          status: 'removed',
          resolvedBy: 'timeout',
          refundCents: 145_000,
        });

        const [refund] = await tx.select().from(refunds).where(eq(refunds.orderId, order.id));
        expect(refund).toMatchObject({
          amountCents: 145_000,
          reasonCode: 'item_unavailable',
          attribution: 'restaurant',
          orderAdjusted: true,
          status: 'owed',
        });
        const [kase] = await tx
          .select()
          .from(supportCases)
          .where(eq(supportCases.id, refund!.caseId!));
        expect(kase).toMatchObject({ type: 'refund_bank_transfer', status: 'open' });
        // What's left to refund is the new total: paid less the refund already owed.
        const detail = (await h.http('GET', `/admin/orders/${order.id}`, { token: dispatcher }))
          .body;
        expect(detail.refundableCents).toBe(after.totalCents);
      }),
    ));

  it('nothing left to make cancels the order and can mark the item sold out', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const s = await setup(h, tx, '+94775100003');
        const order = await s.place('cod', [
          { menuItemId: s.r.items.kottu, quantity: 1, modifierIds: [s.r.modifiers.hot] },
        ]);
        await s.accept(order.id);
        const [line] = await s.lineIds(order.id);
        expect(
          (
            await h.http('POST', `/restaurant/orders/${order.id}/unavailable`, {
              token: s.kitchen,
              body: { orderItemId: line!.id, markSoldOut: true },
            })
          ).status,
        ).toBe(204);
        const after = (await h.http('GET', `/orders/${order.id}`, { token: s.customer })).body;
        expect(after.status).toBe('cancelled');
        expect(after.itemChanges[0]).toMatchObject({ status: 'removed', resolvedBy: 'kitchen' });
        expect(after.timeline.map((e: { type: string }) => e.type)).toContain(
          'cancelled_items_unavailable',
        );
        const [item] = await tx
          .select({ soldOut: menuItems.soldOut })
          .from(menuItems)
          .where(eq(menuItems.id, s.r.items.kottu));
        expect(item!.soldOut).toBe(true);
        expect(
          await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
        ).toHaveLength(1);
      }),
    ));
});
