import type { RestaurantOrder } from '@oyo/shared';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { restaurantApi } from '@/api';

export const BOARD = ['restaurant-board'] as const;

/** The kitchen board: live updates refresh it at once; polling every 10 s is the fallback. */
export function useBoard() {
  return useQuery({ queryKey: BOARD, queryFn: restaurantApi.board, refetchInterval: 10_000 });
}

export function useBoardOrder(id: string): RestaurantOrder | undefined {
  const board = useBoard();
  const b = board.data;
  return b ? [...b.new, ...b.preparing, ...b.ready, ...b.done].find((o) => o.id === id) : undefined;
}

/** New orders already opened on this device; the alarm rings for any others (RES-02). */
export const useSeenOrders = create<{ seen: Set<string>; markSeen(id: string): void }>(
  (set, get) => ({
    seen: new Set(),
    markSeen: (id) => set({ seen: new Set([...get().seen, id]) }),
  }),
);

export const MENU = ['restaurant-menu'] as const;
export const MENU_REQUESTS = ['restaurant-menu-requests'] as const;
export const HOURS = ['restaurant-hours'] as const;

/** The restaurant's own menu, live and waiting items (T07). */
export function useMenu() {
  return useQuery({ queryKey: MENU, queryFn: restaurantApi.menu, refetchInterval: 30_000 });
}
