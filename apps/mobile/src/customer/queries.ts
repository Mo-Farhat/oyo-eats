import { TERMINAL_STATUSES, type QuoteOrderInput } from '@oyo/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { customerApi } from '@/api';
import { useCustomer } from './store';

export const keys = {
  addresses: ['addresses'] as const,
  restaurants: (lat: number, lng: number, q?: string, cuisine?: string) =>
    ['restaurants', lat, lng, q, cuisine] as const,
  restaurant: (id: string) => ['restaurant', id] as const,
  orders: ['orders'] as const,
  order: (id: string) => ['order', id] as const,
};

export function useAddresses() {
  return useQuery({ queryKey: keys.addresses, queryFn: customerApi.addresses });
}

/** The address the customer is ordering to, falling back to their first saved one. */
export function useDeliveryAddress() {
  const addresses = useAddresses();
  const selected = useCustomer((s) => s.addressId);
  const address = addresses.data?.find((a) => a.id === selected) ?? addresses.data?.[0] ?? null;
  return { ...addresses, address };
}

export function useRestaurants(q?: string, cuisine?: string) {
  const { address } = useDeliveryAddress();
  return useQuery({
    queryKey: keys.restaurants(address?.lat ?? 0, address?.lng ?? 0, q, cuisine),
    queryFn: () => customerApi.restaurants({ lat: address!.lat, lng: address!.lng, q, cuisine }),
    enabled: !!address,
    placeholderData: keepPreviousData,
  });
}

export function useRestaurant(id: string) {
  const { address } = useDeliveryAddress();
  return useQuery({
    queryKey: [...keys.restaurant(id), address?.id],
    queryFn: () =>
      customerApi.restaurant(id, address ? { lat: address.lat, lng: address.lng } : undefined),
  });
}

/** Server-side price for the current cart (fee and totals always come from here). */
export function useQuote() {
  const { address } = useDeliveryAddress();
  const restaurantId = useCustomer((s) => s.restaurantId);
  const lines = useCustomer((s) => s.lines);
  const draft: QuoteOrderInput | null =
    restaurantId && address && lines.length
      ? {
          restaurantId,
          addressId: address.id,
          items: lines.map((l) => ({
            menuItemId: l.menuItemId,
            quantity: l.quantity,
            modifierIds: l.modifiers.map((m) => m.id),
            ...(l.note ? { note: l.note } : {}),
          })),
        }
      : null;
  return {
    draft,
    ...useQuery({
      queryKey: ['quote', draft],
      queryFn: () => customerApi.quote(draft!),
      enabled: !!draft,
      retry: false,
      placeholderData: keepPreviousData,
    }),
  };
}

export function useOrders() {
  return useQuery({ queryKey: keys.orders, queryFn: customerApi.orders, refetchInterval: 30_000 });
}

/** Polls while the order is open. Live updates over a socket come with tracking (CUS-13). */
export function useOrder(id: string) {
  return useQuery({
    queryKey: keys.order(id),
    queryFn: () => customerApi.order(id),
    refetchInterval: (q) =>
      q.state.data && TERMINAL_STATUSES.includes(q.state.data.status) ? false : 10_000,
  });
}
