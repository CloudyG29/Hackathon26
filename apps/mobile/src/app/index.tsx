import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Rank } from '@hackathon26/shared';
import { JourneyMap } from '../components/JourneyMap';
import { RankPickerModal } from '../components/RankPickerModal';
import { useCurrentLocation } from '../hooks/useCurrentLocation';
import { planJourney } from '../lib/api';
import { RANKS } from '../lib/fixtures';
import { savePlan } from '../lib/planStore';

/**
 * Journey search: pick the origin and destination ranks over the corridor
 * map, then hand the plan to the route screen. planJourney() degrades to
 * offline fixtures whenever the routing API is unavailable, so this screen
 * works end to end from day one.
 */
export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [origin, setOrigin] = useState<Rank | null>(RANKS[0] ?? null);
  const [destination, setDestination] = useState<Rank | null>(RANKS[RANKS.length - 1] ?? null);
  const [picker, setPicker] = useState<'origin' | 'destination' | null>(null);
  const [planning, setPlanning] = useState(false);
  const location = useCurrentLocation();

  const canPlan = Boolean(origin && destination && origin.id !== destination.id && !planning);

  async function handleFindRoutes() {
    if (!origin || !destination) return;
    setPlanning(true);
    try {
      const { plan, source } = await planJourney({
        origin: { label: origin.name, rankId: origin.id, location: origin.location },
        destination: {
          label: destination.name,
          rankId: destination.id,
          location: destination.location,
        },
      });
      savePlan({ plan, source });
      router.push({ pathname: '/route', params: { planId: plan.planId } });
    } finally {
      setPlanning(false);
    }
  }

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.fields}>
        <Pressable style={styles.field} onPress={() => setPicker('origin')}>
          <Text style={styles.fieldLabel}>From</Text>
          <Text style={styles.fieldValue} numberOfLines={1}>
            {origin?.name ?? 'Choose a departure rank'}
          </Text>
          {origin ? (
            <Text style={styles.fieldArea} numberOfLines={1}>
              {origin.area}
            </Text>
          ) : null}
        </Pressable>
        <Pressable style={styles.field} onPress={() => setPicker('destination')}>
          <Text style={styles.fieldLabel}>To</Text>
          <Text style={styles.fieldValue} numberOfLines={1}>
            {destination?.name ?? 'Choose a destination rank'}
          </Text>
          {destination ? (
            <Text style={styles.fieldArea} numberOfLines={1}>
              {destination.area}
            </Text>
          ) : null}
        </Pressable>
      </View>

      <View style={styles.mapWrap}>
        <JourneyMap
          ranks={RANKS}
          highlightRankIds={[origin?.id, destination?.id].filter((id): id is string =>
            Boolean(id),
          )}
          showsUserLocation={location.status === 'ready'}
        />
        {location.status === 'unavailable' ? (
          <Text style={styles.locationHint}>
            Location is off — enable it to see your position on the map.
          </Text>
        ) : null}
      </View>

      <Pressable
        style={[styles.cta, !canPlan && styles.ctaDisabled]}
        onPress={handleFindRoutes}
        disabled={!canPlan}
      >
        <Text style={styles.ctaText}>{planning ? 'Finding routes…' : 'Find routes'}</Text>
      </Pressable>

      <RankPickerModal
        visible={picker === 'origin'}
        title="Departing from"
        ranks={RANKS}
        selectedRankId={origin?.id}
        onSelect={setOrigin}
        onClose={() => setPicker(null)}
      />
      <RankPickerModal
        visible={picker === 'destination'}
        title="Going to"
        ranks={RANKS}
        selectedRankId={destination?.id}
        onSelect={setDestination}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    gap: 12,
  },
  fields: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  field: {
    borderWidth: 1,
    borderColor: '#d9e3ee',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#f7fafd',
  },
  fieldLabel: {
    fontSize: 12,
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
    marginTop: 2,
  },
  fieldArea: {
    fontSize: 13,
    color: '#555',
    marginTop: 2,
  },
  mapWrap: {
    flex: 1,
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#d9e3ee',
  },
  locationHint: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    fontSize: 12,
    color: '#b45309',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  cta: {
    marginHorizontal: 16,
    backgroundColor: '#0b5cad',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ctaDisabled: {
    backgroundColor: '#9db8d2',
  },
  ctaText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
