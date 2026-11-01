import * as Location from 'expo-location';
import { useEffect, useRef } from 'react';
import { riderApi } from '@/api';

/**
 * Reports position while online: every 5 s on a job, 30 s idle (RID-10). Foreground only; the
 * background foreground-service version needs a development build (Milestone 5).
 */
export function useLocationReporting(online: boolean, onJob: boolean) {
  const busy = useRef(false);
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    const report = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted) return;
        const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        if (!cancelled)
          await riderApi.location({
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            mock: p.mocked ?? false,
          });
      } catch {
        // Try again next tick; a missed ping shows as "signal lost" on the dispatch list.
      } finally {
        busy.current = false;
      }
    };
    void report();
    const t = setInterval(() => void report(), onJob ? 5_000 : 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [online, onJob]);
}
