import { useEffect, useState } from 'react';

/** Seconds left until `until` (ISO), ticking every second; 0 once passed. */
export function useCountdown(until: string | null | undefined): number {
  const left = () =>
    until ? Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 1000)) : 0;
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    setSeconds(left());
    if (!until) return;
    const t = setInterval(() => setSeconds(left()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return seconds;
}

export const mmss = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
