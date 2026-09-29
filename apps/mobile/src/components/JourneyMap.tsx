import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import type { Leg, Rank } from '@hackathon26/shared';
import { MODE_COLORS } from '../lib/format';

/** Corridor-level overview: Johannesburg CBD through Mbombela to White River. */
const CORRIDOR_REGION: Region = {
  latitude: -25.95,
  longitude: 29.5,
  latitudeDelta: 1.8,
  longitudeDelta: 3.6,
};

/**
 * Google Maps on Android needs an API key injected into the manifest by the
 * react-native-maps config plugin at build time. Without it the native
 * MapView throws on mount and kills the whole app (not just a blank map), so
 * we render a placeholder instead. Note that adding the key to .env later
 * requires a native rebuild — restarting Metro updates this JS check, but not
 * the manifest meta-data the native SDK reads.
 */
const hasMapsApiKey = Boolean(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY);

const HIGHLIGHT_PIN = '#0b5cad';
const DEFAULT_PIN = '#e8a33d';

interface JourneyMapProps {
  ranks: Rank[];
  /** When provided, each leg is drawn as a polyline and the camera fits the route. */
  legs?: Leg[];
  /** Rank ids to pin in the accent colour (origin/destination, transfer stops). */
  highlightRankIds?: string[];
  /**
   * Enables the native blue user-location dot. Only pass true once location
   * permission is granted — the map cannot request it on its own.
   */
  showsUserLocation?: boolean;
  onRankPress?: (rank: Rank) => void;
}

/**
 * The one map component used by both screens: rank markers always, route
 * polylines when legs are supplied. Google provider everywhere — the API key
 * is injected by the react-native-maps config plugin in app.config.ts.
 */
export function JourneyMap({
  ranks,
  legs,
  highlightRankIds = [],
  showsUserLocation = false,
  onRankPress,
}: JourneyMapProps) {
  const mapRef = useRef<MapView | null>(null);
  const highlighted = new Set(highlightRankIds);

  const fitToRoute = useCallback(() => {
    if (!legs || legs.length === 0) return;
    const coordinates = legs.flatMap((leg) => leg.path ?? []);
    if (coordinates.length === 0) return;
    mapRef.current?.fitToCoordinates(coordinates, {
      edgePadding: { top: 70, right: 50, bottom: 70, left: 50 },
      animated: true,
    });
  }, [legs]);

  // Re-fit when the selected option's legs change after the initial render;
  // onMapReady covers the first layout pass.
  useEffect(() => {
    fitToRoute();
  }, [fitToRoute]);

  if (!hasMapsApiKey) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>Map preview unavailable</Text>
        <Text style={styles.fallbackBody}>
          Set EXPO_PUBLIC_GOOGLE_MAPS_API_KEY in apps/mobile/.env and rebuild the dev client to
          enable the corridor map. Routes, fares and landmarks all work without it.
        </Text>
      </View>
    );
  }

  return (
    <MapView
      ref={mapRef}
      style={styles.map}
      provider={PROVIDER_GOOGLE}
      initialRegion={CORRIDOR_REGION}
      showsUserLocation={showsUserLocation}
      onMapReady={fitToRoute}
    >
      {ranks.map((rank) => (
        <Marker
          key={rank.id}
          coordinate={rank.location}
          title={rank.name}
          description={rank.area}
          pinColor={highlighted.has(rank.id) ? HIGHLIGHT_PIN : DEFAULT_PIN}
          onPress={() => onRankPress?.(rank)}
        />
      ))}
      {(legs ?? []).map((leg) => (
        <Polyline
          key={leg.id}
          coordinates={leg.path ?? []}
          strokeColor={MODE_COLORS[leg.mode]}
          strokeWidth={5}
          lineDashPattern={leg.mode === 'walk' ? [10, 8] : undefined}
        />
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
    backgroundColor: '#f4f6f9',
  },
  fallbackTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  fallbackBody: {
    fontSize: 13,
    color: '#555',
    textAlign: 'center',
  },
});
