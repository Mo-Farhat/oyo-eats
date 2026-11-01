import type { Cents } from './money.js';
import type { RiderCapSettings } from './settings.js';

export interface RiderSnapshot {
  online: boolean;
  paused: boolean;
  activeJobs: number;
  cashHeldCents: Cents;
  declinedThisOrder: boolean;
}

export type IneligibleReason = 'offline' | 'paused' | 'job_cap' | 'cash_cap' | 'declined';

/** Why a rider cannot be offered an order (PRD section 8, rule 2). Empty means eligible. */
export function riderIneligibility(
  rider: RiderSnapshot,
  caps: RiderCapSettings,
): IneligibleReason[] {
  const reasons: IneligibleReason[] = [];
  if (!rider.online) reasons.push('offline');
  if (rider.paused) reasons.push('paused');
  if (rider.activeJobs >= caps.maxActiveJobs) reasons.push('job_cap');
  if (rider.cashHeldCents >= caps.cashCapCents) reasons.push('cash_cap');
  if (rider.declinedThisOrder) reasons.push('declined');
  return reasons;
}
