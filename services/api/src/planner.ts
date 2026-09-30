/**
 * Journey planner behind POST /routes/plan.
 *
 * Loads ranks and legs from Supabase and searches the directed rank graph for
 * the cheapest, fastest and easiest option. Properties the demo depends on:
 *
 * - Live rerouting: the network is fetched fresh on every plan, so a strike
 *   toggled via `PATCH /marshal/:id/block` reroutes on the next request.
 * - Road-following geometry: a leg uses the DB `path` when it has one and
 *   falls back to the straight line between the two ranks otherwise, so the
 *   planner always returns drawable geometry.
 * - Deterministic: equal-cost paths are compared with an epsilon so float
 *   noise cannot flip the winner between reruns; genuine ties fall through to
 *   structural tie-breaks (fewer legs, then the lexicographically smallest
 *   rank sequence, then edge ids).
 * - Missing data never looks free: unknown minutes are charged a large
 *   penalty (an "instant" leg would win every search) and an unknown fare is
 *   charged the same penalty.
 *
 * Mirrors services/routing/src/routing/planner.py — keep the rules in sync.
 */
import { randomUUID } from 'node:crypto';
import type { GeoPoint, PlanLeg, RoutePriority } from '@hackathon26/shared';
import { supabase } from './db';

/** Priorities the planner can rank for ('safest' needs time-of-day weighting — later). */
export type PlanPriority = Exclude<RoutePriority, 'safest'>;

export const PLAN_PRIORITIES: readonly PlanPriority[] = ['cheapest', 'fastest', 'easiest'];

/** Point shape used by the flat `ranks` table and the `routes.path` jsonb column. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Charged for unknown fares/minutes so a missing value never looks free or instant. */
const MISSING_COST_PENALTY = 1_000_000;

/** Costs within this distance count as equal — the epsilon that keeps reruns stable. */
const COST_EPSILON = 1e-9;

interface RankRow {
  id: string;
  lat: unknown;
  lng: unknown;
}

interface RouteRow {
  id: unknown;
  from_rank_id: string;
  to_rank_id: string;
  fare: unknown;
  time_mins: unknown;
  is_blocked: boolean | null;
  path: LatLng[] | null;
}

interface PlanEdge {
  id: string;
  fromRankId: string;
  toRankId: string;
  /** Known fare, or the imputed penalty when the source fare is missing. */
  fareZar: number;
  /** Known duration in minutes; null when the source value is missing. */
  minutes: number | null;
  /** Road-following geometry, or the straight-line fallback between ranks. */
  path: GeoPoint[];
}

export interface PlanOption {
  priority: PlanPriority;
  legs: PlanLeg[];
  totalFareZar: number;
  /** Sum of known leg minutes; null when any leg's duration is unknown. */
  totalMinutes: number | null;
}

export interface PlanResponse {
  planId: string;
  originRankId: string;
  destinationRankId: string;
  generatedAt: string;
  options: PlanOption[];
}

/** Error carrying the HTTP status the /routes/plan handler should respond with. */
export class PlanError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PlanError';
  }
}

export interface PlanRouteInput {
  fromRankId: string;
  toRankId: string;
  /** Defaults to all three supported priorities when omitted. */
  priorities?: readonly RoutePriority[];
}

export async function planRoute(input: PlanRouteInput): Promise<PlanResponse> {
  const { rankIds, coords, edges } = await loadNetwork();

  if (!rankIds.has(input.fromRankId)) {
    throw new PlanError(404, `Origin rank not found in network: ${input.fromRankId}`);
  }
  if (!rankIds.has(input.toRankId)) {
    throw new PlanError(404, `Destination rank not found in network: ${input.toRankId}`);
  }

  // 'safest' needs time-of-day reliability weighting the engine doesn't model
  // yet; requesting only that would leave nothing to compute, so fall back to
  // the supported set.
  const requested = new Set<RoutePriority>(input.priorities ?? PLAN_PRIORITIES);
  const priorities = PLAN_PRIORITIES.filter((priority) => requested.has(priority));
  const effective = priorities.length > 0 ? priorities : PLAN_PRIORITIES;

  const options: PlanOption[] = [];
  for (const priority of effective) {
    const path = search(edges, input.fromRankId, input.toRankId, priority);
    if (path) options.push(toOption(priority, path));
  }

  if (options.length === 0) {
    throw new PlanError(404, 'No viable route exists between these ranks.');
  }

  return {
    planId: randomUUID(),
    originRankId: input.fromRankId,
    destinationRankId: input.toRankId,
    generatedAt: new Date().toISOString(),
    options,
  };
}

interface Network {
  rankIds: Set<string>;
  coords: Map<string, LatLng>;
  edges: PlanEdge[];
}

/**
 * Fetch the network fresh on every plan. Blocked legs ("strikes") are
 * filtered here, so toggling `is_blocked` in the DB reroutes the next plan.
 */
async function loadNetwork(): Promise<Network> {
  if (!supabase) throw new PlanError(503, 'Database not configured');

  const [ranksResult, routesResult] = await Promise.all([
    supabase.from('ranks').select('id, lat, lng'),
    supabase
      .from('routes')
      .select('id, from_rank_id, to_rank_id, fare, time_mins, is_blocked, path'),
  ]);

  if (ranksResult.error) {
    throw new PlanError(500, `Failed to load ranks: ${ranksResult.error.message}`);
  }
  if (routesResult.error) {
    throw new PlanError(500, `Failed to load routes: ${routesResult.error.message}`);
  }

  const rankIds = new Set<string>();
  const coords = new Map<string, LatLng>();
  for (const row of (ranksResult.data ?? []) as RankRow[]) {
    rankIds.add(row.id);
    const lat = optNumber(row.lat);
    const lng = optNumber(row.lng);
    if (lat !== null && lng !== null) coords.set(row.id, { lat, lng });
  }

  const edges: PlanEdge[] = [];
  for (const row of (routesResult.data ?? []) as RouteRow[]) {
    if (row.is_blocked) continue;
    edges.push({
      id: String(row.id),
      fromRankId: row.from_rank_id,
      toRankId: row.to_rank_id,
      // Imputed: an unknown fare must never look free.
      fareZar: optNumber(row.fare) ?? MISSING_COST_PENALTY,
      minutes: optNumber(row.time_mins),
      path: resolvePath(row, coords),
    });
  }

  return { rankIds, coords, edges };
}

/** Prefer the road-following DB path; fall back to the straight line between ranks. */
function resolvePath(row: RouteRow, coords: Map<string, LatLng>): GeoPoint[] {
  const points =
    Array.isArray(row.path) && row.path.length >= 2
      ? row.path
      : [coords.get(row.from_rank_id), coords.get(row.to_rank_id)].filter(
          (point): point is LatLng => point !== undefined,
        );
  return points.map((point) => ({ latitude: point.lat, longitude: point.lng }));
}

/** Coerce a Supabase cell to a finite number, or null when unusable. */
function optNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Cost tuple compared lexicographically, componentwise with the epsilon. */
type Cost = [primary: number, secondary: number];

function edgeCost(edge: PlanEdge, priority: PlanPriority): Cost {
  const minutes = edge.minutes ?? MISSING_COST_PENALTY;
  switch (priority) {
    case 'cheapest':
      return [edge.fareZar, minutes];
    case 'fastest':
      return [minutes, edge.fareZar];
    case 'easiest':
      return [1, minutes]; // fewest legs, then minutes
  }
}

function addCost(a: Cost, b: Cost): Cost {
  return [a[0] + b[0], a[1] + b[1]];
}

/** Strictly less, componentwise, with the epsilon absorbing float noise. */
function costLess(a: Cost, b: Cost): boolean {
  if (Math.abs(a[0] - b[0]) > COST_EPSILON) return a[0] < b[0];
  if (Math.abs(a[1] - b[1]) > COST_EPSILON) return a[1] < b[1];
  return false;
}

function costEqual(a: Cost, b: Cost): boolean {
  return Math.abs(a[0] - b[0]) <= COST_EPSILON && Math.abs(a[1] - b[1]) <= COST_EPSILON;
}

function lexLess(a: readonly string[], b: readonly string[]): boolean {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    if (a[i] !== b[i]) return a[i]! < b[i]!;
  }
  return a.length < b.length;
}

/** Deterministic order for equal-cost paths: fewer legs, then ranks, then edge ids. */
function tieLess(
  a: { rankPath: readonly string[]; edgeIds: readonly string[] },
  b: { rankPath: readonly string[]; edgeIds: readonly string[] },
): boolean {
  if (a.rankPath.length !== b.rankPath.length) return a.rankPath.length < b.rankPath.length;
  if (lexLess(a.rankPath, b.rankPath)) return true;
  if (lexLess(b.rankPath, a.rankPath)) return false;
  return lexLess(a.edgeIds, b.edgeIds);
}

interface Visit {
  node: string;
  cost: Cost;
  rankPath: string[];
  edgeIds: string[];
  edges: PlanEdge[];
}

function visitBefore(a: Visit, b: Visit): boolean {
  if (costLess(a.cost, b.cost)) return true;
  if (costLess(b.cost, a.cost)) return false;
  return tieLess(a, b);
}

/**
 * Dijkstra over the directed rank graph. The frontier is scanned linearly —
 * rank networks are tiny, and this avoids heap-comparator drift.
 */
function search(
  allEdges: PlanEdge[],
  origin: string,
  destination: string,
  priority: PlanPriority,
): PlanEdge[] | null {
  const adjacency = new Map<string, PlanEdge[]>();
  for (const edge of allEdges) {
    const list = adjacency.get(edge.fromRankId) ?? [];
    list.push(edge);
    adjacency.set(edge.fromRankId, list);
  }
  // Stable expansion order keeps equal-cost exploration deterministic.
  for (const list of adjacency.values()) {
    list.sort((a, b) => (a.toRankId < b.toRankId ? -1 : a.toRankId > b.toRankId ? 1 : 0));
  }

  const best = new Map<string, { cost: Cost; rankPath: string[]; edgeIds: string[] }>([
    [origin, { cost: [0, 0], rankPath: [origin], edgeIds: [] }],
  ]);
  const settled = new Set<string>();
  const frontier: Visit[] = [
    { node: origin, cost: [0, 0], rankPath: [origin], edgeIds: [], edges: [] },
  ];

  while (frontier.length > 0) {
    let bestIndex = 0;
    for (let i = 1; i < frontier.length; i++) {
      if (visitBefore(frontier[i]!, frontier[bestIndex]!)) bestIndex = i;
    }
    const current = frontier.splice(bestIndex, 1)[0]!;
    if (settled.has(current.node)) continue;
    settled.add(current.node);
    if (current.node === destination) return current.edges;

    for (const edge of adjacency.get(current.node) ?? []) {
      if (settled.has(edge.toRankId)) continue;
      const cost = addCost(current.cost, edgeCost(edge, priority));
      const rankPath = [...current.rankPath, edge.toRankId];
      const edgeIds = [...current.edgeIds, edge.id];
      const incumbent = best.get(edge.toRankId);
      const improves =
        incumbent === undefined ||
        costLess(cost, incumbent.cost) ||
        (costEqual(cost, incumbent.cost) && tieLess({ rankPath, edgeIds }, incumbent));
      if (improves) {
        best.set(edge.toRankId, { cost, rankPath, edgeIds });
        frontier.push({
          node: edge.toRankId,
          cost,
          rankPath,
          edgeIds,
          edges: [...current.edges, edge],
        });
      }
    }
  }
  return null;
}

function toOption(priority: PlanPriority, pathEdges: PlanEdge[]): PlanOption {
  const legs: PlanLeg[] = pathEdges.map((edge) => ({
    fromRankId: edge.fromRankId,
    toRankId: edge.toRankId,
    fareZar: edge.fareZar,
    ...(edge.minutes === null ? {} : { minutes: edge.minutes }),
    ...(edge.path.length >= 2 ? { path: edge.path } : {}),
  }));

  return {
    priority,
    legs,
    totalFareZar: round2(pathEdges.reduce((sum, edge) => sum + edge.fareZar, 0)),
    totalMinutes: pathEdges.every((edge) => edge.minutes !== null)
      ? pathEdges.reduce((sum, edge) => sum + (edge.minutes ?? 0), 0)
      : null,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
