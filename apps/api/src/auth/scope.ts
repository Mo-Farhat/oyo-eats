import type { Scope } from '../db/client.js';
import type { AuthContext } from './auth.service.js';

/** The RLS scope for a caller: restaurant users see only their restaurant; everyone else is platform. */
export function scopeFor(auth: AuthContext): Scope {
  if (auth.role === 'restaurant_staff' || auth.role === 'restaurant_owner') {
    if (!auth.tenantId) throw new Error(`Restaurant account ${auth.accountId} has no tenant`);
    return { kind: 'tenant', tenantId: auth.tenantId };
  }
  return { kind: 'platform' };
}
