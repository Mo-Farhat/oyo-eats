import { eq } from 'drizzle-orm';
import { expect } from 'vitest';
import type { Tx } from '../db/client.js';
import { accounts, riders } from '../db/schema.js';
import { fixtureRestaurant, type Harness } from './harness.js';

/** A rider created through the admin API, signed in on their phone and online near Jaffna. */
export async function onlineRider(
  h: Harness,
  tx: Tx,
  dispatcher: string,
  name = 'Nuwan Jayasuriya',
  phone = '+94771234000',
) {
  const created = (
    await h.http('POST', '/admin/accounts', {
      token: dispatcher,
      body: {
        role: 'rider',
        displayName: name,
        phone,
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
    headers: { 'x-device-id': `${created.username}-phone` },
  });
  expect(login.body.setup).toEqual([]);
  return { id: created.accountId as string, token: login.body.tokens.accessToken as string };
}

/**
 * One COD order taken all the way to delivered: customer orders at a fixture restaurant, kitchen
 * accepts and marks ready, dispatch offers to the rider, rider accepts, picks up and delivers.
 */
export async function deliveredCodOrder(
  h: Harness,
  tx: Tx,
  opts: {
    dispatcher: string;
    rider: { id: string; token: string };
    customerPhone: string;
    key: string;
    restaurant?: Awaited<ReturnType<typeof fixtureRestaurant>>;
    beforePickup?: (order: { id: string }) => Promise<void>;
  },
) {
  const r = opts.restaurant ?? (await fixtureRestaurant(tx));
  const customer = await h.customer(opts.customerPhone);
  const address = await h.http('POST', '/me/addresses', {
    token: customer,
    body: { label: 'Home', lat: 9.665, lng: 80.0255, addressText: '3 Hospital Road' },
  });
  const order = (
    await h.http('POST', '/orders', {
      token: customer,
      key: opts.key,
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
  await h.http('POST', `/admin/orders/${order.id}/lock`, { token: opts.dispatcher });
  const offer = (
    await h.http('POST', `/admin/orders/${order.id}/offer`, {
      token: opts.dispatcher,
      body: { riderId: opts.rider.id },
    })
  ).body;
  expect(
    (await h.http('POST', `/rider/offers/${offer.offerId}/accept`, { token: opts.rider.token }))
      .status,
  ).toBe(204);
  await opts.beforePickup?.(order);
  await h.http('POST', `/rider/orders/${order.id}/pickup`, { token: opts.rider.token });
  expect(
    (
      await h.http('POST', `/rider/orders/${order.id}/deliver`, {
        token: opts.rider.token,
        body: { cashCollectedCents: order.totalCents },
      })
    ).status,
  ).toBe(204);
  return { order, restaurant: r, kitchen, customer };
}
