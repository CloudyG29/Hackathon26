import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import type { RouteOption } from '@hackathon26/shared';
import { JourneyMap } from '../components/JourneyMap';
import { RANKS } from '../lib/fixtures';
import {
  MODE_ICONS,
  MODE_LABELS,
  TAG_LABELS,
  formatDistance,
  formatDuration,
  formatZar,
} from '../lib/format';
import { loadPlan } from '../lib/planStore';

const RANK_BY_ID = new Map(RANKS.map((rank) => [rank.id, rank]));

function rankName(rankId: string): string {
  return RANK_BY_ID.get(rankId)?.name ?? rankId;
}

/** "Finding it" guidance for the rank where the journey starts. */
function renderStartLandmark(rankId: string) {
  const rank = RANK_BY_ID.get(rankId);
  if (!rank?.landmarkNotes) return null;
  return <Text style={styles.legNote}>Finding it: {rank.landmarkNotes}</Text>;
}

/** Transfer guidance after the given leg: what to do at the next rank. */
function renderTransferNote(option: RouteOption, legIndex: number) {
  const transfer = option.transfers.find(
    (item) => item.rankId === option.legs[legIndex].toRankId,
  );
  if (!transfer) return null;
  const name = rankName(transfer.rankId);
  const text = transfer.instructions ? `Change at ${name}: ${transfer.instructions}` : `Change at ${name}.`;
  return <Text style={styles.transferNote}>{text}</Text>;
}

/**
 * Route breakdown: option cards (cheapest / fastest / easiest / safest), the
 * leg-by-leg plan with fares and landmark guidance, the cash-to-carry
 * figure, and the demand signal button.
 */
export default function RouteScreen() {
  const { planId } = useLocalSearchParams<{ planId?: string }>();
  const saved = loadPlan(planId);
  const options = saved?.plan.options ?? [];
  const [selectedId, setSelectedId] = useState(options[0]?.id);
  const [demandSent, setDemandSent] = useState(false);

  const selected = useMemo(
    () => options.find((option) => option.id === selectedId) ?? options[0],
    [options, selectedId],
  );

  if (!saved) {
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

  const { plan, source } = saved;

  if (options.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>No route found yet</Text>
        <Text style={styles.emptyBody}>
          There is no seeded connection from {plan.originLabel} to {plan.destinationLabel} in this
          direction yet.
        </Text>
        <Link href="/" asChild>
          <Pressable style={styles.cta}>
            <Text style={styles.ctaText}>Plan a different trip</Text>
          </Pressable>
        </Link>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.corridor} numberOfLines={2}>
          {plan.originLabel} → {plan.destinationLabel}
        </Text>
        {selected ? (
          <Text style={styles.totals}>
            {formatZar(selected.totalFareZar)} · {formatDuration(selected.totalMinutes)} ·{' '}
            {selected.transferCount} change{selected.transferCount === 1 ? '' : 's'}
          </Text>
        ) : null}
        {source === 'fixtures' ? (
          <Text style={styles.sampleBadge}>Sample data — routing API offline</Text>
        ) : null}
      </View>

      {options.map((option) => (
        <Pressable
          key={option.id}
          style={[styles.optionCard, option.id === selected?.id && styles.optionCardSelected]}
          onPress={() => setSelectedId(option.id)}
        >
          <View style={styles.optionHead}>
            <Text style={styles.optionLabel} numberOfLines={1}>
              {option.label}
            </Text>
            <View style={styles.tagRow}>
              {option.tags.map((tag) => (
                <Text key={tag} style={styles.tag}>
                  {TAG_LABELS[tag]}
                </Text>
              ))}
            </View>
          </View>
          <Text style={styles.optionMeta}>
            {formatZar(option.totalFareZar)} · {formatDuration(option.totalMinutes)} ·{' '}
            {option.transferCount} changes · {formatDistance(option.totalDistanceKm)}
          </Text>
        </Pressable>
      ))}

      {selected ? (
        <>
          <View style={styles.mapWrap}>
            <JourneyMap
              ranks={RANKS}
              legs={selected.legs}
              highlightRankIds={[
                selected.legs[0]?.fromRankId ?? '',
                ...selected.legs.map((leg) => leg.toRankId),
              ]}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Step by step</Text>
            {selected.legs.map((leg, index) => (
              <View key={leg.id} style={styles.legCard}>
                <View style={styles.legRow}>
                  <Text style={styles.legIcon}>{MODE_ICONS[leg.mode]}</Text>
                  <View style={styles.legText}>
                    <Text style={styles.legMode}>{MODE_LABELS[leg.mode]}</Text>
                    <Text style={styles.legEnds} numberOfLines={1}>
                      {rankName(leg.fromRankId)} → {rankName(leg.toRankId)}
                    </Text>
                  </View>
                  <View style={styles.legNumbers}>
                    <Text style={styles.legFare}>
                      {leg.fareZar > 0 ? formatZar(leg.fareZar) : 'Free'}
                    </Text>
                    <Text style={styles.legMeta}>
                      {formatDuration(leg.estimatedMinutes)}
                      {leg.distanceKm ? ` · ${formatDistance(leg.distanceKm)}` : ''}
                    </Text>
                  </View>
                </View>
                {leg.departsWhenFull ? (
                  <Text style={styles.legNote}>Leaves when full — allow extra time.</Text>
                ) : null}
                {index === 0 ? renderStartLandmark(leg.fromRankId) : null}
                {index < selected.legs.length - 1 ? renderTransferNote(selected, index) : null}
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Fares and cash</Text>
            {selected.legs.map((leg) => (
              <View key={leg.id} style={styles.fareRow}>
                <Text style={styles.fareLabel} numberOfLines={1}>
                  {MODE_LABELS[leg.mode]} · to {rankName(leg.toRankId)}
                </Text>
                <Text style={styles.fareAmount}>
                  {leg.fareZar > 0 ? formatZar(leg.fareZar) : 'Free'}
                </Text>
              </View>
            ))}
            <View style={[styles.fareRow, styles.fareTotalRow]}>
              <Text style={styles.fareTotalLabel}>Total fare</Text>
              <Text style={styles.fareTotalAmount}>{formatZar(selected.totalFareZar)}</Text>
            </View>
            <View style={styles.cashCard}>
              <Text style={styles.cashAmount}>
                Carry {formatZar(selected.cashNeededZar)} in cash
              </Text>
              <Text style={styles.cashNote}>
                Operators rarely have change — fares are rounded up to note denominations, so carry
                small notes and coins.
              </Text>
            </View>
          </View>

          {/* TODO(person 3): wire to the demand aggregation endpoint once it
              lands (proposed shape: POST /demand with the plan and route ids). */}
          <Pressable
            style={[styles.demandButton, demandSent && styles.demandButtonSent]}
            onPress={() => setDemandSent(true)}
            disabled={demandSent}
          >
            <Text style={demandSent ? styles.demandTextSent : styles.demandText}>
              {demandSent ? 'Demand reported — marshals notified' : 'Report high demand on this route'}
            </Text>
          </Pressable>
        </>
      ) : null}
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
  optionCard: {
    borderWidth: 1,
    borderColor: '#d9e3ee',
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  optionCardSelected: {
    borderColor: '#0b5cad',
    backgroundColor: '#e8f1fb',
  },
  optionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '600',
    flexShrink: 1,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tag: {
    fontSize: 12,
    color: '#0b5cad',
    backgroundColor: '#ddebfa',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  optionMeta: {
    fontSize: 13,
    color: '#555',
  },
  mapWrap: {
    height: 240,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#d9e3ee',
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
  legIcon: {
    fontSize: 20,
  },
  legText: {
    flex: 1,
    gap: 2,
  },
  legMode: {
    fontSize: 15,
    fontWeight: '600',
  },
  legEnds: {
    fontSize: 13,
    color: '#555',
  },
  legNumbers: {
    alignItems: 'flex-end',
    gap: 2,
  },
  legFare: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0b5cad',
  },
  legMeta: {
    fontSize: 12,
    color: '#555',
  },
  legNote: {
    fontSize: 12,
    color: '#b45309',
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
  fareLabel: {
    fontSize: 14,
    color: '#333',
    flexShrink: 1,
  },
  fareAmount: {
    fontSize: 14,
    fontWeight: '600',
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
