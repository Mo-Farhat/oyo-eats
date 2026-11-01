/*
 * Admin onboarding over HTTP (ADM-08, ADM-11, ADM-12, ADM-19): logins issued with a one-time
 * password, per-role limits, reset and deactivation, device approval, and a restaurant taken
 * from onboarding to live and onto the customer list.
 */
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDb, inRollback, testDatabaseUrl } from '../db/testing.js';
import { fixtureRestaurant, withHarness } from '../testing/harness.js';

afterAll(closeTestDb);

describe.skipIf(!testDatabaseUrl)('admin accounts', () => {
  it('issues logins by role, resets and deactivates them, and approves devices', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const r = await fixtureRestaurant(tx);
        const dispatcher = await h.staff('dispatcher');
        const owner = await h.staff('owner');

        // Dispatchers onboard riders and restaurant users, not other dispatchers.
        const rider = await h.http('POST', '/admin/accounts', {
          token: dispatcher,
          body: {
            role: 'rider',
            displayName: 'Kasun Perera',
            vehicleType: 'Motorbike',
            plate: 'CP BAA-1234',
            nicNumber: '199012345678',
            phone: '+94771234567',
          },
        });
        expect(rider.status).toBe(201);
        expect(rider.body.username).toMatch(/^rider\.kasun\d*$/);
        expect(rider.body.temporaryPassword).toMatch(/^[\w]{5}-[\w]{5}-[\w]{5}$/);
        const [riderRow] = (
          await tx.execute<{ plate: string; nic: boolean }>(
            sql`select plate, nic_ciphertext is not null as nic from riders where account_id = ${rider.body.accountId}`,
          )
        ).rows;
        expect(riderRow).toEqual({ plate: 'CP BAA-1234', nic: true });

        expect(
          (
            await h.http('POST', '/admin/accounts', {
              token: dispatcher,
              body: { role: 'dispatcher', displayName: 'New Dispatcher' },
            })
          ).body.error,
        ).toBe('forbidden');
        const kitchen = await h.http('POST', '/admin/accounts', {
          token: dispatcher,
          body: {
            role: 'restaurant_staff',
            displayName: 'Kitchen Tablet',
            username: `kitchen.${Date.now() % 100000}`,
            tenantId: r.tenantId,
          },
        });
        expect(kitchen.status).toBe(201);
        expect(
          (
            await h.http('POST', '/admin/accounts', {
              token: owner,
              body: {
                role: 'restaurant_owner',
                displayName: 'Second Owner',
                username: kitchen.body.username,
                tenantId: r.tenantId,
              },
            })
          ).body.error,
        ).toBe('username_taken');
        expect(
          (
            await h.http('POST', '/admin/accounts', {
              token: owner,
              body: { role: 'dispatcher', displayName: 'Office Two' },
            })
          ).status,
        ).toBe(201);

        // Customers and riders can't reach it at all.
        const customer = await h.customer('+94773000001');
        expect((await h.http('GET', '/admin/accounts', { token: customer })).status).toBe(403);

        // The new rider signs in with the one-time password and must change it.
        const login = await h.http('POST', '/auth/login', {
          body: { username: rider.body.username, password: rider.body.temporaryPassword },
          headers: { 'x-device-id': 'rider-phone-0001' },
        });
        expect(login.status).toBe(200);
        expect(login.body.setup).toContain('change_password');

        // Reset ends the session and issues a new password.
        const reset = await h.http(
          'POST',
          `/admin/accounts/${rider.body.accountId}/reset-password`,
          {
            token: dispatcher,
          },
        );
        expect(reset.body.temporaryPassword).not.toBe(rider.body.temporaryPassword);
        expect(
          (await h.http('GET', '/auth/me', { token: login.body.tokens.accessToken })).status,
        ).toBe(401);

        // A second phone waits for approval (SEC-06).
        const first = await h.http('POST', '/auth/login', {
          body: { username: rider.body.username, password: reset.body.temporaryPassword },
          headers: { 'x-device-id': 'rider-phone-0002' },
        });
        expect(first.body.error).toBe('device_pending_approval');
        const listed = await h.http('GET', '/admin/accounts?role=rider', { token: dispatcher });
        const mine = listed.body.find((a: { id: string }) => a.id === rider.body.accountId);
        expect(mine.pendingDevices).toEqual([
          expect.objectContaining({ deviceId: 'rider-phone-0002' }),
        ]);
        expect(
          (
            await h.http('POST', `/admin/devices/${mine.pendingDevices[0].id}/approve`, {
              token: dispatcher,
            })
          ).status,
        ).toBe(204);
        const second = await h.http('POST', '/auth/login', {
          body: { username: rider.body.username, password: reset.body.temporaryPassword },
          headers: { 'x-device-id': 'rider-phone-0002' },
        });
        expect(second.status).toBe(200);

        // Deactivation signs out at once.
        expect(
          (
            await h.http('POST', `/admin/accounts/${rider.body.accountId}/status`, {
              token: dispatcher,
              body: { active: false },
            })
          ).status,
        ).toBe(204);
        expect(
          (await h.http('GET', '/auth/me', { token: second.body.tokens.accessToken })).status,
        ).toBe(401);
        const audit = (
          await tx.execute<{ action: string }>(
            sql`select action from audit_log where target_id = ${rider.body.accountId} order by id`,
          )
        ).rows.map((a) => a.action);
        expect(audit).toEqual(
          expect.arrayContaining([
            'account.created',
            'account.password_reset',
            'device.approved',
            'account.deactivated',
          ]),
        );
      }),
    ));
});

describe.skipIf(!testDatabaseUrl)('restaurant onboarding', () => {
  it('goes from onboarding to live once licence, hours, menu and a login are in', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const owner = await h.staff('owner');
        const dispatcher = await h.staff('dispatcher');
        const body = {
          name: 'Test Onboarding Cafe',
          addressText: '5 Lake Road, Jaffna',
          lat: 9.6625,
          lng: 80.0265,
          cuisines: ['Rice'],
          prepMinutes: 15,
        };
        expect(
          (await h.http('POST', '/admin/restaurants', { token: dispatcher, body })).status,
        ).toBe(403);
        const created = await h.http('POST', '/admin/restaurants', { token: owner, body });
        expect(created.status).toBe(201);
        const id = created.body.id;
        expect(created.body).toMatchObject({ status: 'onboarding', lat: 9.6625, lng: 80.0265 });
        expect(created.body.goLiveBlockers).toHaveLength(5);
        expect(
          (
            await h.http('POST', `/admin/restaurants/${id}/status`, {
              token: owner,
              body: { status: 'active' },
            })
          ).body,
        ).toMatchObject({ error: 'not_ready_to_go_live' });

        await h.http('PATCH', `/admin/restaurants/${id}`, {
          token: owner,
          body: {
            licenceNumber: 'PHI-2026-77',
            licenceExpiresOn: '2099-01-01',
            bankDetails: {
              bankName: 'BOC',
              branch: 'Jaffna',
              accountName: 'Test Cafe',
              accountNumber: '00112233',
            },
          },
        });
        await h.http('POST', `/admin/restaurants/${id}/hours`, {
          token: owner,
          body: {
            weekly: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
              weekday,
              opensAt: '00:00',
              closesAt: '00:00',
            })),
          },
        });
        const cat = await h.http('POST', `/admin/restaurants/${id}/categories`, {
          token: owner,
          body: { name: 'Rice' },
        });
        const item = await h.http('POST', `/admin/restaurants/${id}/items`, {
          token: owner,
          body: {
            categoryId: cat.body.id,
            name: 'Chicken Fried Rice',
            priceCents: 95000,
            groups: [
              {
                name: 'Size',
                minSelect: 1,
                maxSelect: 1,
                options: [
                  { name: 'Regular', priceCents: 0 },
                  { name: 'Large', priceCents: 30000 },
                ],
              },
            ],
          },
        });
        expect(item.status).toBe(201);
        // Another restaurant's category is refused.
        const other = await fixtureRestaurant(tx);
        const [otherCat] = (
          await tx.execute<{ id: string }>(
            sql`select id from menu_categories where tenant_id = ${other.tenantId}`,
          )
        ).rows;
        expect(
          (
            await h.http('POST', `/admin/restaurants/${id}/items`, {
              token: owner,
              body: { categoryId: otherCat!.id, name: 'Sneaky', priceCents: 1000 },
            })
          ).status,
        ).toBe(404);

        let detail = (await h.http('GET', `/admin/restaurants/${id}`, { token: owner })).body;
        expect(detail.goLiveBlockers).toEqual(['Create a login for the restaurant']);
        expect(detail.bankDetails).toMatchObject({ accountNumber: '00112233' });
        expect(detail.menu[0].items[0].groups[0].options).toHaveLength(2);

        await h.http('POST', '/admin/accounts', {
          token: owner,
          body: { role: 'restaurant_owner', displayName: 'Cafe Owner', tenantId: id },
        });
        detail = (
          await h.http('POST', `/admin/restaurants/${id}/status`, {
            token: owner,
            body: { status: 'active' },
          })
        ).body;
        expect(detail).toMatchObject({ status: 'active', goLiveBlockers: [], isOpen: true });
        expect(detail.users).toEqual([
          expect.objectContaining({ role: 'restaurant_owner', displayName: 'Cafe Owner' }),
        ]);

        // Now customers see it, and archiving the only item hides it from the menu.
        const customer = await h.customer('+94773000002');
        const list = await h.http('GET', '/restaurants?lat=9.6625&lng=80.0265', {
          token: customer,
        });
        expect(list.body.map((x: { id: string }) => x.id)).toContain(id);
        await h.http('PATCH', `/admin/restaurants/${id}/items/${item.body.id}`, {
          token: owner,
          body: { archived: true },
        });
        const page = await h.http('GET', `/restaurants/${id}`, { token: customer });
        expect(page.body.categories.flatMap((c: { items: unknown[] }) => c.items)).toEqual([]);

        // Suspending takes it off the list at once.
        await h.http('POST', `/admin/restaurants/${id}/status`, {
          token: owner,
          body: { status: 'suspended' },
        });
        const after = await h.http('GET', '/restaurants?lat=9.6625&lng=80.0265', {
          token: customer,
        });
        expect(after.body.map((x: { id: string }) => x.id)).not.toContain(id);
        const audit = (
          await tx.execute<{ after: Record<string, unknown> }>(
            sql`select after from audit_log where target_id = ${id} and action = 'restaurant.updated'`,
          )
        ).rows;
        expect(audit[0]!.after.bankDetails).toBe('changed');
      }),
    ));
});

describe.skipIf(!testDatabaseUrl)('dispatch order detail', () => {
  it('shows who did what, and lets dispatch cancel with a reason', () =>
    inRollback((tx) =>
      withHarness(tx, async (h) => {
        const r = await fixtureRestaurant(tx);
        const token = await h.customer('+94773000003');
        const address = await h.http('POST', '/me/addresses', {
          token,
          body: { label: 'Home', lat: 9.665, lng: 80.0255, addressText: '12 Temple Road' },
        });
        const order = (
          await h.http('POST', '/orders', {
            token,
            key: 'admin-detail-1',
            body: {
              restaurantId: r.tenantId,
              addressId: address.body.id,
              paymentMethod: 'cod',
              items: [{ menuItemId: r.items.kottu, quantity: 1, modifierIds: [r.modifiers.hot] }],
            },
          })
        ).body;
        const kitchen = await h.staff('restaurant_owner', r.tenantId);
        await h.http('POST', `/restaurant/orders/${order.id}/accept`, {
          token: kitchen,
          body: { prepMinutes: 15 },
        });

        const dispatcher = await h.staff('dispatcher');
        expect((await h.http('GET', `/admin/orders/${order.id}`, { token: kitchen })).status).toBe(
          403,
        );
        expect((await h.http('GET', `/admin/orders/${order.id}`, { token })).status).toBe(403);
        const detail = (await h.http('GET', `/admin/orders/${order.id}`, { token: dispatcher }))
          .body;
        expect(detail).toMatchObject({
          reference: order.reference,
          customer: { phone: '+94773000003' },
          deliveryAddress: { addressText: '12 Temple Road' },
          canAdminCancel: true,
          canMarkFailed: false,
        });
        expect(
          detail.events.map((e: { type: string; note: string | null }) => [e.type, e.note]),
        ).toEqual([
          ['placed', null],
          ['restaurant_accepted', '15 min prep'],
        ]);

        const cancelled = await h.http('POST', `/admin/orders/${order.id}/cancel`, {
          token: dispatcher,
          body: { reason: 'Customer phoned to cancel' },
        });
        expect(cancelled.body).toMatchObject({ status: 'cancelled', canAdminCancel: false });
        expect(cancelled.body.events.at(-1)).toMatchObject({
          type: 'cancelled_by_admin',
          note: 'Customer phoned to cancel',
          actor: expect.stringContaining('Dispatch'),
        });
        expect(
          (
            await h.http('POST', `/admin/orders/${order.id}/failed`, {
              token: dispatcher,
              body: { reason: 'No one home' },
            })
          ).body.error,
        ).toBe('invalid_transition');
        expect((await h.http('GET', `/orders/${order.id}`, { token })).body.status).toBe(
          'cancelled',
        );
      }),
    ));
});
