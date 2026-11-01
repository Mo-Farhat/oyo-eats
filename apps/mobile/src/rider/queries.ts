import { useQuery } from '@tanstack/react-query';
import { riderApi } from '@/api';

export const RIDER_STATE = ['rider-state'] as const;

/** The rider's offer and jobs, refreshed every 3 s so a 60 s offer is seen promptly. */
export function useRiderState() {
  return useQuery({ queryKey: RIDER_STATE, queryFn: riderApi.state, refetchInterval: 3_000 });
}
