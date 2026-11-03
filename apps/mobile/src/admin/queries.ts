import type { Role } from '@oyo/shared';
import { useQuery } from '@tanstack/react-query';
import { adminApi, dispatchApi } from '@/api';

export const DISPATCH_BOARD = ['dispatch-board'] as const;

/** The dispatch board: live updates refresh it at once; polling every 10 s is the fallback. */
export function useDispatchBoard() {
  return useQuery({
    queryKey: DISPATCH_BOARD,
    queryFn: dispatchApi.board,
    refetchInterval: 10_000,
  });
}

export const ADMIN_ACCOUNTS = ['admin-accounts'] as const;
export const ADMIN_RESTAURANTS = ['admin-restaurants'] as const;
export const adminRestaurantKey = (id: string) => ['admin-restaurant', id] as const;

/** Logins the caller may manage; refreshed so new devices waiting for approval show up. */
export function useAccounts(filter: { role?: Role; tenantId?: string } = {}) {
  return useQuery({
    queryKey: [...ADMIN_ACCOUNTS, filter],
    queryFn: () => adminApi.accounts(filter),
    refetchInterval: 15_000,
  });
}

export function useAdminRestaurants(enabled = true) {
  return useQuery({ queryKey: ADMIN_RESTAURANTS, queryFn: adminApi.restaurants, enabled });
}

export function useAdminRestaurant(id: string) {
  return useQuery({ queryKey: adminRestaurantKey(id), queryFn: () => adminApi.restaurant(id) });
}

export const SLIPS = ['slips'] as const;

export const ADMIN_RIDERS = ['admin-riders'] as const;
export const adminRiderKey = (id: string) => ['admin-rider', id] as const;

export const MENU_APPROVALS = ['menu-approvals'] as const;
