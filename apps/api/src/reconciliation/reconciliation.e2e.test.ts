/*
 * The nightly books check (PRD section 9, control 2): a clean delivery passes; a handover that
 * never reached the ledger is flagged, as is the rider's cash disagreeing two ways.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDb, inRollback, testDatabaseUrl } from '../db/testing.js';
import { cashHandovers } from '../db/schema.js';
import { deliveredCodOrder, onlineRider } from '../testing/flows.js';
import { fixtureRestaurant, withHarness } from '../testing/harness.js';
import { ReconciliationService } from './reconciliation.service.js';

afterAll(closeTestDb);

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });

describe.skipIf(!testDatabaseUrl)('reconciliation', () => {
  it(
    'passes a clean day and flags a handover missing from the ledger',
    () =>
      inRollback((tx) =>
        withHarness(tx, async (h) => {
          const service = h.app.get(ReconciliationService);
          const owner = await h.staff('owner');
          const dispatcher = await h.staff('dispatcher');
          const rider = await onlineRider(h, tx, dispatcher);
          const { order } = await deliveredCodOrder(h, tx, {
            dispatcher,
            rider,
            restaurant: await fixtureRestaurant(tx),
            customerPhone: '+94773000120',
            key: 'reconcile-0001',
          });
          const mine = (run: Awaited<ReturnType<ReconciliationService['run']>>) =>
            run.issues.filter((i) => i.ref === order.reference || i.ref === rider.id);
          expect(mine(await service.run(today()))).toEqual([]);

          // Cash recorded behind the ledger's back.
          const [h1] = await tx
            .insert(cashHandovers)
            .values({
              riderId: rider.id,
              amountCents: 50_000,
              expectedCents: 50_000,
              recordedBy: rider.id,
            })
            .returning();
          const run = await service.run(today());
          expect(run.ok).toBe(false);
          expect(run.issues.map((i) => [i.check, i.ref])).toEqual(
            expect.arrayContaining([
              ['handover_not_in_ledger', h1!.id],
              ['rider_cash_mismatch', rider.id],
            ]),
          );
          // The owner sees it in the app and can run it again.
          expect((await h.http('GET', '/admin/reconciliation', { token: dispatcher })).status).toBe(
            403,
          );
          const list = (await h.http('GET', '/admin/reconciliation', { token: owner })).body;
          expect(list[0]).toMatchObject({ ok: false });
          const notes = (await h.http('GET', '/me/notifications', { token: owner })).body.items;
          expect(notes.map((n: { kind: string }) => n.kind)).toContain('reconciliation_issues');
          expect(h.jobs.schedules.get('reconciliation.nightly')).toBe('30 3 * * *');
        }),
      ),
    180_000,
  );
});
