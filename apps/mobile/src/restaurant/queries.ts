import type { RestaurantOrder } from '@oyo/shared';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { restaurantApi } from '@/api';

export const BOARD = ['restaurant-board'] as const;

/** The kitchen board, refreshed every 5 s (live socket updates replace polling later). */
export function useBoard() {
  return useQuery({ queryKey: BOARD, queryFn: restaurantApi.board, refetchInterval: 5_000 });
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
