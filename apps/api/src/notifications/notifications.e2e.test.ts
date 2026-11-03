/*
 * Notifications (section 10): committed order events become one row per person, with the
 * templates from @oyo/shared; pushes go to registered phones, others are marked no_device; each
 * event is notified once; the in-app list shows only your own.
 */
import { eq, sql } from 'drizzle-orm';
import { encrypt } from '../common/crypto.js';
import type { Config } from '../config.js';
import { accounts } from '../db/schema.js';
import { CONFIG } from '../tokens.js';
import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDb, inRollback, testDatabaseUrl } from '../db/testing.js';
import { fixtureRestaurant, withHarness } from '../testing/harness.js';
import { NotificationsService } from './notifications.service.js';
import type { PushMessage, PushSender } from './push.js';

afterAll(closeTestDb);

class RecordingPush implements PushSender {
  sent: PushMessage[] = [];
  async send(messages: PushMessage[]) {
    this.sent.push(...messages);
    return messages.map((m) =>
      m.to.includes('Dead')
        ? { ok: false, error: 'DeviceNotRegistered', unregistered: true }
        : { ok: true },
    );
  }
}

describe.skipIf(!testDatabaseUrl)('notifications', () => {
  it('notifies the kitchen of a new order and the customer when it is accepted', () => {
    const push = new RecordingPush();
    return inRollback((tx) =>
      withHarness(
        tx,
        async (h) => {
          const service = h.app.get(NotificationsService);
          const r = await fixtureRestaurant(tx);
          const kitchen = await h.staff('restaurant_staff', r.tenantId);
          const customer = await h.customer('+94773000050');
          // The kitchen tablet has push; the customer's phone registers one token that's dead.
          expect(
            (
              await h.http('POST', '/me/push-token', {
                token: kitchen,
                body: { token: 'ExponentPushToken[kitchenTablet1]', platform: 'android' },
              })
            ).status,
          ).toBe(204);
          expect(
            (await h.http('POST', '/me/push-token', { token: customer, body: { token: 'nope' } }))
              .status,
          ).toBe(400);

          const address = await h.http('POST', '/me/addresses', {
            token: customer,
            body: { label: 'Home', lat: 9.665, lng: 80.0255, addressText: '1 Main Street' },
          });
          const order = (
            await h.http('POST', '/orders', {
              token: customer,
              key: 'notify-0001',
              body: {
                restaurantId: r.tenantId,
                addressId: address.body.id,
                paymentMethod: 'cod',
                items: [{ menuItemId: r.items.kottu, quantity: 1, modifierIds: [r.modifiers.hot] }],
              },
            })
          ).body;

          await service.runOnce();
          expect(push.sent).toEqual([
            expect.objectContaining({
              to: 'ExponentPushToken[kitchenTablet1]',
              title: `New order #${order.reference}`,
              critical: true,
              data: expect.objectContaining({ orderId: order.id }),
            }),
          ]);
          // Each event is notified once.
          await service.runOnce();
          expect(push.sent).toHaveLength(1);

          await h.http('POST', '/me/push-token', {
            token: customer,
            body: { token: 'ExponentPushToken[customerDeadPhone]' },
          });
          await h.http('POST', `/restaurant/orders/${order.id}/accept`, {
            token: kitchen,
            body: { prepMinutes: 15 },
          });
          await service.runOnce();
          expect(push.sent.at(-1)).toMatchObject({
            to: 'ExponentPushToken[customerDeadPhone]',
            title: 'Fixture Kitchen accepted your order',
            body: 'Ready in about 15 min.',
          });

          // In-app list: own notifications only; mark read.
          const mine = (await h.http('GET', '/me/notifications', { token: customer })).body;
          expect(mine.items.map((n: { kind: string }) => n.kind)).toEqual(['restaurant_accepted']);
          expect(mine.unread).toBe(1);
          await h.http('POST', '/me/notifications/read', { token: customer });
          expect((await h.http('GET', '/me/notifications', { token: customer })).body.unread).toBe(
            0,
          );
          const kitchenList = (await h.http('GET', '/me/notifications', { token: kitchen })).body;
          expect(kitchenList.items.map((n: { kind: string }) => n.kind)).toEqual(['placed']);

          // The dead token was dropped after Expo said so: the next push to the customer has nowhere to go.
          await h.http('POST', `/restaurant/orders/${order.id}/ready`, { token: kitchen });
          const before = push.sent.length;
          await service.runOnce();
          expect(push.sent.length).toBe(before);
        },
        { push },
      ),
    );
  }, 90_000);

  it('alerts every dispatcher once when an accepted order has no rider for too long', () => {
    const push = new RecordingPush();
    return inRollback((tx) =>
      withHarness(
        tx,
        async (h) => {
          const service = h.app.get(NotificationsService);
          const r = await fixtureRestaurant(tx);
          const kitchen = await h.staff('restaurant_staff', r.tenantId);
          const dispatcher = await h.staff('dispatcher');
          // A second dispatcher with a phone number but no app push: gets an SMS instead (NOT-01).
          const second = await h.staff('dispatcher');
          const secondId = (await h.http('GET', '/auth/me', { token: second })).body.accountId;
          await tx
            .update(accounts)
            .set({
              phoneCiphertext: encrypt(h.app.get<Config>(CONFIG).encryptionKey, '+94770009999'),
            })
            .where(eq(accounts.id, secondId));
          await h.http('POST', '/me/push-token', {
            token: dispatcher,
            body: { token: 'ExponentPushToken[dispatchPhone1]' },
          });
          const customer = await h.customer('+94773000051');
          const address = await h.http('POST', '/me/addresses', {
            token: customer,
            body: { label: 'Home', lat: 9.665, lng: 80.0255, addressText: '1 Main Street' },
          });
          const order = (
            await h.http('POST', '/orders', {
              token: customer,
              key: 'notify-late-1',
              body: {
                restaurantId: r.tenantId,
                addressId: address.body.id,
                paymentMethod: 'cod',
                items: [{ menuItemId: r.items.kottu, quantity: 1, modifierIds: [r.modifiers.hot] }],
              },
            })
          ).body;
          await h.http('POST', `/restaurant/orders/${order.id}/accept`, {
            token: kitchen,
            body: { prepMinutes: 15 },
          });
          await service.runOnce();
          expect(
            push.sent.filter(
              (m) => m.to.includes('dispatchPhone1') && m.title.includes(order.reference),
            ),
          ).toEqual([]);

          // Still no rider when the alert time passes (set to zero here: events can't be backdated).
          await tx.execute(
            sql`update settings set value = jsonb_set(value, '{unassignedAlertSeconds}', '0') where key = 'timers'`,
          );
          await service.runOnce();
          const alerts = push.sent.filter(
            (m) => m.to.includes('dispatchPhone1') && m.title.includes(order.reference),
          );
          expect(alerts).toEqual([
            expect.objectContaining({ title: `#${order.reference} needs a rider`, critical: true }),
          ]);
          await service.runOnce();
          expect(
            push.sent.filter(
              (m) => m.to.includes('dispatchPhone1') && m.title.includes(order.reference),
            ),
          ).toHaveLength(1);
          expect(h.lastSms('+94770009999')).toContain(`#${order.reference} needs a rider`);
        },
        { push },
      ),
    );
  }, 90_000);
});
