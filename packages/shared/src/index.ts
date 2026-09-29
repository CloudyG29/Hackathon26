/**
 * Shared domain model for the long-distance commuter navigator.
 *
 * This package is intentionally TYPES-ONLY. Type-only symbols are erased at
 * build time, so the mobile bundler never has to resolve any runtime code from
 * another workspace. When you need runtime helpers (fare maths, formatters),
 * add them here — Expo's monorepo support already watches this folder.
 */

/** How a single leg of a journey is travelled. */
export type TransportMode =
  | 'long_distance_taxi'
  | 'mini_bus_taxi'
  | 'local_bus'
  | 'metro_train'
  | 'walk';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/**
 * A place a commuter can get on, get off, or change vehicles.
 * Covers long-distance taxi ranks, bus terminals and interchanges.
 */
export interface Rank {
  id: string;
  name: string;
  /** e.g. "Bree Street Taxi Rank, Johannesburg" */
  area?: string;
  location: GeoPoint;
  /** Which vehicle types depart from here. Used to match valid transfers. */
  modes: TransportMode[];
  /**
   * Visual landmark guidance for first-time visitors.
   * e.g. "Look for the yellow container stalls on the north side."
   */
  landmarkNotes?: string;
  /** Photo of the rank entrance / boarding area. */
  landmarkPhotoUrl?: string;
  /** Paid facilities: toilets, guarded parking, indoor waiting area. */
  facilities?: string[];
  /** Formal rank vs informal roadside loading point (from the facility survey). */
  kind?: 'formal' | 'informal';
}

/** One hop of a journey, from one rank to the next. */
export interface Leg {
  id: string;
  mode: TransportMode;
  fromRankId: string;
  toRankId: string;
  /** Fare in South African rand for this leg only. */
  fareZar: number;
  estimatedMinutes: number;
  distanceKm?: number;
  /** 0..1 — how often this leg runs on schedule. Drives the "reliable" ranking. */
  reliability?: number;
  /** True when a vehicle only departs once full (common for long-distance taxis). */
  departsWhenFull?: boolean;
  /** Geometric path between the two ranks, for drawing the map line. */
  path?: GeoPoint[];
  /** The taxi route this hop belongs to, when the hop came from route data. */
  routeId?: string;
  /** Direction of travel along the parent taxi route. */
  direction?: 'out' | 'return';
}

/** What a commuter must physically do at a change-over, and what to watch for. */
export interface Transfer {
  rankId: string;
  /** Walking time between the drop-off and the next boarding point. */
  walkMinutes?: number;
  /** e.g. "Ask for the Mbombela-bound row, not the local row." */
  instructions?: string;
  landmarkNotes?: string;
}

export type RoutePriority = 'cheapest' | 'fastest' | 'easiest' | 'safest';

/** A complete journey from origin to destination. */
export interface RouteOption {
  id: string;
  /** Human label shown on the card, e.g. "Cheapest route". */
  label: string;
  /** Which priorities this option satisfies — one option can satisfy several. */
  tags: RoutePriority[];
  legs: Leg[];
  transfers: Transfer[];
  totalFareZar: number;
  /**
   * Cash the commuter should actually carry. Usually higher than totalFareZar
   * because change is scarce and fares are rounded up to the nearest note/coin.
   */
  cashNeededZar: number;
  totalMinutes: number;
  totalDistanceKm: number;
  transferCount: number;
}

/** Per-leg fare lines, so the user sees exactly what they are paying for. */
export interface FareLineItem {
  legId: string;
  mode: TransportMode;
  fromName: string;
  toName: string;
  fareZar: number;
}

export interface FareBreakdown {
  lineItems: FareLineItem[];
  totalFareZar: number;
  cashNeededZar: number;
  /** Practical warnings, e.g. "Operators rarely have change before 06:00." */
  notes?: string[];
}

/** An endpoint of a journey: either a known rank or a free-text/geo location. */
export interface JourneyEndpoint {
  label: string;
  rankId?: string;
  location?: GeoPoint;
}

/**
 * @deprecated Superseded by {@link PlanJourneyRequest}. The journey-map screen
 * posts { fromRankId, toRankId, priority? } to /routes/plan; the multi-option
 * shape below is not served by the API today.
 */
export interface PlanRouteRequest {
  origin: JourneyEndpoint;
  destination: JourneyEndpoint;
  /** ISO-8601 departure time. Drives time-of-day reliability weighting. */
  departAt?: string;
  /** Which options to return. Defaults to all four. */
  priorities?: RoutePriority[];
}

/**
 * @deprecated Superseded by {@link PlanJourneyResponse} — not served by the
 * API today.
 */
export interface PlanRouteResponse {
  planId: string;
  originLabel: string;
  destinationLabel: string;
  options: RouteOption[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Journey-map API contract (GET /ranks, POST /routes/plan).
//
// These are the exact wire shapes the mobile journey-map screen is built
// against. The short field names (rankId/lat/lng) deliberately differ from the
// fuller domain model above — rename only in agreement with the mobile team.
// ---------------------------------------------------------------------------

/** One rank as returned by GET /ranks (search field + autocomplete list). */
export interface RankSearchResult {
  rankId: string;
  name: string;
  lat: number;
  lng: number;
}

/** Wire-format geographic point used in journey-map payloads. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Priorities the planner supports today; other modes are future work. */
export type PlanPriority = 'cheapest' | 'fastest' | 'fewest_transfers';

/** Request body for POST /routes/plan. */
export interface PlanJourneyRequest {
  fromRankId: string;
  toRankId: string;
  /** Defaults to "cheapest" when omitted. */
  priority?: PlanPriority;
}

/** One ordered leg of a planned journey. */
export interface PlannedJourneyLeg {
  fromRankId: string;
  fromName: string;
  toRankId: string;
  toName: string;
  /** The leg's geometry, for drawing the map line. */
  path: LatLng[];
  fareZar: number;
}

/** Response body for POST /routes/plan (200 OK; a 404 carries { error, message }). */
export interface PlanJourneyResponse {
  legs: PlannedJourneyLeg[];
  totalFareZar: number;
  legCount: number;
}

/** A taxi association: the operator behind one or more taxi routes. */
export interface TaxiAssociation {
  id: string;
  name: string;
}

/** Distance band of a taxi route, from the route survey. */
export type TaxiRouteCategory = 'short' | 'medium' | 'long';

/**
 * A taxi route as a marshal manages it: a named service between two ranks,
 * operated by one association. Each route carries two directed legs ("out" and
 * "return") because fares and travel times differ by direction. Blocking a
 * route (strike) disables both legs at once.
 */
export interface TaxiRoute {
  id: string;
  /** Human label, e.g. "Marabastad ↔ Marble Hall". */
  label: string;
  associationId?: string;
  category: TaxiRouteCategory;
  mode: TransportMode;
  /** Seats per vehicle: 9 = minibus, 15 = quantum/sprinter. */
  seats?: number;
  /** Strike toggle. Blocked routes are excluded from journey planning. */
  isBlocked: boolean;
  blockedReason?: string;
  blockedAt?: string;
  /** Provenance, e.g. "CSIR taxi route survey (route_id CR0008, 2018-12-07)". */
  sourceNote?: string;
}

/** One demand event: a commuter (or marshal) signalling they want to travel. */
export interface DemandSignal {
  id: string;
  /** Route the demand is for, when the commuter picked one. */
  routeId?: string;
  /** Rank the demand was raised at, when no specific route was picked. */
  rankId?: string;
  direction?: 'out' | 'return';
  passengers: number;
  signalAt: string;
  /** Where the signal came from: 'commuter_app', 'marshal', 'demo_seed'. */
  source: string;
}

/** Aggregated demand for one route over a time window, for the demand display. */
export interface DemandSummaryEntry {
  routeId: string;
  label: string;
  associationName?: string;
  isBlocked: boolean;
  signals: number;
  passengers: number;
}

/** Shape returned by GET /demand. */
export interface DemandSummaryResponse {
  windowHours: number;
  generatedAt: string;
  entries: DemandSummaryEntry[];
}

/** Shape returned by GET /health on the API. */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  dataSource: 'supabase' | 'fixtures';
}
