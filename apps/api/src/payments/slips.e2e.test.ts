/*
 * Bank transfer over HTTP (C08, A12): details on the order, slip upload with metadata stripped,
 * duplicate guard, review queue, reject and re-upload, approve, and the slip window.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../db/client.js';
import { closeTestDb, inRollback, testDatabaseUrl } from '../db/testing.js';
import { ORDER_QUEUES } from '../orders/queues.js';
import { LocalDiskStorage } from '../storage/storage.js';
import { fixtureRestaurant, withHarness, type Harness } from '../testing/harness.js';

afterAll(closeTestDb);

/** A small JPEG carrying EXIF (camera make and a GPS position) that upload must strip. */
async function slipImage(_seed: number) {
  // Random pixels: every call is a different image (solid colours can compress identically).
  return sharp(randomBytes(64 * 48 * 3), { raw: { width: 64, height: 48, channels: 3 } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'TestCam' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '7/1 2/1 56/1' },
    })
    .toBuffer();
}

async function ensureBankDetails(tx: Tx) {
  await tx.execute(sql`
    insert into settings (key, value) values ('bankDetails', ${JSON.stringify({
      bankName: 'Test Bank',
      branch: 'Jaffna',
      accountName: 'Oyo Eats (Pvt) Ltd',
      accountNumber: '1234 5678',
    })}::jsonb)
    on conflict (key) do update set value = excluded.value`);
}

async function bankOrder(h: Harness, tx: Tx, phone: string) {
  await ensureBankDetails(tx);
  const r = await fixtureRestaurant(tx);
  const token = await h.customer(phone);
  const address = await h.http('POST', '/me/addresses', {
    token,
    body: { label: 'Home', lat: 9.665, lng: 80.0255, addressText: '12 Temple Road' },
  });
  const order = await h.http('POST', '/orders', {
    token,
    key: `bank-${phone.replace(/\D/g, '')}`,
    body: {
      restaurantId: r.tenantId,
      addressId: address.body.id,
      paymentMethod: 'bank_transfer',
      items: [{ menuItemId: r.items.kottu, quantity: 1, modifierIds: [r.modifiers.hot] }],
    },
  });
  expect(order.status).toBe(201);
  return { token, order: order.body, r };
}

describe.skipIf(!testDatabaseUrl)('bank transfer', () => {
  it('shows where to pay, takes a slip with metadata stripped, and blocks duplicates', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const { token, order } = await bankOrder(h, tx, '+94772000001');
        expect(order.status).toBe('awaiting_payment');
        expect(order.bankTransfer).toMatchObject({
          bankDetails: { bankName: 'Test Bank', accountNumber: '1234 5678' },
          reference: order.reference,
          amountCents: order.totalCents,
          slip: null,
          canUpload: true,
        });
        expect(
          new Date(order.bankTransfer.expiresAt).getTime() - new Date(order.placedAt).getTime(),
        ).toBe(30 * 60_000);

        const path = `/orders/${order.id}/slip`;
        expect(
          (await h.upload(path, token, 'slip', Buffer.from('not an image'))).body,
        ).toMatchObject({
          error: 'slip_invalid',
          reason: 'format',
        });
        const image = await slipImage(1);
        expect(
          (await h.upload(path, token, 'slip', image, { bankReference: 'TRX-1001' })).status,
        ).toBe(204);

        const [stored] = [...h.storage.files.values()];
        const meta = await sharp(stored!.data).metadata();
        expect(meta.format).toBe('jpeg');
        expect(meta.exif).toBeUndefined();

        const after = (await h.http('GET', `/orders/${order.id}`, { token })).body;
        expect(after.bankTransfer).toMatchObject({ slip: { status: 'pending' }, canUpload: false });
        expect(after.timeline.map((e: { type: string }) => e.type)).toEqual([
          'placed',
          'slip_uploaded',
        ]);
        expect((await h.upload(path, token, 'slip', await slipImage(2))).body.error).toBe(
          'slip_pending',
        );

        // The same image or bank reference can't back a second order (SEC-24).
        const second = await bankOrder(h, tx, '+94772000002');
        const secondPath = `/orders/${second.order.id}/slip`;
        expect((await h.upload(secondPath, second.token, 'slip', image)).body.error).toBe(
          'slip_duplicate',
        );
        expect(
          (
            await h.upload(secondPath, second.token, 'slip', await slipImage(3), {
              bankReference: 'TRX-1001',
            })
          ).body.error,
        ).toBe('slip_duplicate');
        // Nobody else can upload to this order.
        expect((await h.upload(path, second.token, 'slip', await slipImage(4))).status).toBe(404);
      }),
    ));

  it('lets dispatch reject for a new slip, then approve and send the order to the restaurant', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const { token, order } = await bankOrder(h, tx, '+94772000003');
        const path = `/orders/${order.id}/slip`;
        await h.upload(path, token, 'slip', await slipImage(5));

        expect((await h.http('GET', '/admin/slips', { token })).status).toBe(403);
        const dispatcher = await h.staff('dispatcher');
        const queue = await h.http('GET', '/admin/slips', { token: dispatcher });
        const item = queue.body.find((s: { orderId: string }) => s.orderId === order.id);
        expect(item).toMatchObject({ reference: order.reference, amountCents: order.totalCents });
        expect(item.imageUrl).toMatch(/^memory:\/\/slips\//);

        expect(
          (
            await h.http('POST', `/admin/slips/${item.slipId}/reject`, {
              token: dispatcher,
              body: { reason: 'Amount mismatch' },
            })
          ).status,
        ).toBe(204);
        const rejected = (await h.http('GET', `/orders/${order.id}`, { token })).body;
        expect(rejected.status).toBe('awaiting_payment');
        expect(rejected.bankTransfer).toMatchObject({
          slip: { status: 'resubmit_requested', reviewReason: 'Amount mismatch' },
          canUpload: true,
        });

        expect((await h.upload(path, token, 'slip', await slipImage(6))).status).toBe(204);
        const next = (await h.http('GET', '/admin/slips', { token: dispatcher })).body.find(
          (s: { orderId: string }) => s.orderId === order.id,
        );
        expect(
          (await h.http('POST', `/admin/slips/${next.slipId}/approve`, { token: dispatcher }))
            .status,
        ).toBe(204);
        expect(
          (await h.http('POST', `/admin/slips/${next.slipId}/approve`, { token: dispatcher })).body
            .error,
        ).toBe('invalid_transition');

        const approved = (await h.http('GET', `/orders/${order.id}`, { token })).body;
        expect(approved).toMatchObject({ status: 'awaiting_restaurant', stage: 'confirmed' });
        expect(approved.timeline.map((e: { type: string }) => e.type)).toEqual([
          'placed',
          'slip_uploaded',
          'slip_rejected',
          'slip_uploaded',
          'slip_approved',
        ]);
        expect(h.jobs.sent.at(-1)).toEqual({
          queue: ORDER_QUEUES.restaurantTimeout,
          data: { orderId: order.id },
          seconds: 300,
        });
        const [payment] = (
          await tx.execute<{ status: string }>(
            sql`select status from payments where order_id = ${order.id}`,
          )
        ).rows;
        expect(payment!.status).toBe('confirmed');
      }),
    ));

  it('holds an order with a slip under review past the window, and closes uploads after it', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const { token, order } = await bankOrder(h, tx, '+94772000004');
        await h.upload(`/orders/${order.id}/slip`, token, 'slip', await slipImage(7));
        await h.jobs.runAll(ORDER_QUEUES.paymentTimeout);
        expect((await h.http('GET', `/orders/${order.id}`, { token })).body.status).toBe(
          'awaiting_payment',
        );
        expect(
          h.jobs.sent.filter((j) => j.queue === ORDER_QUEUES.paymentTimeout).at(-1)?.seconds,
        ).toBe(600);

        // A different order whose window has passed: no uploads, and the timer cancels it.
        const late = await bankOrder(h, tx, '+94772000005');
        await tx.execute(
          sql`update orders set placed_at = now() - interval '31 minutes' where id = ${late.order.id}`,
        );
        expect(
          (await h.upload(`/orders/${late.order.id}/slip`, late.token, 'slip', await slipImage(8)))
            .body.error,
        ).toBe('slip_window_closed');
        await h.jobs.runAll(ORDER_QUEUES.paymentTimeout);
        expect(
          (await h.http('GET', `/orders/${late.order.id}`, { token: late.token })).body.status,
        ).toBe('cancelled');
      }),
    ));

  it('offers bank transfer only once the business account is set', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        await tx.execute(sql`delete from settings where key = 'bankDetails'`);
        const r = await fixtureRestaurant(tx);
        const token = await h.customer('+94772000006');
        const address = await h.http('POST', '/me/addresses', {
          token,
          body: { label: 'Home', lat: 9.665, lng: 80.0255, addressText: '12 Temple Road' },
        });
        const quote = await h.http('POST', '/orders/quote', {
          token,
          body: {
            restaurantId: r.tenantId,
            addressId: address.body.id,
            items: [{ menuItemId: r.items.kottu, quantity: 1, modifierIds: [r.modifiers.hot] }],
          },
        });
        expect(quote.body.paymentMethods).toEqual(['cod']);
      }),
    ));
});

describe.skipIf(!testDatabaseUrl)('rejecting a slip outright', () => {
  it('cancels the order at once and marks the payment failed', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const { token, order } = await bankOrder(h, tx, '+94772000008');
        await h.upload(`/orders/${order.id}/slip`, token, 'slip', await slipImage(10));
        const dispatcher = await h.staff('dispatcher');
        const item = (await h.http('GET', '/admin/slips', { token: dispatcher })).body.find(
          (s: { orderId: string }) => s.orderId === order.id,
        );
        expect(
          (
            await h.http('POST', `/admin/slips/${item.slipId}/reject`, {
              token: dispatcher,
              body: { reason: 'Payment not received', resubmit: false },
            })
          ).status,
        ).toBe(204);
        const after = (await h.http('GET', `/orders/${order.id}`, { token })).body;
        expect(after).toMatchObject({ status: 'cancelled', bankTransfer: { canUpload: false } });
        expect(after.timeline.map((e: { type: string }) => e.type)).toEqual([
          'placed',
          'slip_uploaded',
          'slip_rejected',
          'cancelled_by_admin',
        ]);
        const [payment] = (
          await tx.execute<{ status: string }>(
            sql`select status from payments where order_id = ${order.id}`,
          )
        ).rows;
        expect(payment!.status).toBe('failed');
      }),
    ));
});

describe.skipIf(!testDatabaseUrl)('cancelling a paid bank transfer', () => {
  it('opens a refund case for the office', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const { token, order } = await bankOrder(h, tx, '+94772000007');
        await h.upload(`/orders/${order.id}/slip`, token, 'slip', await slipImage(9));
        const cancelled = await h.http('POST', `/orders/${order.id}/cancel`, { token });
        expect(cancelled.body.status).toBe('cancelled');
        // The slip leaves the review queue: it's a refund case now.
        const dispatcher = await h.staff('dispatcher');
        expect(
          (await h.http('GET', '/admin/slips', { token: dispatcher })).body.map(
            (x: { orderId: string }) => x.orderId,
          ),
        ).not.toContain(order.id);
        const cases = (
          await tx.execute<{ type: string }>(
            sql`select type from support_cases where order_id = ${order.id}`,
          )
        ).rows;
        expect(cases).toEqual([{ type: 'refund_bank_transfer' }]);
      }),
    ));
});

describe('signed file URLs', () => {
  it('serve only with a valid, unexpired signature', async () => {
    let now = new Date('2026-11-02T00:00:00Z');
    const storage = new LocalDiskStorage('/tmp/unused', randomBytes(32), 'http://api', () => now);
    const url = new URL(await storage.signedUrl('slips/a/b.jpg', 600));
    const key = decodeURIComponent(url.pathname.replace('/files/', ''));
    const expires = Number(url.searchParams.get('expires'));
    const sig = url.searchParams.get('sig')!;
    expect(storage.verify(key, expires, sig)).toBe(true);
    expect(storage.verify('slips/a/other.jpg', expires, sig)).toBe(false);
    expect(storage.verify(key, expires + 1, sig)).toBe(false);
    now = new Date(now.getTime() + 601_000);
    expect(storage.verify(key, expires, sig)).toBe(false);
    await expect(storage.signedUrl('../etc/passwd', 60)).rejects.toThrow();
  });
});
