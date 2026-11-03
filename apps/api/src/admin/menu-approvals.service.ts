import type { MenuChangeRequest, MenuReviewInput } from '@oyo/shared';
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { ApiError } from '../common/api-error.js';
import { PLATFORM, withScope, type Database } from '../db/client.js';
import { auditLog, menuChangeRequests, menuItems } from '../db/schema.js';
import { describeRequests } from '../restaurant/menu.service.js';

/** A15: the owner approves or rejects restaurant menu changes (ADM-12). Approval is instant. */
export class MenuApprovalsService {
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Waiting (oldest first), then the most recent decisions. */
  list(): Promise<{ pending: MenuChangeRequest[]; recent: MenuChangeRequest[] }> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const [pending, recent] = await Promise.all([
        tx
          .select()
          .from(menuChangeRequests)
          .where(eq(menuChangeRequests.status, 'pending'))
          .orderBy(asc(menuChangeRequests.createdAt)),
        tx
          .select()
          .from(menuChangeRequests)
          .where(ne(menuChangeRequests.status, 'pending'))
          .orderBy(desc(menuChangeRequests.reviewedAt))
          .limit(20),
      ]);
      return {
        pending: await describeRequests(tx, pending),
        recent: await describeRequests(tx, recent),
      };
    });
  }

  review(auth: AuthContext, id: string, input: MenuReviewInput): Promise<MenuChangeRequest> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const [req] = await tx
        .select()
        .from(menuChangeRequests)
        .where(eq(menuChangeRequests.id, id))
        .for('update');
      if (!req) throw new ApiError('not_found');
      if (req.status !== 'pending')
        throw new ApiError('invalid_transition', { status: req.status });
      const [item] = req.menuItemId
        ? await tx.select().from(menuItems).where(eq(menuItems.id, req.menuItemId)).for('update')
        : [];
      if (!item || item.archivedAt) throw new ApiError('not_found', { what: 'menu_item' });

      if (req.kind === 'new_item') {
        await tx
          .update(menuItems)
          .set({ approvalStatus: input.approve ? 'approved' : 'rejected' })
          .where(eq(menuItems.id, item.id));
      } else if (input.approve) {
        const after = req.after as {
          name?: string;
          description?: string | null;
          priceCents?: number;
          categoryId?: string;
        };
        await tx
          .update(menuItems)
          .set({
            ...(after.name !== undefined && { name: after.name }),
            ...(after.description !== undefined && { description: after.description }),
            ...(after.priceCents !== undefined && { priceCents: after.priceCents }),
            ...(after.categoryId !== undefined && { categoryId: after.categoryId }),
          })
          .where(and(eq(menuItems.id, item.id), eq(menuItems.tenantId, req.tenantId)));
      }
      const now = this.clock();
      const [updated] = await tx
        .update(menuChangeRequests)
        .set({
          status: input.approve ? 'approved' : 'rejected',
          adminNote: input.note ?? null,
          reviewedBy: auth.accountId,
          reviewedAt: now,
        })
        .where(eq(menuChangeRequests.id, id))
        .returning();
      await tx.insert(auditLog).values({
        actorAccountId: auth.accountId,
        actorRole: auth.role,
        action: input.approve ? 'menu.change_approved' : 'menu.change_rejected',
        targetType: 'menu_item',
        targetId: item.id,
        before: req.before as Record<string, unknown> | null,
        after: { ...(req.after as Record<string, unknown>), note: input.note },
        deviceId: auth.deviceId,
      });
      const [described] = await describeRequests(tx, [updated!]);
      return described!;
    });
  }
}
