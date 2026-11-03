/*
 * Live updates: the trigger's payload for a real order event, and sockets that sign in with the
 * access token, join their rooms and hear only about their own orders.
 */
import { sql } from 'drizzle-orm';
import { io, type Socket } from 'socket.io-client';
import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDb, inRollback, testDatabaseUrl } from '../db/testing.js';
import { fixtureRestaurant, withHarness } from '../testing/harness.js';
import { LiveGateway } from './live.gateway.js';

afterAll(closeTestDb);

function connect(base: string, token: string): Promise<{ socket: Socket; outcome: string }> {
  const socket = io(`${base}/live`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
  });
  return new Promise((resolve) => {
    socket.on('ready', () => resolve({ socket, outcome: 'ready' }));
    socket.on('unauthorized', () => resolve({ socket, outcome: 'unauthorized' }));
    socket.on('connect_error', () => resolve({ socket, outcome: 'error' }));
  });
}

const next = (socket: Socket, ms = 1500) =>
  new Promise<unknown>((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    socket.once('changed', (m) => {
      clearTimeout(t);
      resolve(m);
    });
  });

describe.skipIf(!testDatabaseUrl)('live updates', () => {
  it(
    'builds the notice from the order and routes it only to the right sockets',
    () =>
      inRollback((tx) =>
        withHarness(tx, async (h) => {
          const r = await fixtureRestaurant(tx);
          const token = await h.customer('+94773000040');
          const otherToken = await h.customer('+94773000041');
          const address = await h.http('POST', '/me/addresses', {
            token,
            body: { label: 'Home', lat: 9.665, lng: 80.0255, addressText: '1 Main Street' },
          });
          const order = (
            await h.http('POST', '/orders', {
              token,
              key: 'live-0001',
              body: {
                restaurantId: r.tenantId,
                addressId: address.body.id,
                paymentMethod: 'cod',
                items: [{ menuItemId: r.items.kottu, quantity: 1, modifierIds: [r.modifiers.hot] }],
              },
            })
          ).body;

          // The trigger's payload: ids only.
          const [row] = (
            await tx.execute<{ p: Record<string, unknown> }>(
              sql`select oyo_live_order_payload(e) as p from order_events e where e.order_id = ${order.id}`,
            )
          ).rows;
          expect(row!.p).toEqual({
            kind: 'order',
            orderId: order.id,
            type: 'placed',
            tenantId: r.tenantId,
            customerId: expect.any(String),
            riderIds: [],
          });

          const base = (await h.app.getUrl()).replace('[::1]', 'localhost');
          const bad = await connect(base, 'not-a-token');
          expect(bad.outcome).toBe('unauthorized');
          bad.socket.close();

          const mine = await connect(base, token);
          const other = await connect(base, otherToken);
          const kitchen = await connect(base, await h.staff('restaurant_staff', r.tenantId));
          expect([mine.outcome, other.outcome, kitchen.outcome]).toEqual([
            'ready',
            'ready',
            'ready',
          ]);
          try {
            const heard = Promise.all([
              next(mine.socket),
              next(other.socket),
              next(kitchen.socket),
            ]);
            h.app.get(LiveGateway).publish(row!.p as never);
            const [a, b, c] = await heard;
            expect(a).toEqual({ kind: 'order', orderId: order.id, type: 'placed' });
            expect(b).toBeNull();
            expect(c).toEqual({ kind: 'order', orderId: order.id, type: 'placed' });
          } finally {
            for (const s of [mine.socket, other.socket, kitchen.socket]) s.close();
          }
        }),
      ),
    60_000,
  );
});
