import {
  isOpenAt,
  type HoursInput,
  type HoursOverrideInput,
  type MenuChangeRequest,
  type MenuEditRequestInput,
  type MenuItemFields,
  type MenuItemInput,
  type ModifierGroup,
  type RestaurantHours,
  type RestaurantMenu,
  type RestaurantMenuItem,
} from '@oyo/shared';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { scopeFor } from '../auth/scope.js';
import { ApiError } from '../common/api-error.js';
import { withScope, type Database, type Tx } from '../db/client.js';
import {
  menuCategories,
  menuChangeRequests,
  menuItems,
  modifierGroups,
  modifiers,
  restaurantHourOverrides,
  restaurantHours,
  restaurants,
} from '../db/schema.js';

type ItemRow = typeof menuItems.$inferSelect;
type RequestRow = typeof menuChangeRequests.$inferSelect;

export const fieldsOf = (i: ItemRow, categoryName: string): MenuItemFields => ({
  name: i.name,
  description: i.description,
  priceCents: i.priceCents,
  categoryName,
});

/** Choice groups and options for a set of items. */
export async function groupsFor(tx: Tx, itemIds: string[]) {
  if (!itemIds.length) return new Map<string, ModifierGroup[]>();
  const groups = await tx
    .select()
    .from(modifierGroups)
    .where(inArray(modifierGroups.menuItemId, itemIds))
    .orderBy(asc(modifierGroups.sortOrder));
  const options = groups.length
    ? await tx
        .select()
        .from(modifiers)
        .where(
          inArray(
            modifiers.groupId,
            groups.map((g) => g.id),
          ),
        )
    : [];
  const out = new Map<string, ModifierGroup[]>();
  for (const g of groups) {
    out.set(g.menuItemId, [
      ...(out.get(g.menuItemId) ?? []),
      {
        id: g.id,
        name: g.name,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        options: options
          .filter((o) => o.groupId === g.id)
          .map((o) => ({ id: o.id, name: o.name, priceCents: o.priceCents, soldOut: o.soldOut })),
      },
    ]);
  }
  return out;
}

/** Shapes change requests for both the restaurant (T09) and the reviewer (A15). */
export async function describeRequests(tx: Tx, rows: RequestRow[]): Promise<MenuChangeRequest[]> {
  if (!rows.length) return [];
  const tenantIds = [...new Set(rows.map((r) => r.tenantId))];
  const [cats, names] = await Promise.all([
    tx.select().from(menuCategories).where(inArray(menuCategories.tenantId, tenantIds)),
    tx
      .select({ id: restaurants.id, name: restaurants.name })
      .from(restaurants)
      .where(inArray(restaurants.id, tenantIds)),
  ]);
  const itemIds = rows.map((r) => r.menuItemId).filter((x): x is string => !!x);
  const groups = await groupsFor(
    tx,
    rows.filter((r) => r.kind === 'new_item' && r.menuItemId).map((r) => r.menuItemId!),
  );
  const items = itemIds.length
    ? await tx.select().from(menuItems).where(inArray(menuItems.id, itemIds))
    : [];
  const catName = (id: unknown) => cats.find((c) => c.id === id)?.name ?? '—';
  return rows.map((r) => {
    const before = r.before as
      (Omit<MenuItemFields, 'categoryName'> & { categoryId: string }) | null;
    const after = r.after as Partial<Omit<MenuItemFields, 'categoryName'>> & {
      categoryId?: string;
    };
    const item = items.find((i) => i.id === r.menuItemId);
    const beforeFields = before ? { ...before, categoryName: catName(before.categoryId) } : null;
    const base = beforeFields ?? {
      name: item?.name ?? '',
      description: item?.description ?? null,
      priceCents: item?.priceCents ?? 0,
      categoryName: catName(item?.categoryId),
    };
    return {
      id: r.id,
      kind: r.kind as MenuChangeRequest['kind'],
      menuItemId: r.menuItemId,
      itemName: before?.name ?? after.name ?? item?.name ?? 'Item',
      before: r.kind === 'edit' ? beforeFields : null,
      after: {
        name: after.name ?? base.name,
        description: after.description !== undefined ? after.description : base.description,
        priceCents: after.priceCents ?? base.priceCents,
        categoryName: after.categoryId ? catName(after.categoryId) : base.categoryName,
      },
      groups: (groups.get(r.menuItemId ?? '') ?? []).map((g) => ({
        name: g.name,
        required: g.minSelect > 0,
        options: g.options.map((o) => (o.priceCents ? `${o.name} +${o.priceCents / 100}` : o.name)),
      })),
      status: r.status,
      adminNote: r.adminNote,
      restaurantId: r.tenantId,
      restaurantName: names.find((n) => n.id === r.tenantId)?.name ?? '',
      createdAt: r.createdAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
    };
  });
}

/**
 * The restaurant's own menu and hours (T07-T10, RES-08 to RES-10), under tenant RLS. Stock and
 * hours change instantly; new items and changes to live items wait for Oyo Eats (ADM-12).
 */
export class RestaurantMenuService {
  constructor(private readonly db: Database) {}

  private tenant(auth: AuthContext) {
    return auth.tenantId!;
  }

  menu(auth: AuthContext): Promise<RestaurantMenu> {
    return withScope(this.db, scopeFor(auth), async (tx) => {
      const t = this.tenant(auth);
      const [cats, items, pending] = await Promise.all([
        tx
          .select()
          .from(menuCategories)
          .where(eq(menuCategories.tenantId, t))
          .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name)),
        tx
          .select()
          .from(menuItems)
          .where(and(eq(menuItems.tenantId, t), isNull(menuItems.archivedAt)))
          .orderBy(asc(menuItems.createdAt)),
        tx
          .select()
          .from(menuChangeRequests)
          .where(and(eq(menuChangeRequests.tenantId, t), eq(menuChangeRequests.status, 'pending'))),
      ]);
      const groups = await groupsFor(
        tx,
        items.map((i) => i.id),
      );
      const catName = (id: string) => cats.find((c) => c.id === id)?.name ?? '';
      const toItem = (i: ItemRow): RestaurantMenuItem => {
        const change = pending.find((p) => p.kind === 'edit' && p.menuItemId === i.id);
        const after = change?.after as
          (Partial<MenuItemFields> & { categoryId?: string }) | undefined;
        return {
          id: i.id,
          categoryId: i.categoryId,
          name: i.name,
          description: i.description,
          priceCents: i.priceCents,
          photoUrl: null,
          dietaryTags: i.dietaryTags,
          soldOut: i.soldOut,
          groups: groups.get(i.id) ?? [],
          status:
            i.approvalStatus === 'approved'
              ? 'live'
              : i.approvalStatus === 'pending'
                ? 'pending'
                : 'rejected',
          pendingChange:
            change && after
              ? {
                  requestId: change.id,
                  after: {
                    name: after.name ?? i.name,
                    description:
                      after.description !== undefined ? (after.description ?? null) : i.description,
                    priceCents: after.priceCents ?? i.priceCents,
                    categoryName: catName(after.categoryId ?? i.categoryId),
                  },
                }
              : null,
        };
      };
      return {
        categories: cats.map((c) => ({
          id: c.id,
          name: c.name,
          items: items.filter((i) => i.categoryId === c.id).map(toItem),
        })),
        pendingRequests: pending.length,
      };
    });
  }

  /** Categories hold no prices, so adding one is instant. */
  addCategory(auth: AuthContext, name: string): Promise<{ id: string }> {
    return withScope(this.db, scopeFor(auth), async (tx) => {
      const t = this.tenant(auth);
      const existing = await tx.select().from(menuCategories).where(eq(menuCategories.tenantId, t));
      if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase()))
        throw new ApiError('invalid_input', { field: 'name', reason: 'exists' });
      const [c] = await tx
        .insert(menuCategories)
        .values({ tenantId: t, name, sortOrder: existing.length })
        .returning({ id: menuCategories.id });
      return c!;
    });
  }

  /** Sold out / back in stock: instant (RES-08). */
  setStock(auth: AuthContext, itemId: string, soldOut: boolean): Promise<void> {
    return withScope(this.db, scopeFor(auth), async (tx) => {
      const [row] = await tx
        .update(menuItems)
        .set({ soldOut })
        .where(and(eq(menuItems.id, itemId), eq(menuItems.tenantId, this.tenant(auth))))
        .returning({ id: menuItems.id });
      if (!row) throw new ApiError('not_found');
    });
  }

  /** A new item: saved as pending (hidden from customers) with a request for approval. */
  addItem(auth: AuthContext, input: MenuItemInput): Promise<{ id: string; requestId: string }> {
    for (const g of input.groups) {
      if (g.minSelect > g.maxSelect || g.minSelect > g.options.length)
        throw new ApiError('invalid_input', { field: 'groups', group: g.name });
    }
    return withScope(this.db, scopeFor(auth), async (tx) => {
      const t = this.tenant(auth);
      const [cat] = await tx
        .select()
        .from(menuCategories)
        .where(and(eq(menuCategories.id, input.categoryId), eq(menuCategories.tenantId, t)));
      if (!cat) throw new ApiError('not_found', { what: 'category' });
      const [item] = await tx
        .insert(menuItems)
        .values({
          tenantId: t,
          categoryId: input.categoryId,
          name: input.name,
          description: input.description ?? null,
          priceCents: input.priceCents,
          dietaryTags: input.dietaryTags,
          approvalStatus: 'pending',
        })
        .returning();
      for (const [n, g] of input.groups.entries()) {
        const [group] = await tx
          .insert(modifierGroups)
          .values({
            tenantId: t,
            menuItemId: item!.id,
            name: g.name,
            minSelect: g.minSelect,
            maxSelect: Math.min(g.maxSelect, g.options.length),
            sortOrder: n,
          })
          .returning();
        await tx.insert(modifiers).values(
          g.options.map((o) => ({
            tenantId: t,
            groupId: group!.id,
            name: o.name,
            priceCents: o.priceCents,
          })),
        );
      }
      const [req] = await tx
        .insert(menuChangeRequests)
        .values({
          tenantId: t,
          menuItemId: item!.id,
          kind: 'new_item',
          after: {
            name: input.name,
            description: input.description ?? null,
            priceCents: input.priceCents,
            categoryId: input.categoryId,
          },
          requestedBy: auth.accountId,
        })
        .returning({ id: menuChangeRequests.id });
      return { id: item!.id, requestId: req!.id };
    });
  }

  /**
   * A change to a live item. One waiting change per item: withdraw it to send another. Customers
   * keep seeing the live values until it's approved.
   */
  requestChange(
    auth: AuthContext,
    itemId: string,
    input: MenuEditRequestInput,
  ): Promise<{ requestId: string }> {
    return withScope(this.db, scopeFor(auth), async (tx) => {
      const t = this.tenant(auth);
      const [item] = await tx
        .select()
        .from(menuItems)
        .where(
          and(eq(menuItems.id, itemId), eq(menuItems.tenantId, t), isNull(menuItems.archivedAt)),
        );
      if (!item) throw new ApiError('not_found');
      if (item.approvalStatus !== 'approved')
        throw new ApiError('invalid_transition', { status: item.approvalStatus });
      if (input.categoryId) {
        const [cat] = await tx
          .select()
          .from(menuCategories)
          .where(and(eq(menuCategories.id, input.categoryId), eq(menuCategories.tenantId, t)));
        if (!cat) throw new ApiError('not_found', { what: 'category' });
      }
      const [open] = await tx
        .select({ id: menuChangeRequests.id })
        .from(menuChangeRequests)
        .where(
          and(eq(menuChangeRequests.menuItemId, itemId), eq(menuChangeRequests.status, 'pending')),
        );
      if (open) throw new ApiError('change_pending');
      // Only what actually differs.
      const after: Record<string, unknown> = {};
      if (input.name !== undefined && input.name !== item.name) after.name = input.name;
      if (input.description !== undefined && (input.description || null) !== item.description)
        after.description = input.description || null;
      if (input.priceCents !== undefined && input.priceCents !== item.priceCents)
        after.priceCents = input.priceCents;
      if (input.categoryId !== undefined && input.categoryId !== item.categoryId)
        after.categoryId = input.categoryId;
      if (!Object.keys(after).length) throw new ApiError('invalid_input', { reason: 'no_change' });
      const [req] = await tx
        .insert(menuChangeRequests)
        .values({
          tenantId: t,
          menuItemId: itemId,
          kind: 'edit',
          before: {
            name: item.name,
            description: item.description,
            priceCents: item.priceCents,
            categoryId: item.categoryId,
          },
          after,
          requestedBy: auth.accountId,
        })
        .returning({ id: menuChangeRequests.id });
      return { requestId: req!.id };
    });
  }

  requests(auth: AuthContext): Promise<MenuChangeRequest[]> {
    return withScope(this.db, scopeFor(auth), async (tx) =>
      describeRequests(
        tx,
        await tx
          .select()
          .from(menuChangeRequests)
          .where(eq(menuChangeRequests.tenantId, this.tenant(auth)))
          .orderBy(desc(menuChangeRequests.createdAt))
          .limit(50),
      ),
    );
  }

  /** Take back a waiting request; a withdrawn new item is removed. */
  withdraw(auth: AuthContext, requestId: string): Promise<void> {
    return withScope(this.db, scopeFor(auth), async (tx) => {
      const [req] = await tx
        .select()
        .from(menuChangeRequests)
        .where(
          and(
            eq(menuChangeRequests.id, requestId),
            eq(menuChangeRequests.tenantId, this.tenant(auth)),
          ),
        )
        .for('update');
      if (!req || req.status !== 'pending') throw new ApiError('not_found');
      await tx.delete(menuChangeRequests).where(eq(menuChangeRequests.id, requestId));
      if (req.kind === 'new_item' && req.menuItemId) {
        await tx
          .update(menuItems)
          .set({ archivedAt: new Date() })
          .where(eq(menuItems.id, req.menuItemId));
      }
    });
  }

  hours(auth: AuthContext): Promise<RestaurantHours> {
    return withScope(this.db, scopeFor(auth), async (tx) => {
      const t = this.tenant(auth);
      const [[r], weekly, closures] = await Promise.all([
        tx.select().from(restaurants).where(eq(restaurants.id, t)),
        tx
          .select()
          .from(restaurantHours)
          .where(eq(restaurantHours.tenantId, t))
          .orderBy(asc(restaurantHours.weekday), asc(restaurantHours.opensAt)),
        tx
          .select()
          .from(restaurantHourOverrides)
          .where(eq(restaurantHourOverrides.tenantId, t))
          .orderBy(asc(restaurantHourOverrides.date)),
      ]);
      if (!r) throw new ApiError('not_found');
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(
        new Date(),
      );
      const now = new Date();
      const licenceValid = !!r.licenceExpiresOn && r.licenceExpiresOn >= today;
      const isOpen =
        r.status === 'active' &&
        licenceValid &&
        isOpenAt(
          now,
          weekly,
          closures.map((c) => ({ ...c, opensAt: c.opensAt, closesAt: c.closesAt })),
          r.pausedUntil,
        );
      return {
        weekly: weekly.map((h) => ({
          weekday: h.weekday,
          opensAt: h.opensAt.slice(0, 5),
          closesAt: h.closesAt.slice(0, 5),
        })),
        closures: closures
          .filter((c) => c.date >= today)
          .map((c) => ({
            id: c.id,
            date: c.date,
            closed: c.closed,
            opensAt: c.opensAt?.slice(0, 5) ?? null,
            closesAt: c.closesAt?.slice(0, 5) ?? null,
          })),
        pausedUntil:
          r.pausedUntil && r.pausedUntil > new Date() ? r.pausedUntil.toISOString() : null,
        isOpen,
      };
    });
  }

  /** Weekly hours: instant (RES-10). Equal times mean open all day. */
  setHours(auth: AuthContext, input: HoursInput): Promise<RestaurantHours> {
    return withScope(this.db, scopeFor(auth), async (tx) => {
      const t = this.tenant(auth);
      await tx.delete(restaurantHours).where(eq(restaurantHours.tenantId, t));
      if (input.weekly.length)
        await tx.insert(restaurantHours).values(input.weekly.map((h) => ({ tenantId: t, ...h })));
    }).then(() => this.hours(auth));
  }

  /** A holiday or special hours on one date; replaces anything already set for that date. */
  addClosure(auth: AuthContext, input: HoursOverrideInput): Promise<RestaurantHours> {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date());
    if (input.date < today) throw new ApiError('invalid_input', { field: 'date', reason: 'past' });
    return withScope(this.db, scopeFor(auth), async (tx) => {
      const t = this.tenant(auth);
      await tx
        .delete(restaurantHourOverrides)
        .where(
          and(
            eq(restaurantHourOverrides.tenantId, t),
            eq(restaurantHourOverrides.date, input.date),
          ),
        );
      await tx.insert(restaurantHourOverrides).values({
        tenantId: t,
        date: input.date,
        closed: input.closed,
        opensAt: input.closed ? null : input.opensAt!,
        closesAt: input.closed ? null : input.closesAt!,
      });
    }).then(() => this.hours(auth));
  }

  removeClosure(auth: AuthContext, id: string): Promise<RestaurantHours> {
    return withScope(this.db, scopeFor(auth), async (tx) => {
      const [row] = await tx
        .delete(restaurantHourOverrides)
        .where(
          and(
            eq(restaurantHourOverrides.id, id),
            eq(restaurantHourOverrides.tenantId, this.tenant(auth)),
          ),
        )
        .returning({ id: restaurantHourOverrides.id });
      if (!row) throw new ApiError('not_found');
    }).then(() => this.hours(auth));
  }
}
