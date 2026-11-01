/*
 * Opening hours in Asia/Colombo. Sri Lanka has no daylight saving: local time is always UTC+5:30,
 * so conversion is a fixed offset (NFR-11, NFR-15).
 */

const COLOMBO_OFFSET_MINUTES = 330;

export interface WeeklyHours {
  /** 0 = Sunday. */
  weekday: number;
  /** "HH:MM" or "HH:MM:SS", local time. */
  opensAt: string;
  closesAt: string;
}

export interface HoursOverride {
  /** "YYYY-MM-DD", local date. */
  date: string;
  closed: boolean;
  opensAt?: string | null;
  closesAt?: string | null;
}

/** Local wall-clock parts in Asia/Colombo. */
export function colomboParts(now: Date): { date: string; weekday: number; minutes: number } {
  const local = new Date(now.getTime() + COLOMBO_OFFSET_MINUTES * 60_000);
  return {
    date: local.toISOString().slice(0, 10),
    weekday: local.getUTCDay(),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h! * 60 + m!;
}

/** Inside [opens, closes). A close earlier than the open runs past midnight; equal means all day. */
function within(minutes: number, opensAt: string, closesAt: string): boolean {
  const open = toMinutes(opensAt);
  const close = toMinutes(closesAt);
  if (open === close) return true;
  return open < close ? minutes >= open && minutes < close : minutes >= open || minutes < close;
}

/**
 * Whether a restaurant takes orders at `now`: a holiday override for the day wins over the
 * weekly schedule; a pause (RES-10) closes it until `pausedUntil`.
 */
export function isOpenAt(
  now: Date,
  weekly: readonly WeeklyHours[],
  overrides: readonly HoursOverride[] = [],
  pausedUntil: Date | null = null,
): boolean {
  if (pausedUntil && pausedUntil > now) return false;
  const { date, weekday, minutes } = colomboParts(now);
  const override = overrides.find((o) => o.date === date);
  if (override) {
    if (override.closed || !override.opensAt || !override.closesAt) return false;
    return within(minutes, override.opensAt, override.closesAt);
  }
  // Yesterday's late slots that run past midnight still count.
  const yesterday = (weekday + 6) % 7;
  return weekly.some((h) => {
    if (h.weekday === weekday) return within(minutes, h.opensAt, h.closesAt);
    if (h.weekday === yesterday && toMinutes(h.closesAt) < toMinutes(h.opensAt)) {
      return minutes < toMinutes(h.closesAt);
    }
    return false;
  });
}
