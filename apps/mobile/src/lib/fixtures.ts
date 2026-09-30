import type {
  Leg,
  PlanLeg,
  PlanResult,
  Rank,
  TransportMode,
} from '@hackathon26/shared';

/**
 * Offline journey fixtures.
 *
 * Mirrors data/seed/ranks.json and data/seed/legs.json (same ids, fares,
 * durations and reliabilities) so the UI stays demoable while the API is
 * unreachable. planJourney() falls back to here whenever the API call fails,
 * so the swap to real data is automatic — keep the numbers in sync with the
 * seed files.
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

function toLeg(template: LegTemplate): Leg {
  const from = RANK_BY_ID.get(template.fromRankId);
  const to = RANK_BY_ID.get(template.toRankId);
  const path = from && to ? [from.location, to.location] : undefined;
  return { ...template, path };
}

/**
 * Builds a plan over the seeded corridor for the requested rank pair, in the
 * exact POST /routes/plan wire shape. Unreachable or reverse-direction pairs
 * return null — the same meaning as the API's 404 "no route found".
 */
export function buildFixturePlan(fromRankId: string, toRankId: string): PlanResult | null {
  const options: RouteOptionLite[] = TRUNKS.map((trunk) => sliceTrunk(trunk, fromRankId, toRankId))
    .filter((option): option is RouteOptionLite => option !== null);
  if (options.length === 0) return null;

  // Match the planner's contract: one best option per priority call.
  // Cheapest first, then fastest as the API's priority-aware tiebreak.
  options.sort((a, b) => a.totalFareZar - b.totalFareZar || a.totalMinutes - b.totalMinutes);
  const best = options[0];

  const legs: PlanLeg[] = best.legs.map((leg) => {
    const from = RANK_BY_ID.get(leg.fromRankId);
    const to = RANK_BY_ID.get(leg.toRankId);
    const path = from && to ? [from.location, to.location] : [];
    return {
      fromRankId: leg.fromRankId,
      fromName: from?.name ?? leg.fromRankId,
      toRankId: leg.toRankId,
      toName: to?.name ?? leg.toRankId,
      path: path.map((point) => ({ lat: point.latitude, lng: point.longitude })),
      fareZar: leg.fareZar,
    };
  });

  return {
    legs,
    totalFareZar: best.totalFareZar,
    legCount: legs.length,
  };
}

/** Internal slice of a trunk: master-style legs plus the totals we display. */
interface RouteOptionLite {
  legs: Leg[];
  totalFareZar: number;
  totalMinutes: number;
}

/** Slices one trunk between the origin and destination ranks, if it serves both in order. */
function sliceTrunk(trunk: string[], fromRankId: string, toRankId: string): RouteOptionLite | null {
  const legs = trunk
    .map((id) => LEG_TEMPLATES.find((template) => template.id === id))
    .filter((template): template is LegTemplate => Boolean(template))
    .map(toLeg);
  if (legs.length === 0) return null;

  const rankSequence = [legs[0].fromRankId, ...legs.map((leg) => leg.toRankId)];
  const start = rankSequence.indexOf(fromRankId);
  const end = rankSequence.indexOf(toRankId);
  if (start === -1 || end === -1 || end <= start) return null;

  const chosen = legs.slice(start, end);
  return {
    legs: chosen,
    totalFareZar: chosen.reduce((sum, leg) => sum + leg.fareZar, 0),
    totalMinutes: chosen.reduce((sum, leg) => sum + leg.estimatedMinutes, 0),
  };
}
