import {
  type AdminRestaurantDetail,
  type AdminRestaurantSummary,
  type BankDetails,
  type HoursInput,
  type MenuItemInput,
  type MenuItemUpdate,
  type ModifierGroup,
  type RestaurantInput,
  type RestaurantUpdate,
} from '@oyo/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { pointOf, openStates } from '../catalog/catalog.service.js';
import { ApiError } from '../common/api-error.js';
import { decrypt, encrypt } from '../common/crypto.js';
import { PLATFORM, withScope, type Database, type Tx } from '../db/client.js';
import {
  accounts,
  auditLog,
  menuCategories,
  menuItems,
  modifierGroups,
  modifiers,
  orders,
  restaurantHours,
  restaurants,
} from '../db/schema.js';
import { listAccounts } from './accounts.service.js';

type RestaurantRow = typeof restaurants.$inferSelect;
type Status = AdminRestaurantSummary['status'];

const colomboToday = (now: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(now);

/**
 * Restaurant onboarding by the owner (ADM-11, ADM-12): profile, licence, payout bank details,
 * hours, logins and the first menu, entered directly as approved. A restaurant only goes live
 * once nothing blocks it.
 */
export class AdminRestaurantsService {
  constructor(
    private readonly db: Database,
    private readonly encryptionKey: Buffer,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async audit(
    tx: Tx,
    auth: AuthContext,
    action: string,
    targetId: string,
    after?: Record<string, unknown>,
  ) {
    await tx.insert(auditLog).values({
      actorAccountId: auth.accountId,
      actorRole: auth.role,
      action,
      targetType: 'restaurant',
      targetId,
      after,
      deviceId: auth.deviceId,
    });
  }

  private async row(tx: Tx, id: string, lock = false): Promise<RestaurantRow> {
    const q = tx.select().from(restaurants).where(eq(restaurants.id, id));
    const [r] = lock ? await q.for('update') : await q;
    if (!r) throw new ApiError('not_found', { what: 'restaurant' });
    return r;
  }

  private profileValues(input: RestaurantUpdate) {
    return {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.addressText !== undefined && { addressText: input.addressText }),
      ...(input.lat !== undefined &&
        input.lng !== undefined && { location: { x: input.lng, y: input.lat } }),
      ...(input.cuisines !== undefined && { cuisines: input.cuisines }),
      ...(input.prepMinutes !== undefined && { prepMinutes: input.prepMinutes }),
      ...(input.licenceNumber !== undefined && { licenceNumber: input.licenceNumber }),
      ...(input.licenceExpiresOn !== undefined && { licenceExpiresOn: input.licenceExpiresOn }),
      ...(input.bankDetails !== undefined && {
        bankDetailsCiphertext: encrypt(this.encryptionKey, JSON.stringify(input.bankDetails)),
      }),
    };
  }

  /** What still stops a restaurant going live. */
  private async blockers(tx: Tx, r: RestaurantRow): Promise<string[]> {
    const today = colomboToday(this.clock());
    const [[hours], [items], [logins]] = await Promise.all([
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(restaurantHours)
        .where(eq(restaurantHours.tenantId, r.id)),
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(menuItems)
        .where(
          and(
            eq(menuItems.tenantId, r.id),
            eq(menuItems.approvalStatus, 'approved'),
            sql`${menuItems.archivedAt} is null`,
          ),
        ),
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(accounts)
        .where(and(eq(accounts.tenantId, r.id), eq(accounts.status, 'active'))),
    ]);
    const out: string[] = [];
    if (!r.licenceNumber || !r.licenceExpiresOn)
      out.push('Add the food-handling licence and its expiry date');
    else if (r.licenceExpiresOn < today) out.push('The licence has expired');
    if (!r.bankDetailsCiphertext) out.push('Add the payout bank account');
    if (!hours!.n) out.push('Set the opening hours');
    if (!items!.n) out.push('Add at least one menu item');
    if (!logins!.n) out.push('Create a login for the restaurant');
    return out;
  }

  private async summaries(tx: Tx, rows: RestaurantRow[]): Promise<AdminRestaurantSummary[]> {
    const now = this.clock();
    const ids = rows.map((r) => r.id);
    const [open, counts] = await Promise.all([
      openStates(tx, rows, now),
      ids.length
        ? tx
            .select({ tenantId: orders.tenantId, n: sql<number>`count(*)::int` })
            .from(orders)
            .where(
              and(
                inArray(orders.tenantId, ids),
                sql`${orders.placedAt} >= (date_trunc('day', now() at time zone 'Asia/Colombo') at time zone 'Asia/Colombo')`,
              ),
            )
            .groupBy(orders.tenantId)
        : [],
    ]);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status as Status,
      addressText: r.addressText,
      isOpen: open.get(r.id) ?? false,
      ordersToday: counts.find((c) => c.tenantId === r.id)?.n ?? 0,
      licenceExpiresOn: r.licenceExpiresOn,
    }));
  }

  list(): Promise<AdminRestaurantSummary[]> {
    return withScope(this.db, PLATFORM, async (tx) =>
      this.summaries(tx, await tx.select().from(restaurants).orderBy(asc(restaurants.name))),
    );
  }

  get(auth: AuthContext, id: string): Promise<AdminRestaurantDetail> {
    return withScope(this.db, PLATFORM, (tx) => this.detail(tx, auth, id));
  }

  private async detail(tx: Tx, auth: AuthContext, id: string): Promise<AdminRestaurantDetail> {
    const r = await this.row(tx, id);
    const [[summary], hours, categories, items, users, goLiveBlockers] = await Promise.all([
      this.summaries(tx, [r]),
      tx
        .select()
        .from(restaurantHours)
        .where(eq(restaurantHours.tenantId, id))
        .orderBy(asc(restaurantHours.weekday), asc(restaurantHours.opensAt)),
      tx
        .select()
        .from(menuCategories)
        .where(eq(menuCategories.tenantId, id))
        .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name)),
      tx
        .select()
        .from(menuItems)
        .where(and(eq(menuItems.tenantId, id), eq(menuItems.approvalStatus, 'approved')))
        .orderBy(asc(menuItems.createdAt)),
      listAccounts(tx, auth, { tenantId: id }),
      this.blockers(tx, r),
    ]);
    const groups = items.length
      ? await tx
          .select()
          .from(modifierGroups)
          .where(
            inArray(
              modifierGroups.menuItemId,
              items.map((i) => i.id),
            ),
          )
          .orderBy(asc(modifierGroups.sortOrder))
      : [];
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
    const point = pointOf(r);
    return {
      ...summary!,
      lat: point.lat,
      lng: point.lng,
      cuisines: r.cuisines,
      prepMinutes: r.prepMinutes,
      licenceNumber: r.licenceNumber,
      bankDetails: r.bankDetailsCiphertext
        ? (JSON.parse(decrypt(this.encryptionKey, r.bankDetailsCiphertext)) as BankDetails)
        : null,
      weekly: hours.map((h) => ({
        weekday: h.weekday,
        opensAt: h.opensAt.slice(0, 5),
        closesAt: h.closesAt.slice(0, 5),
      })),
      users,
      menu: categories.map((c) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder,
        items: items
          .filter((i) => i.categoryId === c.id)
          .map((i) => ({
            id: i.id,
            name: i.name,
            description: i.description,
            priceCents: i.priceCents,
            photoUrl: null,
            dietaryTags: i.dietaryTags,
            soldOut: i.soldOut,
            archived: i.archivedAt !== null,
            groups: groups
              .filter((g) => g.menuItemId === i.id)
              .map((g): ModifierGroup => ({
                id: g.id,
                name: g.name,
                minSelect: g.minSelect,
                maxSelect: g.maxSelect,
                options: options
                  .filter((o) => o.groupId === g.id)
                  .map((o) => ({
                    id: o.id,
                    name: o.name,
                    priceCents: o.priceCents,
                    soldOut: o.soldOut,
                  })),
              })),
          })),
      })),
      goLiveBlockers,
    };
  }

  /** New restaurants start in onboarding: not listed until activated. */
  create(auth: AuthContext, input: RestaurantInput): Promise<AdminRestaurantDetail> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const [r] = await tx
        .insert(restaurants)
        .values({
          ...this.profileValues(input),
          name: input.name,
          addressText: input.addressText,
          location: { x: input.lng, y: input.lat },
          status: 'onboarding',
        })
        .returning();
      await this.audit(tx, auth, 'restaurant.created', r!.id, { name: input.name });
      return this.detail(tx, auth, r!.id);
    });
  }

  update(auth: AuthContext, id: string, input: RestaurantUpdate): Promise<AdminRestaurantDetail> {
    if ((input.lat === undefined) !== (input.lng === undefined))
      throw new ApiError('invalid_input', { field: 'lat/lng' });
    return withScope(this.db, PLATFORM, async (tx) => {
      await this.row(tx, id, true);
      const values = this.profileValues(input);
      if (Object.keys(values).length)
        await tx.update(restaurants).set(values).where(eq(restaurants.id, id));
      // Bank details are never written to the audit log in clear.
      const { bankDetails, ...changed } = input;
      await this.audit(tx, auth, 'restaurant.updated', id, {
        ...changed,
        ...(bankDetails && { bankDetails: 'changed' }),
      });
      return this.detail(tx, auth, id);
    });
  }

  /** Going live needs every blocker cleared; suspending hides it at once (ADM-11). */
  setStatus(auth: AuthContext, id: string, status: Status): Promise<AdminRestaurantDetail> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const r = await this.row(tx, id, true);
      if (status === 'active') {
        const blockers = await this.blockers(tx, r);
        if (blockers.length) throw new ApiError('not_ready_to_go_live', { blockers });
      }
      await tx.update(restaurants).set({ status }).where(eq(restaurants.id, id));
      await this.audit(tx, auth, 'restaurant.status', id, { from: r.status, to: status });
      return this.detail(tx, auth, id);
    });
  }

  /** Replaces the weekly hours. Several ranges a day are fine (split shifts); equal times mean all day. */
  setHours(auth: AuthContext, id: string, input: HoursInput): Promise<AdminRestaurantDetail> {
    return withScope(this.db, PLATFORM, async (tx) => {
      await this.row(tx, id, true);
      await tx.delete(restaurantHours).where(eq(restaurantHours.tenantId, id));
      if (input.weekly.length) {
        await tx.insert(restaurantHours).values(input.weekly.map((h) => ({ tenantId: id, ...h })));
      }
      await this.audit(tx, auth, 'restaurant.hours', id, { weekly: input.weekly });
      return this.detail(tx, auth, id);
    });
  }

  addCategory(auth: AuthContext, id: string, input: { name: string; sortOrder: number }) {
    return withScope(this.db, PLATFORM, async (tx) => {
      await this.row(tx, id);
      const [c] = await tx
        .insert(menuCategories)
        .values({ tenantId: id, ...input })
        .returning();
      await this.audit(tx, auth, 'menu.category_created', id, {
        categoryId: c!.id,
        name: input.name,
      });
      return { id: c!.id };
    });
  }

  /** Items the owner enters are approved at once (ADM-12); restaurant-made items wait for review. */
  addItem(auth: AuthContext, id: string, input: MenuItemInput) {
    for (const g of input.groups) {
      if (g.minSelect > g.maxSelect || g.minSelect > g.options.length) {
        throw new ApiError('invalid_input', { field: 'groups', group: g.name });
      }
    }
    return withScope(this.db, PLATFORM, async (tx) => {
      await this.row(tx, id);
      const [category] = await tx
        .select()
        .from(menuCategories)
        .where(and(eq(menuCategories.id, input.categoryId), eq(menuCategories.tenantId, id)));
      if (!category) throw new ApiError('not_found', { what: 'category' });
      const [item] = await tx
        .insert(menuItems)
        .values({
          tenantId: id,
          categoryId: input.categoryId,
          name: input.name,
          description: input.description ?? null,
          priceCents: input.priceCents,
          dietaryTags: input.dietaryTags,
          approvalStatus: 'approved',
        })
        .returning();
      for (const [n, g] of input.groups.entries()) {
        const [group] = await tx
          .insert(modifierGroups)
          .values({
            tenantId: id,
            menuItemId: item!.id,
            name: g.name,
            minSelect: g.minSelect,
            maxSelect: Math.min(g.maxSelect, g.options.length),
            sortOrder: n,
          })
          .returning();
        await tx.insert(modifiers).values(
          g.options.map((o) => ({
            tenantId: id,
            groupId: group!.id,
            name: o.name,
            priceCents: o.priceCents,
          })),
        );
      }
      await this.audit(tx, auth, 'menu.item_created', id, {
        menuItemId: item!.id,
        name: input.name,
        priceCents: input.priceCents,
      });
      return { id: item!.id };
    });
  }

  updateItem(auth: AuthContext, id: string, itemId: string, input: MenuItemUpdate) {
    return withScope(this.db, PLATFORM, async (tx) => {
      const [item] = await tx
        .select()
        .from(menuItems)
        .where(and(eq(menuItems.id, itemId), eq(menuItems.tenantId, id)))
        .for('update');
      if (!item) throw new ApiError('not_found', { what: 'menu_item' });
      const { archived, ...rest } = input;
      await tx
        .update(menuItems)
        .set({
          ...rest,
          ...(archived !== undefined && {
            archivedAt: archived ? (item.archivedAt ?? this.clock()) : null,
          }),
        })
        .where(eq(menuItems.id, itemId));
      await this.audit(tx, auth, 'menu.item_updated', id, {
        menuItemId: itemId,
        before: { name: item.name, priceCents: item.priceCents, soldOut: item.soldOut },
        ...input,
      });
    });
  }
}
