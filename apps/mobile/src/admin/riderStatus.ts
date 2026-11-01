import type { AdminRiderSummary } from '@oyo/shared';

export const RIDER_STATUS: Record<
  AdminRiderSummary['status'],
  { label: string; tone: 'info' | 'green' | 'neutral' | 'warn' | 'danger' }
> = {
  on_job: { label: 'On job', tone: 'info' },
  idle: { label: 'Idle', tone: 'green' },
  offline: { label: 'Offline', tone: 'neutral' },
  paused: { label: 'Paused', tone: 'warn' },
  suspended: { label: 'Suspended', tone: 'danger' },
};

/** The chip for a rider: no signal and the cash cap trump the plain status. */
export function riderChip(r: AdminRiderSummary) {
  if (r.noSignal) return { label: 'No signal', tone: 'danger' as const };
  if (r.status !== 'suspended' && r.cashHeldCents >= r.cashCapCents)
    return { label: 'At cash cap', tone: 'warn' as const };
  return RIDER_STATUS[r.status];
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function seenAgo(iso: string | null) {
  if (!iso) return 'never seen';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 120) return `seen ${s}s ago`;
  if (s < 7200) return `seen ${Math.round(s / 60)} min ago`;
  return `seen ${Math.round(s / 3600)} h ago`;
}
