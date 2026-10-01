import { useEffect, useRef, useState } from 'react';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PlanLeg } from '@hackathon26/shared';
import { formatZar } from '../lib/format';
import { polylineMidpoint, regionForPath } from '../lib/geo';
import { loadPlan } from '../lib/planStore';
import { LEG_COLORS, PIN_COLORS, cardShadow, chipShadow, colors, radii } from '../lib/theme';
import { ScreenHeader } from '../components/ScreenHeader';

const INITIAL_REGION = {
  latitude: -25.6,
  longitude: 28.24,
  latitudeDelta: 1.2,
  longitudeDelta: 1.2,
};

/** Cash to carry: fares are rounded up to note denominations. */
function cashNeeded(totalFareZar: number): number {
  return Math.ceil(totalFareZar / 20) * 20;
}

function LegRow({
  leg,
  index,
  isLast,
  active,
  onPress,
}: {
  leg: PlanLeg;
  index: number;
  isLast: boolean;
  active: boolean;
  onPress: () => void;
}) {
  const color = LEG_COLORS[index % LEG_COLORS.length]!;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.legCard,
        active && styles.legCardActive,
        pressed && styles.legCardPressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint="Centers the map on this leg"
    >
      {/* Left colour strip */}
      <View style={[styles.legStrip, { backgroundColor: color }]} />

      <View style={styles.legBody}>
        {/* Step badge row */}
        <View style={styles.legBadgeRow}>
          <View style={[styles.stepBadge, { backgroundColor: color + '22' }]}>
            <Text style={[styles.stepBadgeText, { color }]}>Leg {index + 1}</Text>
          </View>
          {active && (
            <View style={styles.activeBadge}>
              <Text style={styles.activeBadgeText}>● On map</Text>
            </View>
          )}
          {!isLast && (
            <View style={styles.transferBadge}>
              <Text style={styles.transferBadgeText}>🔄 Transfer</Text>
            </View>
          )}
        </View>

        {/* Route names */}
        <Text style={styles.legEnds} numberOfLines={2}>
          {leg.fromName} → {leg.toName}
        </Text>

        {/* Transfer note */}
        {!isLast && (
          <Text style={styles.transferNote}>Change taxis at {leg.toName}</Text>
        )}
      </View>

      {/* Fare */}
      <Text style={styles.legFare}>{leg.fareZar > 0 ? formatZar(leg.fareZar) : 'Free'}</Text>
    </Pressable>
  );
}

/**
 * Route breakdown screen — redesigned to match the reference UI.
 * Tapping a leg highlights it and frames its segment on the map.
 */
export default function RouteScreen() {
  const saved = loadPlan();
  const [demandSent, setDemandSent] = useState(false);
  const [activeLeg, setActiveLeg] = useState<number | null>(null);
  const mapRef = useRef<MapView>(null);
  const insets = useSafeAreaInsets();

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  if (!saved || saved.plan.legs.length === 0) {
    return (
      <SafeAreaView style={styles.emptyContainer} edges={['top', 'left', 'right']}>
        <ScreenHeader title="Your journey" onBack={goBack} />
        <View style={styles.emptyBodyWrap}>
          <Text style={styles.emptyEmoji}>📭</Text>
          <Text style={styles.emptyTitle}>Plan not available</Text>
          <Text style={styles.emptyBody}>
            Plans are kept for the current session only. Plan the trip again to see the breakdown.
          </Text>
          <Link href="/" asChild>
            <Pressable style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}>
              <Text style={styles.ctaText}>Plan a new trip</Text>
            </Pressable>
          </Link>
        </View>
      </SafeAreaView>
    );
  }

  const { plan, fromLabel, toLabel, source } = saved;
  const cash = cashNeeded(plan.totalFareZar);

  const points = plan.legs.flatMap((leg) =>
    leg.path.map((p) => ({ latitude: p.lat, longitude: p.lng })),
  );

  const focusLeg = (index: number) => {
    const leg = plan.legs[index];
    if (!leg) return;
    setActiveLeg(index);
    const region = regionForPath(leg.path);
    if (region) mapRef.current?.animateToRegion(region, 350);
  };

  useEffect(() => {
    if (points.length >= 2) {
      setTimeout(
        () => mapRef.current?.fitToCoordinates(points, { edgePadding: { top: 60, bottom: 60, left: 40, right: 40 } }),
        100,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScreenHeader
        title="Your journey"
        subtitle={`${fromLabel} → ${toLabel}`}
        onBack={goBack}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        {/* Data source badge */}
        {source !== 'api' && (
          <View style={styles.sampleBadge}>
            <Text style={styles.sampleBadgeText}>⚠️ Sample data — routing API offline</Text>
          </View>
        )}

        {/* Quick-stats strip */}
        <View style={styles.statsStrip}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{formatZar(plan.totalFareZar)}</Text>
            <Text style={styles.statLabel}>Total fare</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{plan.legCount}</Text>
            <Text style={styles.statLabel}>Taxi{plan.legCount === 1 ? '' : 's'}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{formatZar(cash)}</Text>
            <Text style={styles.statLabel}>Carry cash</Text>
          </View>
        </View>

        {/* Map */}
        <View style={styles.mapWrap}>
          <MapView ref={mapRef} style={styles.map} initialRegion={INITIAL_REGION}>
            {plan.legs.map((leg, index) => {
              const coordinates = leg.path.map((p) => ({ latitude: p.lat, longitude: p.lng }));
              const color = LEG_COLORS[index % LEG_COLORS.length]!;
              const midpoint = polylineMidpoint(leg.path);
              return (
                <View key={`leg-${index}`}>
                  <Polyline
                    coordinates={coordinates}
                    strokeColor={color}
                    strokeWidth={activeLeg === index ? 7 : 4}
                    lineCap="round"
                  />
                  {midpoint ? (
                    <Marker
                      coordinate={{ latitude: midpoint.lat, longitude: midpoint.lng }}
                      anchor={{ x: 0.5, y: 0.5 }}
                    >
                      <View style={[styles.fareBubble, { backgroundColor: color }]}>
                        <Text style={styles.fareBubbleText}>{formatZar(leg.fareZar)}</Text>
                      </View>
                    </Marker>
                  ) : null}
                </View>
              );
            })}
            {plan.legs.map((leg, index) => {
              const start = leg.path[0];
              const end = leg.path[leg.path.length - 1];
              const lastLeg = index === plan.legs.length - 1;
              return (
                <View key={`stops-${index}`}>
                  {start ? (
                    <Marker
                      coordinate={{ latitude: start.lat, longitude: start.lng }}
                      title={leg.fromName}
                      pinColor={index === 0 ? PIN_COLORS.start : PIN_COLORS.transfer}
                    />
                  ) : null}
                  {end && lastLeg ? (
                    <Marker
                      coordinate={{ latitude: end.lat, longitude: end.lng }}
                      title={leg.toName}
                      pinColor={PIN_COLORS.end}
                    />
                  ) : null}
                </View>
              );
            })}
          </MapView>

          {/* Map legend */}
          <View style={styles.mapLegend}>
            <View style={styles.mapLegendItem}>
              <View style={[styles.mapLegendDot, { backgroundColor: PIN_COLORS.start }]} />
              <Text style={styles.mapLegendText}>Start</Text>
            </View>
            <View style={styles.mapLegendItem}>
              <View style={[styles.mapLegendDot, { backgroundColor: PIN_COLORS.transfer }]} />
              <Text style={styles.mapLegendText}>Transfer</Text>
            </View>
            <View style={styles.mapLegendItem}>
              <View style={[styles.mapLegendDot, { backgroundColor: PIN_COLORS.end }]} />
              <Text style={styles.mapLegendText}>End</Text>
            </View>
          </View>
        </View>

        {/* Step by step */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Step by step</Text>
            <Text style={styles.sectionHint}>Tap a leg to focus it on the map</Text>
          </View>
          {plan.legs.map((leg, index) => (
            <LegRow
              key={`${leg.fromRankId}-${leg.toRankId}-${index}`}
              leg={leg}
              index={index}
              isLast={index === plan.legs.length - 1}
              active={activeLeg === index}
              onPress={() => focusLeg(index)}
            />
          ))}
        </View>

        {/* Cash tip card */}
        <View style={styles.cashCard}>
          <View style={styles.cashIconWrap}>
            <Text style={styles.cashIcon}>💵</Text>
          </View>
          <View style={styles.cashText}>
            <Text style={styles.cashAmount}>Carry {formatZar(cash)} in cash</Text>
            <Text style={styles.cashNote}>
              Operators rarely give change — carry small notes and coins.
            </Text>
          </View>
        </View>

        {/* Demand button */}
        <Pressable
          style={({ pressed }) => [
            styles.demandButton,
            demandSent && styles.demandButtonSent,
            pressed && !demandSent && styles.demandButtonPressed,
          ]}
          onPress={() => setDemandSent(true)}
          disabled={demandSent}
        >
          <Text style={[styles.demandText, demandSent && styles.demandTextSent]}>
            {demandSent ? '✅ Demand reported — marshals notified' : '📢 Report high demand on this route'}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 14 },

  /* Sample badge ---------------------------------------------------------- */
  sampleBadge: {
    backgroundColor: colors.amberBg,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  sampleBadgeText: { fontSize: 12, fontWeight: '600', color: colors.amberText },

  /* Stats strip ----------------------------------------------------------- */
  statsStrip: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    paddingVertical: 16,
    paddingHorizontal: 8,
    ...cardShadow,
  },
  statItem: { flex: 1, alignItems: 'center', gap: 3 },
  statValue: { fontSize: 20, fontWeight: '800', color: colors.accent },
  statLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '500' },
  statDivider: { width: 1, backgroundColor: colors.border, marginVertical: 4 },

  /* Map ------------------------------------------------------------------- */
  mapWrap: {
    height: 240,
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    ...cardShadow,
  },
  map: { flex: 1 },
  fareBubble: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  fareBubbleText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  mapLegend: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: radii.lg,
    padding: 8,
    gap: 4,
    ...chipShadow,
  },
  mapLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mapLegendDot: { width: 8, height: 8, borderRadius: 4 },
  mapLegendText: { fontSize: 11, fontWeight: '500', color: colors.text },

  /* Section --------------------------------------------------------------- */
  section: { gap: 8 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  sectionHint: { fontSize: 12, color: colors.textFaint },

  /* Leg cards ------------------------------------------------------------- */
  legCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: colors.border,
    ...chipShadow,
  },
  legCardActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  legCardPressed: { borderColor: colors.accentBorder },
  legStrip: { width: 5 },
  legBody: { flex: 1, padding: 12, gap: 5 },
  legBadgeRow: { flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
  stepBadge: {
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  stepBadgeText: { fontSize: 11, fontWeight: '700' },
  activeBadge: {
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: colors.accentSoft,
  },
  activeBadgeText: { fontSize: 11, fontWeight: '600', color: colors.accent },
  transferBadge: {
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: '#FEF3C7',
  },
  transferBadgeText: { fontSize: 11, fontWeight: '600', color: '#92400E' },
  legEnds: { fontSize: 14, fontWeight: '600', color: colors.text },
  transferNote: { fontSize: 12, color: colors.amberText, fontStyle: 'italic' },
  legFare: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.accent,
    paddingRight: 14,
    paddingVertical: 14,
    alignSelf: 'center',
  },

  /* Cash card ------------------------------------------------------------- */
  cashCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderRadius: radii.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  cashIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radii.lg,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cashIcon: { fontSize: 22 },
  cashText: { flex: 1, gap: 3 },
  cashAmount: { fontSize: 15, fontWeight: '700', color: colors.amberText },
  cashNote: { fontSize: 12, lineHeight: 17, color: '#92400E', opacity: 0.8 },

  /* Demand button --------------------------------------------------------- */
  demandButton: {
    backgroundColor: colors.green,
    borderRadius: radii.lg,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
    ...chipShadow,
  },
  demandButtonPressed: { backgroundColor: colors.greenPressed },
  demandButtonSent: { backgroundColor: colors.greenSoft },
  demandText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  demandTextSent: { color: colors.greenDark },

  /* Empty state ----------------------------------------------------------- */
  emptyContainer: { flex: 1, backgroundColor: colors.bg },
  emptyBodyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 12,
  },
  emptyEmoji: { fontSize: 48, marginBottom: 4 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: colors.text, textAlign: 'center' },
  emptyBody: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  cta: {
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    paddingVertical: 14,
    paddingHorizontal: 28,
    marginTop: 8,
    ...chipShadow,
  },
  ctaPressed: { backgroundColor: colors.accentPressed },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
