import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { accounts, notifications } from '../db/schema.js';

/** Active dispatchers and owners. */
export async function officeAccounts(tx: Tx): Promise<string[]> {
  return (
    await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(inArray(accounts.role, ['dispatcher', 'owner']), eq(accounts.status, 'active')))
  ).map((a) => a.id);
}

/**
 * Notifications that don't come from an order event (support cases, refunds). Written in the same
 * transaction as the change; the sender pushes them like any other row.
 */
export async function notify(
  tx: Tx,
  accountIds: string[],
  n: {
    kind: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
    critical?: boolean;
  },
) {
  if (!accountIds.length) return;
  await tx.insert(notifications).values(
    accountIds.map((accountId) => ({
      accountId,
      kind: n.kind,
      title: n.title,
      body: n.body,
      data: n.data ?? {},
      critical: !!n.critical,
    })),
  );
}
