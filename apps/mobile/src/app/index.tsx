import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import type { PlanLeg, PlanResult, RankSuggestion, RoutePriority } from '../lib/api';
import { planJourney, searchRanks } from '../lib/api';

/**
 * Journey search + map screen.
 *
 * From/To autocomplete calls GET /ranks?q= (our rank names only — no Google
 * Places/geocoding). Search calls POST /routes/plan and renders the returned
 * legs: one <Polyline> per leg from its own path coordinates, a fare bubble
 * marker at each leg's path midpoint, and a rank marker at each stop. The
 * leg-by-leg breakdown with running total sits below the map.
 */

/** Distinct colors per leg so taxi changes are visually obvious. */
const LEG_COLORS = ['#0b5cad', '#c2571a', '#2e7d32', '#7b1fa2'];

const PRIORITY_OPTIONS: RoutePriority[] = ['cheapest', 'fastest', 'easiest', 'safest'];

const INITIAL_REGION: Region = {
  // Tshwane, roughly.
  latitude: -25.6,
  longitude: 28.24,
  latitudeDelta: 1.2,
  longitudeDelta: 1.2,
};

interface EndpointState {
  text: string;
  rank?: RankSuggestion;
}

function formatZar(amount: number): string {
  return `R${amount.toFixed(2).replace(/\.00$/, '')}`;
}

export default function HomeScreen() {
  const [from, setFrom] = useState<EndpointState>({ text: '' });
  const [to, setTo] = useState<EndpointState>({ text: '' });
  const [priority, setPriority] = useState<RoutePriority>('cheapest');
  const [activeField, setActiveField] = useState<'from' | 'to' | null>(null);
  const [suggestions, setSuggestions] = useState<RankSuggestion[]>([]);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mapRef = useRef<MapView>(null);

  const searchIdRef = useRef(0);

  // Autocomplete against OUR ranks, debounced.
  useEffect(() => {
    if (!activeField) return;
    const query = activeField === 'from' ? from.text : to.text;
    const id = ++searchIdRef.current;
    const timer = setTimeout(() => {
      searchRanks(query)
        .then((results) => {
          if (searchIdRef.current === id) setSuggestions(results);
        })
        .catch(() => {
          if (searchIdRef.current === id) setSuggestions([]);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [activeField, from.text, to.text]);

  const pickSuggestion = useCallback(
    (field: 'from' | 'to', rank: RankSuggestion) => {
      const next = { text: rank.name, rank };
      if (field === 'from') setFrom(next);
      else setTo(next);
      setActiveField(null);
      setSuggestions([]);
    },
    [],
  );

  const canSearch = Boolean(from.rank && to.rank) && !searching;

  const onSearch = useCallback(async () => {
    if (!from.rank || !to.rank) return;
    setSearching(true);
    setError(null);
    setPlan(null);
    try {
      const result = await planJourney(from.rank.rankId, to.rank.rankId, priority);
      setPlan(result); // null = no route found (404 empty result)
      if (result && result.legs.length > 0 && mapRef.current) {
        const points = result.legs.flatMap((leg) =>
          leg.path.map((p) => ({ latitude: p.lat, longitude: p.lng })),
        );
        if (points.length >= 2) {
          // Let the map frame the whole journey on the next render.
          setTimeout(
            () => mapRef.current?.fitToCoordinates(points, { edgePadding: { top: 60, bottom: 60, left: 40, right: 40 } }),
            100,
          );
        }
      }
    } catch {
      setError('Could not reach the transit API. Is services/api running?');
    } finally {
      setSearching(false);
    }
  }, [from.rank, to.rank, priority]);

  // Stops along the plan: origin, every transfer, destination — each with
  // coordinates taken from leg path endpoints (no geocoding involved).
  const stops = useMemo(() => {
    if (!plan || plan.legs.length === 0) return [];
    const result: Array<{ key: string; name: string; lat: number; lng: number; kind: 'start' | 'transfer' | 'end' }> = [];
    plan.legs.forEach((leg: PlanLeg, index: number) => {
      const start = leg.path[0];
      const end = leg.path[leg.path.length - 1];
      if (start) {
        result.push({
          key: `from-${leg.fromRankId}-${index}`,
          name: leg.fromName,
          lat: start.lat,
          lng: start.lng,
          kind: index === 0 ? 'start' : 'transfer',
        });
      }
      if (end && index === plan.legs.length - 1) {
        result.push({
          key: `to-${leg.toRankId}`,
          name: leg.toName,
          lat: end.lat,
          lng: end.lng,
          kind: 'end',
        });
      }
    });
    return result;
  }, [plan]);

  const suggestionsFor = (field: 'from' | 'to'): RankSuggestion[] =>
    activeField === field ? suggestions : [];

  return (
    <View style={styles.container}>
      <View style={styles.searchPanel}>
        <EndpointInput
          label="From"
          state={from}
          suggestions={suggestionsFor('from')}
          onFocus={() => setActiveField('from')}
          onChangeText={(text) => setFrom({ text })}
          onPick={(rank) => pickSuggestion('from', rank)}
        />
        <EndpointInput
          label="To"
          state={to}
          suggestions={suggestionsFor('to')}
          onFocus={() => setActiveField('to')}
          onChangeText={(text) => setTo({ text })}
          onPick={(rank) => pickSuggestion('to', rank)}
        />
        <View style={styles.priorityRow}>
          {PRIORITY_OPTIONS.map((option) => (
            <Pressable
              key={option}
              style={[styles.priorityChip, priority === option && styles.priorityChipActive]}
              onPress={() => setPriority(option)}
            >
              <Text style={[styles.priorityText, priority === option && styles.priorityTextActive]}>
                {option}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={[styles.searchButton, !canSearch && styles.searchButtonDisabled]} onPress={onSearch} disabled={!canSearch}>
          {searching ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.searchButtonText}>Find taxis</Text>
          )}
        </Pressable>
      </View>

      <MapView ref={mapRef} style={styles.map} initialRegion={INITIAL_REGION}>
        {plan?.legs.map((leg, index) => {
          const coordinates = leg.path.map((p) => ({ latitude: p.lat, longitude: p.lng }));
          const color = LEG_COLORS[index % LEG_COLORS.length]!;
          const midpoint = leg.path[Math.floor(leg.path.length / 2)];
          return (
            <View key={`leg-${index}`}>
              <Polyline coordinates={coordinates} strokeColor={color} strokeWidth={4} />
              {midpoint && (
                <Marker coordinate={{ latitude: midpoint.lat, longitude: midpoint.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                  <View style={[styles.fareBubble, { backgroundColor: color }]}>
                    <Text style={styles.fareBubbleText}>{formatZar(leg.fareZar)}</Text>
                  </View>
                </Marker>
              )}
            </View>
          );
        })}
        {stops.map((stop) => (
          <Marker
            key={stop.key}
            coordinate={{ latitude: stop.lat, longitude: stop.lng }}
            title={stop.name}
            description={stop.kind === 'transfer' ? 'Change taxis here' : undefined}
            pinColor={stop.kind === 'start' ? '#2e7d32' : stop.kind === 'end' ? '#c62828' : '#f9a825'}
          />
        ))}
      </MapView>

      <ScrollView style={styles.breakdown} contentContainerStyle={styles.breakdownContent}>
        {error && <Text style={styles.errorText}>{error}</Text>}

        {!error && plan === null && !searching && (from.rank || to.rank) && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No route found</Text>
            <Text style={styles.emptyBody}>
              We could not find a taxi route between these ranks. Try a different
              combination, or pick a nearby rank.
            </Text>
          </View>
        )}

        {!error && !plan && !searching && !from.rank && !to.rank && (
          <Text style={styles.hint}>Pick a From and To rank, then tap Find taxis.</Text>
        )}

        {plan && plan.legs.length > 0 && (
          <>
            {plan.legs.map((leg, index) => {
              let running = 0;
              for (let i = 0; i <= index; i++) running += plan.legs[i]!.fareZar;
              return (
                <View key={`row-${index}`} style={styles.legRow}>
                  <View style={[styles.legDot, { backgroundColor: LEG_COLORS[index % LEG_COLORS.length] }]} />
                  <View style={styles.legText}>
                    <Text style={styles.legNames} numberOfLines={2}>
                      {leg.fromName} → {leg.toName}
                    </Text>
                    {index < plan.legs.length - 1 && (
                      <Text style={styles.transferNote}>Change taxis at {leg.toName}</Text>
                    )}
                  </View>
                  <View style={styles.legFares}>
                    <Text style={styles.legFare}>{formatZar(leg.fareZar)}</Text>
                    <Text style={styles.runningTotal}>{formatZar(running)} total</Text>
                  </View>
                </View>
              );
            })}
            <View style={styles.summary}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Total fare</Text>
                <Text style={styles.summaryValue}>{formatZar(plan.totalFareZar)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Number of taxis</Text>
                <Text style={styles.summaryValue}>{plan.legCount}</Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

interface EndpointInputProps {
  label: string;
  state: EndpointState;
  suggestions: RankSuggestion[];
  onFocus: () => void;
  onChangeText: (text: string) => void;
  onPick: (rank: RankSuggestion) => void;
}

function EndpointInput({ label, state, suggestions, onFocus, onChangeText, onPick }: EndpointInputProps) {
  return (
    <View style={styles.endpointBlock}>
      <Text style={styles.endpointLabel}>{label}</Text>
      <TextInput
        style={styles.endpointInput}
        placeholder={label === 'From' ? 'Starting rank' : 'Destination rank'}
        value={state.text}
        onFocus={onFocus}
        onChangeText={onChangeText}
      />
      {suggestions.length > 0 && (
        <View style={styles.suggestionList}>
          {suggestions.map((rank) => (
            <Pressable key={rank.rankId} style={styles.suggestionRow} onPress={() => onPick(rank)}>
              <Text style={styles.suggestionName}>{rank.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  searchPanel: {
    padding: 12,
    gap: 8,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  endpointBlock: { position: 'relative', zIndex: 2 },
  endpointLabel: { fontSize: 12, color: '#666', marginBottom: 2 },
  endpointInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    backgroundColor: '#fafafa',
  },
  suggestionList: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
    zIndex: 3,
    elevation: 4,
  },
  suggestionRow: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee' },
  suggestionName: { fontSize: 14 },
  priorityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  priorityChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#e8f1fb',
  },
  priorityChipActive: { backgroundColor: '#0b5cad' },
  priorityText: { fontSize: 12, color: '#0b5cad', textTransform: 'capitalize' },
  priorityTextActive: { color: '#fff' },
  searchButton: {
    backgroundColor: '#0b5cad',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  searchButtonDisabled: { opacity: 0.5 },
  searchButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  map: { flex: 1 },
  fareBubble: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  fareBubbleText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  breakdown: { maxHeight: 260, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ddd' },
  breakdownContent: { padding: 12, gap: 10 },
  hint: { color: '#666', textAlign: 'center', paddingVertical: 8 },
  errorText: { color: '#c62828', textAlign: 'center' },
  emptyState: { alignItems: 'center', gap: 6, paddingVertical: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptyBody: { color: '#666', textAlign: 'center', fontSize: 13 },
  legRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  legDot: { width: 10, height: 10, borderRadius: 5 },
  legText: { flex: 1 },
  legNames: { fontSize: 14, fontWeight: '500' },
  transferNote: { fontSize: 12, color: '#b26a00', marginTop: 2 },
  legFares: { alignItems: 'flex-end' },
  legFare: { fontSize: 14, fontWeight: '600' },
  runningTotal: { fontSize: 11, color: '#888' },
  summary: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ddd',
    paddingTop: 8,
    gap: 4,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { fontSize: 15, color: '#444' },
  summaryValue: { fontSize: 15, fontWeight: '700' },
});
