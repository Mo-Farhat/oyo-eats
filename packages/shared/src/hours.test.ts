import { describe, expect, it } from 'vitest';
import { colomboParts, isOpenAt, type WeeklyHours } from './hours.js';

// 2026-11-02 is a Monday. 08:00 Colombo = 02:30 UTC.
const at = (utc: string) => new Date(utc);
const daily = (opensAt: string, closesAt: string): WeeklyHours[] =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt, closesAt }));

describe('colomboParts', () => {
  it('converts UTC to Colombo wall time, across midnight', () => {
    expect(colomboParts(at('2026-11-02T02:30:00Z'))).toEqual({
      date: '2026-11-02',
      weekday: 1,
      minutes: 480,
    });
    expect(colomboParts(at('2026-11-01T19:00:00Z'))).toEqual({
      date: '2026-11-02',
      weekday: 1,
      minutes: 30,
    });
  });
});

describe('isOpenAt', () => {
  const hours = daily('08:00', '23:00');

  it('opens at the opening minute and closes at the closing minute', () => {
    expect(isOpenAt(at('2026-11-02T02:29:00Z'), hours)).toBe(false); // 07:59
    expect(isOpenAt(at('2026-11-02T02:30:00Z'), hours)).toBe(true); // 08:00
    expect(isOpenAt(at('2026-11-02T17:29:00Z'), hours)).toBe(true); // 22:59
    expect(isOpenAt(at('2026-11-02T17:30:00Z'), hours)).toBe(false); // 23:00
  });

  it('handles hours past midnight from the day before', () => {
    const late: WeeklyHours[] = [{ weekday: 1, opensAt: '18:00', closesAt: '02:00' }];
    expect(isOpenAt(at('2026-11-02T13:30:00Z'), late)).toBe(true); // Mon 19:00
    expect(isOpenAt(at('2026-11-02T19:30:00Z'), late)).toBe(true); // Tue 01:00, from Monday's slot
    expect(isOpenAt(at('2026-11-02T21:30:00Z'), late)).toBe(false); // Tue 03:00
  });

  it('treats equal open and close as open all day', () => {
    expect(isOpenAt(at('2026-11-02T18:29:00Z'), daily('00:00', '00:00'))).toBe(true); // 23:59
    expect(isOpenAt(at('2026-11-01T18:30:00Z'), daily('00:00', '00:00'))).toBe(true); // 00:00
  });

  it('is closed on days without hours', () => {
    expect(
      isOpenAt(at('2026-11-02T06:00:00Z'), [{ weekday: 0, opensAt: '08:00', closesAt: '23:00' }]),
    ).toBe(false);
  });

  it('lets a holiday override win', () => {
    const now = at('2026-11-02T06:00:00Z'); // Mon 11:30
    expect(isOpenAt(now, hours, [{ date: '2026-11-02', closed: true }])).toBe(false);
    expect(
      isOpenAt(now, hours, [
        { date: '2026-11-02', closed: false, opensAt: '12:00', closesAt: '15:00' },
      ]),
    ).toBe(false);
    expect(isOpenAt(now, hours, [{ date: '2026-11-03', closed: true }])).toBe(true);
  });

  it('stays closed while paused', () => {
    const now = at('2026-11-02T06:00:00Z');
    expect(isOpenAt(now, hours, [], new Date(now.getTime() + 60_000))).toBe(false);
    expect(isOpenAt(now, hours, [], new Date(now.getTime() - 60_000))).toBe(true);
  });
});
