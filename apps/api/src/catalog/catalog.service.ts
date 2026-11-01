import {
  deliveryFee,
  estimateDeliveryRange,
  isOpenAt,
  type MenuItem,
  type ModifierGroup,
  type RestaurantDetail,
  type RestaurantQuery,
  type RestaurantSummary,
} from '@oyo/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ApiError } from '../common/api-error.js';
import { PLATFORM, withScope, type Database, type Tx } from '../db/client.js';
import {
  menuCategories,
  menuItems,
  modifierGroups,
  modifiers,
  restaurantHourOverrides,
  restaurantHours,
  restaurants,
  reviews,
} from '../db/schema.js';
import type { Point, Routing } from '../routing/routing.js';
import { loadSettings } from '../settings/settings.js';

type RestaurantRow = typeof restaurants.$inferSelect;

/** Listed and orderable: active, with a food-handling licence that hasn't lapsed (section 12). */
function orderable(r: RestaurantRow, now: Date): boolean {
  if (r.status !== 'active' || !r.licenceExpiresOn) return false;
  return r.licenceExpiresOn >= now.toISOString().slice(0, 10);
}

export const pointOf = (r: RestaurantRow): Point => ({ lat: r.location.y, lng: r.location.x });

/** Opening state for a set of restaurants, from their weekly hours and overrides. */
export async function openStates(
  tx: Tx,
  rows: RestaurantRow[],
  now: Date,
): Promise<Map<string, boolean>> {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return new Map();
  const [hours, overrides] = await Promise.all([
    tx.select().from(restaurantHours).where(inArray(restaurantHours.tenantId, ids)),
    tx.select().from(restaurantHourOverrides).where(inArray(restaurantHourOverrides.tenantId, ids)),
  ]);
  return new Map(
    rows.map((r) => [
      r.id,
      orderable(r, now) &&
        isOpenAt(
          now,
          hours.filter((h) => h.tenantId === r.id),
          overrides.filter((o) => o.tenantId === r.id),
          r.pausedUntil,
        ),
    ]),
  );
}

async function ratings(tx: Tx, ids: string[]) {
  if (ids.length === 0) return new Map<string, { rating: number; count: number }>();
  const rows = await tx
    .select({
      tenantId: reviews.tenantId,
      rating: sql<string>`avg(${reviews.rating})`,
      count: sql<number>`count(*)::int`,
    })
    .from(reviews)
    .where(
      and(
        inArray(reviews.tenantId, ids),
        eq(reviews.subject, 'restaurant'),
        eq(reviews.hidden, false),
      ),
    )
    .groupBy(reviews.tenantId);
  return new Map(
    rows.map((r) => [
      r.tenantId,
      { rating: Math.round(Number(r.rating) * 10) / 10, count: r.count },
    ]),
  );
}

export class CatalogService {
  constructor(
    private readonly db: Database,
    private readonly routing: Routing,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Home and search (CUS-03): restaurants that deliver to the point, open ones first. */
  async list(query: RestaurantQuery): Promise<RestaurantSummary[]> {
    const now = this.clock();
    const here = { lat: query.lat, lng: query.lng };
    return withScope(this.db, PLATFORM, async (tx) => {
      const settings = await loadSettings(tx);
      const point = sql`ST_SetSRID(ST_MakePoint(${query.lng}, ${query.lat}), 4326)::geography`;
      const conditions = [
        eq(restaurants.status, 'active'),
        sql`ST_DWithin(${restaurants.location}::geography, ${point}, ${settings.deliveryFee.maxRadiusMeters})`,
      ];
      if (query.cuisine) conditions.push(sql`${query.cuisine} = any(${restaurants.cuisines})`);
      if (query.q) {
        const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        conditions.push(sql`(
          ${restaurants.name} ilike ${like}
          or array_to_string(${restaurants.cuisines}, ' ') ilike ${like}
          or exists (
            select 1 from ${menuItems}
            where ${menuItems.tenantId} = ${restaurants.id}
              and ${menuItems.approvalStatus} = 'approved'
              and ${menuItems.archivedAt} is null
              and ${menuItems.name} ilike ${like}
          )
        )`);
      }
      const rows = (
        await tx
          .select()
          .from(restaurants)
          .where(and(...conditions))
      ).filter((r) => orderable(r, now));
      const [open, rated] = await Promise.all([
        openStates(tx, rows, now),
        ratings(
          tx,
          rows.map((r) => r.id),
        ),
      ]);

      const summaries = await Promise.all(
        rows.map(async (r): Promise<RestaurantSummary> => {
          const routeMeters = await this.routing.routeMeters(pointOf(r), here);
          return {
            id: r.id,
            name: r.name,
            cuisines: r.cuisines,
            addressText: r.addressText,
            isOpen: open.get(r.id) ?? false,
            rating: rated.get(r.id)?.rating ?? null,
            ratingCount: rated.get(r.id)?.count ?? 0,
            distanceMeters: routeMeters,
            deliveryFeeCents: deliveryFee(routeMeters, settings.deliveryFee),
            eta: estimateDeliveryRange(r.prepMinutes, routeMeters),
          };
        }),
      );
      return summaries.sort(
        (a, b) => Number(b.isOpen) - Number(a.isOpen) || a.distanceMeters - b.distanceMeters,
      );
    });
  }

  /** Restaurant page (CUS-04): approved menu by category, sold-out items included and flagged. */
  async get(id: string, here?: Point): Promise<RestaurantDetail> {
    const now = this.clock();
    return withScope(this.db, PLATFORM, async (tx) => {
      const [r] = await tx.select().from(restaurants).where(eq(restaurants.id, id));
      if (!r || !orderable(r, now)) throw new ApiError('not_found');
      const settings = await loadSettings(tx);

      const [open, rated, categories, items] = await Promise.all([
        openStates(tx, [r], now),
        ratings(tx, [r.id]),
        tx
          .select()
          .from(menuCategories)
          .where(eq(menuCategories.tenantId, r.id))
          .orderBy(asc(menuCategories.sortOrder)),
        tx
          .select()
          .from(menuItems)
          .where(
            and(
              eq(menuItems.tenantId, r.id),
              eq(menuItems.approvalStatus, 'approved'),
              isNull(menuItems.archivedAt),
            ),
          )
          .orderBy(asc(menuItems.createdAt)),
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

      const toItem = (i: (typeof items)[number]): MenuItem => ({
        id: i.id,
        name: i.name,
        description: i.description,
        priceCents: i.priceCents,
        photoUrl: null, // photo storage comes with menu management (RES-08)
        dietaryTags: i.dietaryTags,
        soldOut: i.soldOut,
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
      });

      let distanceMeters: number | null = null;
      let fee: number | null = null;
      let eta: RestaurantDetail['eta'] = null;
      if (here) {
        const routeMeters = await this.routing.routeMeters(pointOf(r), here);
        distanceMeters = routeMeters;
        fee = deliveryFee(routeMeters, settings.deliveryFee);
        eta = estimateDeliveryRange(r.prepMinutes, routeMeters);
      }

      return {
        id: r.id,
        name: r.name,
        cuisines: r.cuisines,
        addressText: r.addressText,
        isOpen: open.get(r.id) ?? false,
        rating: rated.get(r.id)?.rating ?? null,
        ratingCount: rated.get(r.id)?.count ?? 0,
        distanceMeters,
        deliveryFeeCents: fee,
        eta,
        categories: categories
          .map((c) => ({
            id: c.id,
            name: c.name,
            items: items.filter((i) => i.categoryId === c.id).map(toItem),
          }))
          .filter((c) => c.items.length > 0),
      };
    });
  }
}
