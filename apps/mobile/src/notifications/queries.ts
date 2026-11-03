import { useQuery } from '@tanstack/react-query';
import { authApi } from '@/api';

export const NOTIFICATIONS = ['notifications'] as const;

/** NOT-06: this person's notifications (last 30 days) and the unread count. */
export function useNotifications() {
  return useQuery({
    queryKey: NOTIFICATIONS,
    queryFn: authApi.notifications,
    refetchInterval: 60_000,
  });
}
