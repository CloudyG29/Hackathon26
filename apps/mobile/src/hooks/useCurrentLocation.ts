import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';
import type { GeoPoint } from '@hackathon26/shared';

export type LocationStatus = 'pending' | 'ready' | 'unavailable';

export interface CurrentLocation {
  coords: GeoPoint | null;
  status: LocationStatus;
  /** Re-requests permission (if needed) and a fresh position fix. */
  refresh: () => Promise<void>;
}

/**
 * One-shot foreground location for the "you are here" pin. Safe to mount on
 * the search screen: the permission prompt appears on first use only, and
 * every failure path resolves to status 'unavailable' instead of throwing.
 *
 * On the Android emulator, location must be enabled in the emulator's
 * Settings > Location before a fix will arrive.
 */
export function useCurrentLocation(): CurrentLocation {
  const [coords, setCoords] = useState<GeoPoint | null>(null);
  const [status, setStatus] = useState<LocationStatus>('pending');

  const refresh = useCallback(async () => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== Location.PermissionStatus.GRANTED) {
        setStatus('unavailable');
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCoords({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      setStatus('ready');
    } catch {
      setStatus('unavailable');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { coords, status, refresh };
}
