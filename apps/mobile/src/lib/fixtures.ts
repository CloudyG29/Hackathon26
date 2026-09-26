import type {
  Leg,
  PlanRouteRequest,
  PlanRouteResponse,
  Rank,
  RouteOption,
  RoutePriority,
  Transfer,
  TransportMode,
} from '@hackathon26/shared';

/**
 * Offline journey fixtures.
 *
 * Mirrors data/seed/ranks.json and data/seed/legs.json (same ids, fares,
 * durations and reliabilities) so the UI stays demoable while
 * POST /routes/plan still returns 501. planJourney() falls back to here
 * whenever the API is unreachable, so the swap to real data is automatic
 * once the routing engine lands — keep the numbers in sync with the seed
 * files until then.
 */

export const RANKS: Rank[] = [
  {
    id: 'rank-jhb-bree',
    name: 'Bree Street Taxi Rank',
    area: 'Johannesburg CBD, Gauteng',
    location: { latitude: -26.2041, longitude: 28.0418 },
    modes: ['mini_bus_taxi', 'local_bus'],
    landmarkNotes:
      'Multi-storey rank between Bree and Kerk Street. The long-distance deck is on the upper level - take the ramp on the Lillian Ngoyi side.',
    facilities: ['toilets', 'street food', 'cellphone charging stalls'],
  },
  {
    id: 'rank-jhb-noord',
    name: 'Noord Street Taxi Rank',
    area: 'Johannesburg CBD, Gauteng',
    location: { latitude: -26.2027, longitude: 28.0455 },
    modes: ['long_distance_taxi', 'mini_bus_taxi'],
    landmarkNotes:
      'Directly opposite the Noord Street shopping strip. Long-distance departures load from the basement level; loading bays are signposted by destination province.',
    facilities: ['toilets', 'guarded parking', 'indoor waiting area'],
  },
  {
    id: 'rank-ermelo',
    name: 'Ermelo Taxi Rank',
    area: 'Ermelo, Mpumalanga',
    location: { latitude: -26.5333, longitude: 29.9833 },
    modes: ['long_distance_taxi', 'mini_bus_taxi'],
    landmarkNotes:
      'Main interchange for the Mpumalanga corridor. Ask for the Mbombela-bound row - the local route stands are at the opposite end of the same hall.',
    facilities: ['toilets', 'tuck shop'],
  },
  {
    id: 'rank-mbombela',
    name: 'Mbombela Taxi Rank',
    area: 'Mbombela (Nelspruit), Mpumalanga',
    location: { latitude: -25.4753, longitude: 30.9694 },
    modes: ['long_distance_taxi', 'mini_bus_taxi', 'local_bus'],
    landmarkNotes:
      'Arrivals drop on the eastern side near the bus terminal; the mini-bus stands for White River and Hazyview are one level down.',
    facilities: ['toilets', 'ATM', 'indoor waiting area'],
  },
  {
    id: 'rank-white-river',
    name: 'White River Mini-Taxi Rank',
    area: 'White River, Mpumalanga',
    location: { latitude: -25.3286, longitude: 31.0114 },
    modes: ['mini_bus_taxi'],
    landmarkNotes:
      'Small open-air rank behind the main road shops. Vehicles leave once full.',
    facilities: ['toilets'],
  },
];

const RANK_BY_ID = new Map(RANKS.map((rank) => [rank.id, rank]));

/** A seeded leg without the geometric path — coordinates come from the ranks. */
interface LegTemplate {
  id: string;
  mode: TransportMode;
  fromRankId: string;
  toRankId: string;
  fareZar: number;
  estimatedMinutes: number;
  distanceKm: number;
  reliability: number;
  departsWhenFull: boolean;
}

const LEG_TEMPLATES: LegTemplate[] = [
  {
    id: 'leg-bree-noord-walk',
    mode: 'walk',
    fromRankId: 'rank-jhb-bree',
    toRankId: 'rank-jhb-noord',
    fareZar: 0,
    estimatedMinutes: 12,
    distanceKm: 0.9,
    reliability: 1,
    departsWhenFull: false,
  },
  {
    id: 'leg-noord-ermelo',
    mode: 'long_distance_taxi',
    fromRankId: 'rank-jhb-noord',
    toRankId: 'rank-ermelo',
    fareZar: 380,
    estimatedMinutes: 210,
    distanceKm: 300,
    reliability: 0.8,
    departsWhenFull: true,
  },
  {
    id: 'leg-ermelo-mbombela',
    mode: 'long_distance_taxi',
    fromRankId: 'rank-ermelo',
    toRankId: 'rank-mbombela',
    fareZar: 180,
    estimatedMinutes: 120,
    distanceKm: 180,
    reliability: 0.75,
    departsWhenFull: true,
  },
  {
    id: 'leg-noord-mbombela-direct',
    mode: 'long_distance_taxi',
    fromRankId: 'rank-jhb-noord',
    toRankId: 'rank-mbombela',
    fareZar: 520,
    estimatedMinutes: 300,
    distanceKm: 360,
    reliability: 0.7,
    departsWhenFull: true,
  },
  {
    id: 'leg-mbombela-white-river',
    mode: 'mini_bus_taxi',
    fromRankId: 'rank-mbombela',
    toRankId: 'rank-white-river',
    fareZar: 35,
    estimatedMinutes: 35,
    distanceKm: 22,
    reliability: 0.9,
    departsWhenFull: true,
  },
];

/**
 * Ordered leg chains that span the seeded corridor: the through-Ermelo
 * service and the Noord-Mbombela direct service. Slicing either chain
 * between two ranks produces a plausible RouteOption for any served pair.
 */
const TRUNKS: string[][] = [
  ['leg-bree-noord-walk', 'leg-noord-ermelo', 'leg-ermelo-mbombela', 'leg-mbombela-white-river'],
  ['leg-bree-noord-walk', 'leg-noord-mbombela-direct', 'leg-mbombela-white-river'],
];

const TAG_ROUTE_LABELS: Record<RoutePriority, string> = {
  cheapest: 'Cheapest route',
  fastest: 'Fastest route',
  easiest: 'Easiest route',
  safest: 'Safest route',
};

function toLeg(template: LegTemplate): Leg {
  const from = RANK_BY_ID.get(template.fromRankId);
  const to = RANK_BY_ID.get(template.toRankId);
  const path = from && to ? [from.location, to.location] : undefined;
  return { ...template, path };
}

function averageReliability(legs: Leg[]): number {
  if (legs.length === 0) return 0;
  return legs.reduce((sum, leg) => sum + (leg.reliability ?? 1), 0) / legs.length;
}

/** Slices one trunk between the origin and destination ranks, if it serves both in order. */
function sliceOption(trunk: string[], originRankId: string, destinationRankId: string, index: number): RouteOption | null {
  const legs = trunk
    .map((id) => LEG_TEMPLATES.find((template) => template.id === id))
    .filter((template): template is LegTemplate => Boolean(template))
    .map(toLeg);
  if (legs.length === 0) return null;

  const rankSequence = [legs[0].fromRankId, ...legs.map((leg) => leg.toRankId)];
  const start = rankSequence.indexOf(originRankId);
  const end = rankSequence.indexOf(destinationRankId);
  if (start === -1 || end === -1 || end <= start) return null;

  const chosen = legs.slice(start, end);
  const transfers: Transfer[] = rankSequence.slice(start + 1, end).map((rankId) => ({
    rankId,
    instructions: RANK_BY_ID.get(rankId)?.landmarkNotes,
  }));

  const totalFareZar = chosen.reduce((sum, leg) => sum + leg.fareZar, 0);
  const totalMinutes = chosen.reduce((sum, leg) => sum + leg.estimatedMinutes, 0);
  const totalDistanceKm = chosen.reduce((sum, leg) => sum + (leg.distanceKm ?? 0), 0);

  return {
    id: `fixture-option-${index}`,
    label: '',
    tags: [],
    legs: chosen,
    transfers,
    totalFareZar,
    /** Rounded up to note denominations — see cashNeededZar in packages/shared. */
    cashNeededZar: Math.ceil(totalFareZar / 20) * 20,
    totalMinutes,
    totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
    transferCount: transfers.length,
  };
}

/** Assigns cheapest/fastest/easiest/safest tags and labels once all options exist. */
function assignTags(options: RouteOption[]): void {
  if (options.length === 0) return;
  const minFare = Math.min(...options.map((option) => option.totalFareZar));
  const minMinutes = Math.min(...options.map((option) => option.totalMinutes));
  const minTransfers = Math.min(...options.map((option) => option.transferCount));
  const maxReliability = Math.max(...options.map((option) => averageReliability(option.legs)));

  for (const option of options) {
    const tags: RoutePriority[] = [];
    if (option.totalFareZar === minFare) tags.push('cheapest');
    if (option.totalMinutes === minMinutes) tags.push('fastest');
    if (option.transferCount === minTransfers) tags.push('easiest');
    if (averageReliability(option.legs) === maxReliability) tags.push('safest');
    option.tags = tags;
    const firstTag = tags[0];
    option.label = firstTag ? TAG_ROUTE_LABELS[firstTag] : 'Alternative route';
  }

  options.sort((a, b) => a.totalFareZar - b.totalFareZar);
}

/**
 * Builds a plan over the seeded corridor for whatever endpoints were asked
 * for. Unreachable or reverse-direction pairs return an empty options array —
 * the same shape the real API will use for "no route found".
 */
export function buildFixturePlan(request: PlanRouteRequest): PlanRouteResponse {
  // The rank pickers always send rankIds; the fallbacks keep free-text
  // endpoints demoable at corridor defaults.
  const originRankId = request.origin.rankId ?? 'rank-jhb-bree';
  const destinationRankId = request.destination.rankId ?? 'rank-white-river';

  const options = TRUNKS.map((trunk, index) =>
    sliceOption(trunk, originRankId, destinationRankId, index),
  ).filter((option): option is RouteOption => option !== null);
  assignTags(options);

  return {
    planId: `fixture-${originRankId}-${destinationRankId}-${Date.now()}`,
    originLabel: request.origin.label,
    destinationLabel: request.destination.label,
    options,
    generatedAt: new Date().toISOString(),
  };
}
