/*
 * Riders for dispatch (A08, A09) and cash handovers (A11, ADM-09): status, cash held, the COD
 * orders behind it, a short handover that needs a reason and the owner's sign-off, force offline.
 */
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDb, inRollback, testDatabaseUrl } from '../db/testing.js';
import { accounts, riders } from '../db/schema.js';
import { balance } from '../ledger/ledger.js';
import { fixtureRestaurant, withHarness } from '../testing/harness.js';

afterAll(closeTestDb);

describe.skipIf(!testDatabaseUrl)('riders and cash handovers', () => {
  it(
    'tracks cash from a COD delivery to the office',
    () =>
      inRollback((tx) =>
        withHarness(tx, async (h) => {
          const r = await fixtureRestaurant(tx);
          const owner = await h.staff('owner');
          const dispatcher = await h.staff('dispatcher');
          const created = (
            await h.http('POST', '/admin/accounts', {
              token: dispatcher,
              body: {
                role: 'rider',
                displayName: 'Nuwan Jayasuriya',
                phone: '+94771234000',
                vehicleType: 'Motorbike',
                plate: 'CP BBB-2222',
              },
            })
          ).body;
          await tx
            .update(riders)
            .set({ online: true, lastLocation: { x: 80.0255, y: 9.662 }, lastSeenAt: new Date() })
            .where(eq(riders.accountId, created.accountId));
          // Skip the forced password change, then sign in (the first phone is bound).
          await tx
            .update(accounts)
            .set({ mustChangePassword: false })
            .where(eq(accounts.id, created.accountId));
          const login = await h.http('POST', '/auth/login', {
            body: { username: created.username, password: created.temporaryPassword },
            headers: { 'x-device-id': 'nuwan-phone-0001' },
          });
          expect(login.body.setup).toEqual([]);
          const riderToken = login.body.tokens.accessToken;

          let list = (await h.http('GET', '/admin/riders', { token: dispatcher })).body;
          expect(list.find((x: { id: string }) => x.id === created.accountId)).toMatchObject({
            status: 'idle',
            cashHeldCents: 0,
            noSignal: false,
          });

          // A COD order, delivered by Nuwan.
          const customer = await h.customer('+94773000010');
          const address = await h.http('POST', '/me/addresses', {
            token: customer,
            body: { label: 'Home', lat: 9.665, lng: 80.0255, addressText: '3 Hospital Road' },
          });
          const order = (
            await h.http('POST', '/orders', {
              token: customer,
              key: 'riders-cash-0001',
              body: {
                restaurantId: r.tenantId,
                addressId: address.body.id,
                paymentMethod: 'cod',
                items: [{ menuItemId: r.items.kottu, quantity: 2, modifierIds: [r.modifiers.hot] }],
              },
            })
          ).body;
          const kitchen = await h.staff('restaurant_staff', r.tenantId);
          await h.http('POST', `/restaurant/orders/${order.id}/accept`, {
            token: kitchen,
            body: { prepMinutes: 10 },
          });
          await h.http('POST', `/restaurant/orders/${order.id}/ready`, { token: kitchen });
          await h.http('POST', `/admin/orders/${order.id}/lock`, { token: dispatcher });
          const offer = (
            await h.http('POST', `/admin/orders/${order.id}/offer`, {
              token: dispatcher,
              body: { riderId: created.accountId },
            })
          ).body;
          expect(
            (await h.http('POST', `/rider/offers/${offer.offerId}/accept`, { token: riderToken }))
              .status,
          ).toBe(204);

          // Mid-job: can't be forced offline or suspended.
          expect(
            (
              await h.http('POST', `/admin/riders/${created.accountId}/offline`, {
                token: dispatcher,
              })
            ).body.error,
          ).toBe('rider_busy');
          expect(
            (
              await h.http('POST', `/admin/accounts/${created.accountId}/status`, {
                token: dispatcher,
                body: { active: false },
              })
            ).body.error,
          ).toBe('rider_busy');

          await h.http('POST', `/rider/orders/${order.id}/pickup`, { token: riderToken });
          await h.http('POST', `/rider/orders/${order.id}/deliver`, {
            token: riderToken,
            body: { cashCollectedCents: order.totalCents },
          });

          const detail = (
            await h.http('GET', `/admin/riders/${created.accountId}`, { token: dispatcher })
          ).body;
          expect(detail).toMatchObject({
            status: 'idle',
            phone: '+94771234000',
            cashHeldCents: order.totalCents,
            deliveredToday: 1,
            cashOrders: [{ orderId: order.id, cashCents: order.totalCents }],
          });

          // Short by 100 rupees: needs a reason, and the shortfall stays on the rider.
          const handover = (body: unknown) =>
            h.http('POST', `/admin/riders/${created.accountId}/handover`, {
              token: dispatcher,
              key: `handover-${JSON.stringify(body).length}`,
              body,
            });
          expect((await handover({ amountCents: order.totalCents - 10_000 })).body.error).toBe(
            'variance_reason_required',
          );
          const after = (
            await handover({ amountCents: order.totalCents - 10_000, reason: 'Change given twice' })
          ).body;
          expect(after).toMatchObject({ cashHeldCents: 10_000, cashOrders: [] });
          expect(after.handovers[0]).toMatchObject({
            amountCents: order.totalCents - 10_000,
            expectedCents: order.totalCents,
            varianceReason: 'Change given twice',
            countersignedBy: null,
          });

          // Only the owner signs off a difference.
          const hid = after.handovers[0].id;
          expect(
            (await h.http('POST', `/admin/handovers/${hid}/countersign`, { token: dispatcher }))
              .status,
          ).toBe(403);
          const signed = (
            await h.http('POST', `/admin/handovers/${hid}/countersign`, { token: owner })
          ).body;
          expect(signed.handovers[0].countersignedBy).toBeTruthy();

          // The books agree with the cash: the shortfall is still on Nuwan, the food money is owed
          // to the restaurant, the fee is earned, and Nuwan is owed his pay.
          const payout = offer.payoutCents ?? 0;
          expect(await balance(tx, 'rider_cash', created.accountId)).toBe(10_000);
          expect(await balance(tx, 'restaurant_payable', r.tenantId)).toBe(
            -(order.itemsCents + order.restaurantFeeCents),
          );
          expect(await balance(tx, 'rider_payable', created.accountId)).toBe(
            -Math.round((order.deliveryFeeCents * 0.9) / 100) * 100,
          );
          expect(payout).toBeGreaterThanOrEqual(0);

          // The rider sees the same handover and the shortfall on R11.
          expect((await h.http('GET', '/rider/state', { token: riderToken })).body).toMatchObject({
            cashHeldCents: 10_000,
            cashCapCents: expect.any(Number),
            handovers: [
              { amountCents: order.totalCents - 10_000, varianceReason: 'Change given twice' },
            ],
          });

          // Off the job now: dispatch can take Nuwan offline.
          expect(
            (
              await h.http('POST', `/admin/riders/${created.accountId}/offline`, {
                token: dispatcher,
              })
            ).body.status,
          ).toBe('offline');
          list = (await h.http('GET', '/admin/riders', { token: kitchen })).body;
          expect(list.error).toBe('forbidden');
        }),
      ),
    180_000,
  );
});
