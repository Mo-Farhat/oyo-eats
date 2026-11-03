import type {
  BankDetails,
  DeliveryFeeSettings,
  RiderCapSettings,
  RiderPaySettings,
  TimerSettings,
} from '@oyo/shared';
import type { Tx } from '../db/client.js';
import { settings } from '../db/schema.js';

/** Business settings (ADM-18). The optional ones wait on the business (docs/NEEDS-YOU.md). */
export interface BusinessSettings {
  deliveryFee: DeliveryFeeSettings;
  riderCaps: RiderCapSettings;
  riderPay: RiderPaySettings;
  timers: TimerSettings;
  /** Orders above this total can't use cash on delivery (CUS-08). Unset: no limit. */
  codLimitCents?: number;
  /** Unset: no minimum. */
  minimumOrderCents?: number;
  /** Where customers send bank transfers. Unset: bank transfer isn't offered. */
  bankDetails?: BankDetails;
  /** Refunds above this need the owner (ADM-16). Unset: every refund needs the owner. */
  dispatcherRefundCapCents?: number;
}

/** Reads all settings in one query. Needs a platform-scope transaction. */
export async function loadSettings(tx: Tx): Promise<BusinessSettings> {
  const rows = await tx.select().from(settings);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const required = <T>(key: string) => {
    if (!map.has(key))
      throw new Error(`Setting "${key}" is missing; run npm run db:seed -w @oyo/api`);
    return map.get(key) as T;
  };
  const optionalCents = (key: string) => {
    const v = map.get(key);
    return typeof v === 'number' && Number.isSafeInteger(v) ? v : undefined;
  };
  return {
    deliveryFee: required<DeliveryFeeSettings>('deliveryFee'),
    riderCaps: required<RiderCapSettings>('riderCaps'),
    riderPay: required<RiderPaySettings>('riderPay'),
    timers: required<TimerSettings>('timers'),
    codLimitCents: optionalCents('codLimitCents'),
    minimumOrderCents: optionalCents('minimumOrderCents'),
    dispatcherRefundCapCents: optionalCents('dispatcherRefundCapCents'),
    bankDetails: isBankDetails(map.get('bankDetails'))
      ? (map.get('bankDetails') as BankDetails)
      : undefined,
  };
}

function isBankDetails(v: unknown): v is BankDetails {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return ['bankName', 'branch', 'accountName', 'accountNumber'].every(
    (k) => typeof o[k] === 'string' && o[k] !== '',
  );
}
