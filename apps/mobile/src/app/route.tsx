import { useEffect, useRef, useState } from 'react';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import type { PlanLeg } from '@hackathon26/shared';
import { formatZar } from '../lib/format';
import { loadPlan } from '../lib/planStore';

/** Distinct colors per leg so taxi changes are visually obvious. */
const LEG_COLORS = ['#0b5cad', '#c2571a', '#2e7d32', '#7b1fa2'];

const INITIAL_REGION = {
  latitude: -25.6,
  longitude: 28.24,
  latitudeDelta: 1.2,
  longitudeDelta: 1.2,
};

/** Cash to carry: fares are rounded up to note denominations, change is scarce. */
function cashNeeded(totalFareZar: number): number {
  return Math.ceil(totalFareZar / 20) * 20;
}

function LegRow({ leg, index, isLast }: { leg: PlanLeg; index: number; isLast: boolean }) {
  return (
    <View style={styles.legCard}>
      <View style={styles.legRow}>
        <View style={[styles.legDot, { backgroundColor: LEG_COLORS[index % LEG_COLORS.length] }]} />
        <View style={styles.legText}>
          <Text style={styles.legEnds} numberOfLines={2}>
            {leg.fromName} → {leg.toName}
          </Text>
          {!isLast ? (
            <Text style={styles.transferNote}>Change taxis at {leg.toName}</Text>
          ) : null}
        </View>
        <Text style={styles.legFare}>{leg.fareZar > 0 ? formatZar(leg.fareZar) : 'Free'}</Text>
      </View>
    </View>
  );
}

/**
 * Route breakdown: the full leg-by-leg plan from the saved journey with fares,
 * a running total, the cash-to-carry figure and the demand signal button.
 * The plan lives in the module store for the current session only.
 */
export default function RouteScreen() {
  const saved = loadPlan();
  const [demandSent, setDemandSent] = useState(false);
  const mapRef = useRef<MapView>(null);

  if (!saved || saved.plan.legs.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>This plan is no longer available</Text>
        <Text style={styles.emptyBody}>
          Plans are kept for the current session only. Plan the trip again to see the breakdown.
        </Text>
        <Link href="/" asChild>
          <Pressable style={styles.cta}>
            <Text style={styles.ctaText}>Plan a new trip</Text>
          </Pressable>
        </Link>
      </View>
    );
  }

  const { plan, fromLabel, toLabel, source } = saved;
  const cash = cashNeeded(plan.totalFareZar);

  const points = plan.legs.flatMap((leg) =>
    leg.path.map((p) => ({ latitude: p.lat, longitude: p.lng })),
  );

  useEffect(() => {
    if (points.length >= 2) {
      setTimeout(
        () => mapRef.current?.fitToCoordinates(points, { edgePadding: { top: 60, bottom: 60, left: 40, right: 40 } }),
        100,
      );
    }
    // The route is fixed for the lifetime of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.corridor} numberOfLines={2}>
          {fromLabel} → {toLabel}
        </Text>
        <Text style={styles.totals}>
          {formatZar(plan.totalFareZar)} · {plan.legCount} taxi{plan.legCount === 1 ? '' : 's'}
        </Text>
        {source !== 'api' ? (
          <Text style={styles.sampleBadge}>Sample data — routing API offline</Text>
        ) : null}
      </View>

      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={INITIAL_REGION}
        >
          {plan.legs.map((leg, index) => {
            const coordinates = leg.path.map((p) => ({ latitude: p.lat, longitude: p.lng }));
            const color = LEG_COLORS[index % LEG_COLORS.length]!;
            const midpoint = leg.path[Math.floor(leg.path.length / 2)];
            return (
              <View key={`leg-${index}`}>
                <Polyline coordinates={coordinates} strokeColor={color} strokeWidth={4} />
                {midpoint ? (
                  <Marker
                    coordinate={{ latitude: midpoint.lat, longitude: midpoint.lng }}
                    anchor={{ x: 0.5, y: 0.5 }}
                    tracksViewChanges={false}
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
                    pinColor={index === 0 ? '#2e7d32' : '#f9a825'}
                  />
                ) : null}
                {end && lastLeg ? (
                  <Marker
                    coordinate={{ latitude: end.lat, longitude: end.lng }}
                    title={leg.toName}
                    pinColor="#c62828"
                  />
                ) : null}
              </View>
            );
          })}
        </MapView>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Step by step</Text>
        {plan.legs.map((leg, index) => (
          <LegRow
            key={`${leg.fromRankId}-${leg.toRankId}-${index}`}
            leg={leg}
            index={index}
            isLast={index === plan.legs.length - 1}
          />
        ))}
      </View>

      <View style={styles.section}>
        <View style={[styles.fareRow, styles.fareTotalRow]}>
          <Text style={styles.fareTotalLabel}>Total fare</Text>
          <Text style={styles.fareTotalAmount}>{formatZar(plan.totalFareZar)}</Text>
        </View>
        <View style={styles.cashCard}>
          <Text style={styles.cashAmount}>Carry {formatZar(cash)} in cash</Text>
          <Text style={styles.cashNote}>
            Operators rarely have change — fares are rounded up to note denominations, so carry
            small notes and coins.
          </Text>
        </View>
      </View>

      <Pressable
        style={[styles.demandButton, demandSent && styles.demandButtonSent]}
        onPress={() => setDemandSent(true)}
        disabled={demandSent}
      >
        <Text style={demandSent ? styles.demandTextSent : styles.demandText}>
          {demandSent ? 'Demand reported — marshals notified' : 'Report high demand on this route'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 16,
    gap: 12,
    paddingBottom: 32,
  },
  header: {
    gap: 4,
  },
  corridor: {
    fontSize: 20,
    fontWeight: '600',
  },
  totals: {
    fontSize: 15,
    color: '#555',
  },
  sampleBadge: {
    fontSize: 12,
    color: '#b45309',
    backgroundColor: '#fdf3e3',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 4,
  },
  mapWrap: {
    height: 240,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#d9e3ee',
  },
  map: {
    flex: 1,
  },
  fareBubble: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  fareBubbleText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  section: {
    gap: 8,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  legCard: {
    borderWidth: 1,
    borderColor: '#e3e9f0',
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  legRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  legDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
  },
  legText: {
    flex: 1,
    gap: 4,
  },
  legEnds: {
    fontSize: 14,
    fontWeight: '500',
  },
  legFare: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0b5cad',
  },
  transferNote: {
    fontSize: 12,
    color: '#41506b',
    backgroundColor: '#f4f6f9',
    borderRadius: 8,
    padding: 8,
  },
  fareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  fareTotalRow: {
    borderTopWidth: 1,
    borderTopColor: '#e3e9f0',
    paddingTop: 8,
  },
  fareTotalLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  fareTotalAmount: {
    fontSize: 15,
    fontWeight: '600',
  },
  cashCard: {
    backgroundColor: '#fdf3e3',
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  cashAmount: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8a4b08',
  },
  cashNote: {
    fontSize: 12,
    color: '#8a4b08',
  },
  demandButton: {
    backgroundColor: '#2e7d32',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  demandButtonSent: {
    backgroundColor: '#dcefe0',
  },
  demandText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  demandTextSent: {
    color: '#2e7d32',
    fontSize: 15,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    backgroundColor: '#fff',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
  },
  cta: {
    backgroundColor: '#0b5cad',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 4,
  },
  ctaText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
