import type { OrderDetail } from '@oyo/shared';
import { customerApi } from '@/api';
import { useCustomer } from './store';

/**
 * Reorder (CUS-17): rebuilds the cart from a past order against today's menu. Items or options
 * that are gone or sold out are skipped and reported; prices come from the current menu.
 */
export async function reorder(order: OrderDetail): Promise<{ added: number; skipped: string[] }> {
  const menu = await customerApi.restaurant(order.restaurant.id);
  const items = new Map(menu.categories.flatMap((c) => c.items).map((i) => [i.id, i]));
  const cart = useCustomer.getState();
  if (cart.restaurantId !== order.restaurant.id) cart.clear();

  let added = 0;
  const skipped: string[] = [];
  for (const line of order.lines) {
    const item = items.get(line.menuItemId);
    const options = item?.groups.flatMap((g) => g.options) ?? [];
    const modifiers = line.modifiers.map((m) => options.find((o) => o.id === m.id));
    if (!item || item.soldOut || modifiers.some((m) => !m || m.soldOut)) {
      skipped.push(line.name);
      continue;
    }
    useCustomer.getState().add(
      { id: order.restaurant.id, name: order.restaurant.name },
      {
        menuItemId: item.id,
        name: item.name,
        unitPriceCents: item.priceCents,
        modifiers: modifiers.map((m) => ({ id: m!.id, name: m!.name, priceCents: m!.priceCents })),
        quantity: line.quantity,
        note: line.note ?? undefined,
      },
    );
    added += line.quantity;
  }
  return { added, skipped };
}
