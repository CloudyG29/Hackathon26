import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import { Link, router } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PlanLeg, PlanPriority, PlanResult, RankSuggestion } from '@hackathon26/shared';
import { planJourney, searchRanks } from '../lib/api';
import { polylineMidpoint } from '../lib/geo';
import { savePlan } from '../lib/planStore';
import { hasMapsApiKey, MapFallback } from '../components/JourneyMap';
import { LEG_COLORS, PIN_COLORS, cardShadow, chipShadow, colors, radii } from '../lib/theme';

/**
 * Journey search + map screen.
 *
 * From/To autocomplete calls GET /ranks?q= — our ranks, matched by rank name
 * or town/city (no Google Places/geocoding). Search calls POST /routes/plan
 * and renders the returned legs on the map.
 *
 * Layout: MapView fills the entire screen. All UI panels are absolutely
 * positioned floating layers over the map — search panel at the top,
 * results sheet at the bottom. This ensures the map never gets squashed
 * and results always scroll freely.
 */

const PRIORITY_OPTIONS: Array<{ value: PlanPriority; label: string; icon: string }> = [
  { value: 'cheapest', label: 'Cheapest', icon: '💸' },
  { value: 'fastest', label: 'Fastest', icon: '⚡' },
  { value: 'easiest', label: 'Fewest taxis', icon: '🚕' },
];

const INITIAL_REGION: Region = {
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
  const [priority, setPriority] = useState<PlanPriority>('cheapest');
  const [activeField, setActiveField] = useState<'from' | 'to' | null>(null);
  const [suggestions, setSuggestions] = useState<RankSuggestion[]>([]);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const mapRef = useRef<MapView>(null);
  const insets = useSafeAreaInsets();
  const searchIdRef = useRef(0);

  // Debounced autocomplete
  useEffect(() => {
    if (!activeField) return;
    const query = activeField === 'from' ? from.text : to.text;
    const id = ++searchIdRef.current;
    const timer = setTimeout(() => {
      searchRanks(query)
        .then((results) => { if (searchIdRef.current === id) setSuggestions(results); })
        .catch(() => { if (searchIdRef.current === id) setSuggestions([]); });
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
      Keyboard.dismiss();
    },
    [],
  );

  const canSearch = Boolean(from.rank && to.rank) && !searching;

  const onSearch = useCallback(async () => {
    if (!from.rank || !to.rank) return;
    Keyboard.dismiss();
    setSearching(true);
    setError(null);
    setPlan(null);
    setSearchAttempted(true);
    try {
      const { plan: result, source } = await planJourney(from.rank.rankId, to.rank.rankId, priority);
      setPlan(result);
      if (result) {
        savePlan({ plan: result, fromLabel: from.rank.name, toLabel: to.rank.name, source });
      }
      if (result && result.legs.length > 0 && mapRef.current) {
        const points = result.legs.flatMap((leg) =>
          leg.path.map((p) => ({ latitude: p.lat, longitude: p.lng })),
        );
        if (points.length >= 2) {
          // Leave generous bottom padding so the route isn't hidden under the results sheet
          setTimeout(
            () => mapRef.current?.fitToCoordinates(points, {
              edgePadding: { top: 80, bottom: 360, left: 40, right: 40 },
            }),
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

  const stops = useMemo(() => {
    if (!plan || plan.legs.length === 0) return [];
    const result: Array<{
      key: string; name: string; lat: number; lng: number; kind: 'start' | 'transfer' | 'end';
    }> = [];
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

  const hasPlan = Boolean(plan && plan.legs.length > 0);
  const showSheet = hasPlan || searchAttempted || error;

  // The search panel floats at the top; its bottom edge is the visual top of the map.
  // The results sheet floats at the bottom over the map.
  const topPanelTop = insets.top + 8;
  const bottomSheetBottom = insets.bottom + 12;

  return (
    <View style={styles.root}>
      {/* ── Full-screen map (sits behind everything) ─────────────────── */}
      {hasMapsApiKey ? (
        <MapView ref={mapRef} style={StyleSheet.absoluteFill} initialRegion={INITIAL_REGION}>
          {plan?.legs.map((leg, index) => {
            const coordinates = leg.path.map((p) => ({ latitude: p.lat, longitude: p.lng }));
            const color = LEG_COLORS[index % LEG_COLORS.length]!;
            const midpoint = polylineMidpoint(leg.path);
            return (
              <View key={`leg-${index}`}>
                <Polyline
                  coordinates={coordinates}
                  strokeColor={color}
                  strokeWidth={5}
                  lineCap="round"
                />
                {midpoint && (
                  <Marker
                    coordinate={{ latitude: midpoint.lat, longitude: midpoint.lng }}
                    anchor={{ x: 0.5, y: 0.5 }}
                  >
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
              pinColor={
                stop.kind === 'start'
                  ? PIN_COLORS.start
                  : stop.kind === 'end'
                    ? PIN_COLORS.end
                    : PIN_COLORS.transfer
              }
            />
          ))}
        </MapView>
      ) : (
        <MapFallback />
      )}

      {/* ── Floating top panel ────────────────────────────────────────── */}
      <View style={[styles.topPanel, { top: topPanelTop }]} pointerEvents="box-none">
        {/* From / To card */}
        <View style={[styles.fieldsCard, cardShadow]}>
          <View style={styles.connectorLine} />

          <EndpointInput
            kind="from"
            state={from}
            suggestions={suggestionsFor('from')}
            focused={activeField === 'from'}
            onFocus={() => setActiveField('from')}
            onChangeText={(text) => setFrom({ text })}
            onPick={(rank) => pickSuggestion('from', rank)}
          />

          <View style={styles.fieldDivider} />

          <EndpointInput
            kind="to"
            state={to}
            suggestions={suggestionsFor('to')}
            focused={activeField === 'to'}
            onFocus={() => setActiveField('to')}
            onChangeText={(text) => setTo({ text })}
            onPick={(rank) => pickSuggestion('to', rank)}
          />
        </View>

        {/* Priority chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.priorityRow}
          keyboardShouldPersistTaps="handled"
        >
          {PRIORITY_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              style={({ pressed }) => [
                styles.priorityChip,
                priority === option.value && styles.priorityChipActive,
                pressed && priority !== option.value && styles.priorityChipPressed,
              ]}
              onPress={() => setPriority(option.value)}
            >
              <Text style={styles.priorityIcon}>{option.icon}</Text>
              <Text style={[styles.priorityText, priority === option.value && styles.priorityTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Search button */}
        <Pressable
          style={({ pressed }) => [
            styles.searchButton,
            !canSearch && styles.searchButtonDisabled,
            pressed && canSearch && styles.searchButtonPressed,
          ]}
          onPress={onSearch}
          disabled={!canSearch}
          accessibilityRole="button"
          accessibilityLabel="Find taxis"
        >
          {searching ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.searchButtonText}>Find taxis</Text>
          )}
        </Pressable>
      </View>

      {/* ── Floating bottom sheet ─────────────────────────────────────── */}
      {showSheet && (
        <View style={[styles.bottomSheet, { bottom: bottomSheetBottom }]}>
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces
          >
            {/* Drag handle */}
            <View style={styles.sheetHandle} />

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorIcon}>⚠️</Text>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {!error && !hasPlan && searchAttempted && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyEmoji}>🔍</Text>
                <Text style={styles.emptyTitle}>No route found</Text>
                <Text style={styles.emptyBody}>
                  We couldn't find a taxi route between these ranks. Try a different combination.
                </Text>
              </View>
            )}

            {hasPlan && plan && (
              <>
                {/* Summary pills */}
                <View style={styles.summaryPills}>
                  <View style={styles.summaryPill}>
                    <Text style={styles.summaryPillValue}>{formatZar(plan.totalFareZar)}</Text>
                    <Text style={styles.summaryPillLabel}>Total</Text>
                  </View>
                  <View style={styles.summaryPillDivider} />
                  <View style={styles.summaryPill}>
                    <Text style={styles.summaryPillValue}>{plan.legCount}</Text>
                    <Text style={styles.summaryPillLabel}>Taxis</Text>
                  </View>
                  <View style={styles.summaryPillDivider} />
                  <View style={styles.summaryPill}>
                    <Text style={styles.summaryPillValue}>{plan.legs.length}</Text>
                    <Text style={styles.summaryPillLabel}>Legs</Text>
                  </View>
                </View>

                {/* Leg rows */}
                {plan.legs.map((leg, index) => {
                  let running = 0;
                  for (let i = 0; i <= index; i++) running += plan.legs[i]!.fareZar;
                  const color = LEG_COLORS[index % LEG_COLORS.length]!;
                  return (
                    <View key={`row-${index}`} style={styles.legRow}>
                      <View style={[styles.legStrip, { backgroundColor: color }]} />
                      <View style={styles.legBody}>
                        <View style={styles.legBadgeRow}>
                          <View style={[styles.legStepBadge, { backgroundColor: color + '22' }]}>
                            <Text style={[styles.legStepText, { color }]}>#{index + 1}</Text>
                          </View>
                          {index < plan.legs.length - 1 && (
                            <View style={styles.transferBadge}>
                              <Text style={styles.transferBadgeText}>Transfer</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.legNames} numberOfLines={2}>
                          {leg.fromName} → {leg.toName}
                        </Text>
                        {index < plan.legs.length - 1 && (
                          <Text style={styles.transferNote}>🔄 Change at {leg.toName}</Text>
                        )}
                      </View>
                      <View style={styles.legFares}>
                        <Text style={styles.legFare}>{formatZar(leg.fareZar)}</Text>
                        <Text style={styles.runningTotal}>{formatZar(running)} total</Text>
                      </View>
                    </View>
                  );
                })}

                {/* CTA */}
                <Link href="/route" asChild>
                  <Pressable
                    style={({ pressed }) => [styles.breakdownLink, pressed && styles.breakdownLinkPressed]}
                    onPress={() => router.push('/route')}
                  >
                    <Text style={styles.breakdownLinkText}>Full journey breakdown →</Text>
                  </Pressable>
                </Link>
              </>
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

/* ─── EndpointInput ─────────────────────────────────────────────────────── */

interface EndpointInputProps {
  kind: 'from' | 'to';
  state: EndpointState;
  suggestions: RankSuggestion[];
  focused: boolean;
  onFocus: () => void;
  onChangeText: (text: string) => void;
  onPick: (rank: RankSuggestion) => void;
}

function EndpointInput({ kind, state, suggestions, focused, onFocus, onChangeText, onPick }: EndpointInputProps) {
  const inputRef = useRef<TextInput>(null);

  const clear = () => {
    onChangeText('');
    inputRef.current?.focus();
  };

  return (
    <View>
      <View style={[styles.fieldRow, focused && styles.fieldRowFocused]}>
        <View style={kind === 'from' ? styles.fieldMarkerFrom : styles.fieldMarkerTo} />
        <View style={styles.fieldContent}>
          <Text style={styles.fieldLabel}>{kind === 'from' ? 'FROM' : 'TO'}</Text>
          <TextInput
            ref={inputRef}
            style={styles.fieldInput}
            placeholder={kind === 'from' ? 'Where are you leaving from?' : 'Where are you going?'}
            placeholderTextColor={colors.textFaint}
            value={state.text}
            onFocus={onFocus}
            onChangeText={onChangeText}
            accessibilityLabel={kind === 'from' ? 'Origin rank' : 'Destination rank'}
          />
        </View>
        {state.text.length > 0 && (
          <Pressable
            style={styles.clearButton}
            onPress={clear}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={kind === 'from' ? 'Clear origin' : 'Clear destination'}
          >
            <Text style={styles.clearIcon}>×</Text>
          </Pressable>
        )}
      </View>

      {suggestions.length > 0 && (
        <ScrollView
          style={styles.suggestionList}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          {suggestions.map((rank, index) => (
            <Pressable
              key={rank.rankId}
              style={({ pressed }) => [
                styles.suggestionRow,
                index < suggestions.length - 1 && styles.suggestionRowDivider,
                pressed && styles.suggestionRowPressed,
              ]}
              onPress={() => onPick(rank)}
            >
              <View style={styles.suggestionIcon}>
                <Text style={styles.suggestionIconText}>📍</Text>
              </View>
              <View style={styles.suggestionText}>
                <Text style={styles.suggestionName} numberOfLines={1}>
                  {rank.name}
                </Text>
                {rank.area ? (
                  <Text style={styles.suggestionArea} numberOfLines={1}>
                    {rank.area}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/* ─── Styles ────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  /** Root fills the whole screen; map is behind everything via absoluteFill. */
  root: { flex: 1, backgroundColor: colors.bg },

  /* Fare bubbles on map --------------------------------------------------- */
  fareBubble: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  fareBubbleText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  /* Top floating panel ---------------------------------------------------- */
  topPanel: {
    position: 'absolute',
    left: 16,
    right: 16,
    gap: 10,
    // Let touches pass through to the map in the transparent gaps
    pointerEvents: 'box-none',
  },

  /* From / To card -------------------------------------------------------- */
  fieldsCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    paddingHorizontal: 16,
    paddingVertical: 4,
    position: 'relative',
  },
  connectorLine: {
    position: 'absolute',
    left: 27,
    top: '25%',
    bottom: '25%',
    width: 2,
    backgroundColor: colors.border,
    zIndex: 0,
  },
  fieldDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: 34,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  fieldRowFocused: {
    backgroundColor: colors.accentSoft,
    borderRadius: radii.lg,
    marginHorizontal: -8,
    paddingHorizontal: 8,
  },
  fieldMarkerFrom: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2.5,
    borderColor: PIN_COLORS.start,
    backgroundColor: colors.surface,
    zIndex: 1,
  },
  fieldMarkerTo: {
    width: 12,
    height: 12,
    borderRadius: 3,
    backgroundColor: PIN_COLORS.end,
    zIndex: 1,
  },
  fieldContent: { flex: 1 },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textFaint,
    letterSpacing: 0.8,
    marginBottom: 1,
  },
  fieldInput: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    paddingVertical: 0,
  },
  clearButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearIcon: {
    fontSize: 15,
    lineHeight: 17,
    color: colors.textSecondary,
    fontWeight: '700',
  },

  /* Suggestions ----------------------------------------------------------- */
  suggestionList: {
    marginTop: 6,
    maxHeight: 200,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  suggestionRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  suggestionRowPressed: { backgroundColor: colors.accentSoft },
  suggestionIcon: {
    width: 30,
    height: 30,
    borderRadius: radii.sm,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionIconText: { fontSize: 13 },
  suggestionText: { flex: 1 },
  suggestionName: { fontSize: 14, fontWeight: '500', color: colors.text },
  suggestionArea: { fontSize: 11, color: colors.textFaint, marginTop: 1 },

  /* Priority chips -------------------------------------------------------- */
  priorityRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  priorityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    ...chipShadow,
  },
  priorityChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  priorityChipPressed: { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder },
  priorityIcon: { fontSize: 13 },
  priorityText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  priorityTextActive: { color: '#fff' },

  /* Search button --------------------------------------------------------- */
  searchButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    paddingVertical: 16,
    alignItems: 'center',
    ...cardShadow,
  },
  searchButtonDisabled: { backgroundColor: colors.accentDisabled },
  searchButtonPressed: { backgroundColor: colors.accentPressed },
  searchButtonText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },

  /* Bottom results sheet -------------------------------------------------- */
  bottomSheet: {
    position: 'absolute',
    left: 16,
    right: 16,
    // 240 px cap keeps a generous band of visible map above the sheet.
    maxHeight: 240,
    backgroundColor: colors.surface,
    borderRadius: radii.xxl,
    ...cardShadow,
    overflow: 'hidden',
  },
  sheetScroll: { flex: 1 },
  sheetContent: { padding: 16, gap: 12, paddingTop: 8 },

  /** Visual drag-handle hint */
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: 8,
  },

  /* Error / empty --------------------------------------------------------- */
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderRadius: radii.md,
    padding: 12,
  },
  errorIcon: { fontSize: 16 },
  errorText: { flex: 1, color: '#B91C1C', fontSize: 13, fontWeight: '500' },

  emptyState: { alignItems: 'center', gap: 6, paddingVertical: 8 },
  emptyEmoji: { fontSize: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  emptyBody: { color: colors.textSecondary, textAlign: 'center', fontSize: 13, lineHeight: 18 },

  /* Summary pills --------------------------------------------------------- */
  summaryPills: {
    flexDirection: 'row',
    backgroundColor: colors.accentSoft,
    borderRadius: radii.lg,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  summaryPill: { flex: 1, alignItems: 'center', gap: 2 },
  summaryPillDivider: { width: 1, backgroundColor: colors.accentBorder },
  summaryPillLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  summaryPillValue: { fontSize: 18, fontWeight: '800', color: colors.accent },

  /* Leg rows -------------------------------------------------------------- */
  legRow: {
    flexDirection: 'row',
    backgroundColor: colors.fill,
    borderRadius: radii.lg,
    overflow: 'hidden',
    minHeight: 68,
  },
  legStrip: { width: 4 },
  legBody: { flex: 1, padding: 10, gap: 4 },
  legBadgeRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  legStepBadge: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 2 },
  legStepText: { fontSize: 11, fontWeight: '700' },
  transferBadge: {
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: '#FEF3C7',
  },
  transferBadgeText: { fontSize: 11, fontWeight: '600', color: '#92400E' },
  legNames: { fontSize: 13, fontWeight: '600', color: colors.text, lineHeight: 18 },
  transferNote: { fontSize: 11, color: colors.amberText, marginTop: 1 },
  legFares: { alignItems: 'flex-end', justifyContent: 'center', paddingRight: 12, gap: 2 },
  legFare: { fontSize: 15, fontWeight: '800', color: colors.text },
  runningTotal: { fontSize: 10, color: colors.textFaint },

  /* CTA ------------------------------------------------------------------- */
  breakdownLink: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: radii.lg,
    backgroundColor: colors.accentSoft,
    marginTop: 4,
  },
  breakdownLinkPressed: { backgroundColor: colors.accentBorder },
  breakdownLinkText: { color: colors.accent, fontSize: 14, fontWeight: '700' },
});
