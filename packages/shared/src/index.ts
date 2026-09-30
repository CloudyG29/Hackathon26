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

/**
 * One leg of a planner-produced journey — the wire format the routing engine
 * and the API's planner emit for the options of POST /routes/plan. Unlike
 * `Leg` (catalogue shape), a planned leg is already resolved: geometry, fare
 * and (when known) per-leg duration and mode.
 */
export interface PlanLeg {
  fromRankId: string;
  toRankId: string;
  /** Fare in rand, including the planner's imputed value for unknown fares. */
  fareZar: number;
  /** Traversal minutes. Present only when the source duration is known. */
  minutes?: number;
  mode?: TransportMode;
  /** Road-following geometry when the DB has a path, straight line otherwise. */
  path?: GeoPoint[];
}

/**
 * One leg of a planner-produced journey — the wire format the routing engine
 * and the API's planner emit for the options of POST /routes/plan. Unlike
 * `Leg` (catalogue shape), a planned leg is already resolved: geometry, fare
 * and (when known) per-leg duration and mode.
 */
export interface PlanLeg {
  fromRankId: string;
  toRankId: string;
  /** Fare in rand, including the planner's imputed value for unknown fares. */
  fareZar: number;
  /** Traversal minutes. Present only when the source duration is known. */
  minutes?: number;
  mode?: TransportMode;
  /** Road-following geometry when the DB has a path, straight line otherwise. */
  path?: GeoPoint[];
}

/** An endpoint of a journey: either a known rank or a free-text/geo location. */
export interface JourneyEndpoint {
  label: string;
  rankId?: string;
  location?: GeoPoint;
}

export interface PlanRouteRequest {
  origin: JourneyEndpoint;
  destination: JourneyEndpoint;
  /** ISO-8601 departure time. Drives time-of-day reliability weighting. */
  departAt?: string;
  /** Which options to return. Defaults to all four. */
  priorities?: RoutePriority[];
}

export interface PlanRouteResponse {
  planId: string;
  originLabel: string;
  destinationLabel: string;
  options: RouteOption[];
  generatedAt: string;
}

/** Shape returned by GET /health on the API. */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  dataSource: 'supabase' | 'fixtures';
}
