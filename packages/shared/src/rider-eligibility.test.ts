import { describe, expect, it } from 'vitest';
import { riderIneligibility, type RiderSnapshot } from './rider-eligibility.js';
import { SETTINGS_SEED_DEFAULTS } from './settings.js';

const caps = SETTINGS_SEED_DEFAULTS.riderCaps;
const ready: RiderSnapshot = {
  online: true,
  paused: false,
  activeJobs: 2,
  cashHeldCents: 1_499_999,
  declinedThisOrder: false,
};

describe('riderIneligibility', () => {
  it('accepts an online rider under both caps', () => {
    expect(riderIneligibility(ready, caps)).toEqual([]);
  });

  it.each([
    [{ online: false }, 'offline'],
    [{ paused: true }, 'paused'],
    [{ activeJobs: 3 }, 'job_cap'],
    [{ cashHeldCents: 1_500_000 }, 'cash_cap'],
    [{ declinedThisOrder: true }, 'declined'],
  ] as const)('%o -> %s', (change, reason) => {
    expect(riderIneligibility({ ...ready, ...change }, caps)).toEqual([reason]);
  });

  it('lists every reason', () => {
    expect(
      riderIneligibility(
        {
          online: false,
          paused: true,
          activeJobs: 5,
          cashHeldCents: 2_000_000,
          declinedThisOrder: true,
        },
        caps,
      ),
    ).toEqual(['offline', 'paused', 'job_cap', 'cash_cap', 'declined']);
  });
});
