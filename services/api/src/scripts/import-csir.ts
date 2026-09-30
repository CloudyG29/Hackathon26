/**
 * Imports real Tshwane taxi data from the CSIR public ArcGIS server into the
 * seed files in data/seed/, and optionally pushes it to Supabase.
 *
 * Sources (both query-only, no auth):
 *   - Tshwane Taxi Routes: 661 surveyed tracks, Dec 2018. Each track is one
 *     directed run of a route (route_id + routeleg 1/2 = out/return) with the
 *     association, surveyed fare (+ alternates), distance, and geometry.
 *   - TaxiFacilities: 105 surveyed taxi ranks, 2021. Names, coordinates,
 *     formality, facilities, queue marshals, associations served.
 *
 * What it produces:
 *   data/seed/associations.json  - taxi associations (assoc_id + name)
 *   data/seed/ranks.json         - ranks from the facility survey, plus ranks
 *                                  derived from route endpoints that did not
 *                                  match a surveyed facility
 *   data/seed/routes.json        - one taxi route per surveyed origin/
 *                                  destination pair (the marshal-managed
 *                                  entity, strike toggle lives here). A survey
 *                                  route_id that lumps several services is
 *                                  split into one route per pair.
 *   data/seed/legs.json          - two directed legs per route (out/return)
 *   data/seed/fare-snapshots.json- every distinct surveyed fare, incl. alts
 *   data/seed/demand-demo.json   - synthetic demand signals for the demo (the
 *                                  real thing has no users yet)
 *   data/seed/import-report.json - counts and data-quality issues
 *
 * Usage (from the repo root):
 *   npm run import:csir --workspace @hackathon26/api
 *   npm run import:csir --workspace @hackathon26/api -- --push   # also upsert to Supabase
 *
 * Fares are the 2018 surveyed baseline. Marshals correct them through the
 * admin tool; their edits should become new fare_snapshots, not edits of these
 * files. Generated files carry provenance notes - do not hand-edit them.
 *
 * Two data repairs run during import (see the "repairs" block of the report):
 * leg path endpoints are pinned to their rank anchors so drawn lines reach the
 * map pins, and legs the survey left without a fare are imputed from the
 * median fare per km of their category (a R0 leg would otherwise dominate
 * both priority rankings in the planner).
 */
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  DemandSignal,
  GeoPoint,
  Leg,
  Rank,
  TaxiAssociation,
  TaxiRoute,
  TaxiRouteCategory,
  TransportMode,
} from '@hackathon26/shared';
import { config, hasSupabaseCredentials } from '../config';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROUTES_LAYER_URL =
  'https://pta-gis-2-web1.csir.co.za/server2/rest/services/Hosted/Tshwane_Taxi_Routes_shp/FeatureServer/0/query';

const FACILITIES_LAYER_URL =
  'https://pta-gis-2-web1.csir.co.za/server2/rest/services/Hosted/TaxiFacilities/FeatureServer/0/query';

const FARE_SOURCE = 'csir_taxi_survey';
const DEMAND_SOURCE = 'demo_seed';

/** Facility "Yes" flags that map to the shared Rank.facilities vocabulary. */
const AMENITY_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['abluavaila', 'toilets'],
  ['actbankatm', 'ATM'],
  ['actgrocery', 'grocery store'],
  ['actmedical', 'clinic'],
  ['actpostoff', 'post office'],
  ['actpolices', 'police post'],
  ['smallbusin', 'spaza shops'],
  ['security', 'security'],
  ['benchesava', 'benches'],
  ['lightsinsi', 'lighting'],
  ['signagevis', 'signage'],
];

/** Known typos in the survey data, fixed for display and matching. */
const NAME_FIXES: ReadonlyArray<readonly [RegExp, string]> = [
  [/atteridgevielle/gi, 'atteridgeville'],
  [/\btreet\b/gi, 'street'],
  [/krugerdorp/gi, 'krugersdorp'],
  [/mussina/gi, 'musina'],
  [/bzaar/gi, 'bazaar'],
];

/** Route endpoints match a surveyed facility if they land within this radius. */
const FACILITY_MATCH_RADIUS_M = 200;

/** Endpoints this close to a previously derived rank are the same place. */
const DERIVED_CLUSTER_RADIUS_M = 300;

/** A name match on a derived rank is only trusted within this distance. */
const DERIVED_NAME_MATCH_RADIUS_M = 2000;

/** Legs whose rank anchor sits farther than this from the path are flagged. */
const RANK_PLACEMENT_WARN_RADIUS_M = 2000;

/** Rank anchors closer than this to a path end are treated as already joined. */
const PATH_PIN_SNAP_MIN_GAP_M = 10;

/** Affinity scores for pairing survey endpoint labels with track endpoints
 *  (lower = better agreement between a name and a location). Survey tracks
 *  are sometimes digitised against their labels, so the two labels of a track
 *  are paired with its two endpoints by these scores, not by path position. */
const AFFINITY_SPATIAL_ONLY = 3000;
const AFFINITY_UNKNOWN = 4000;
const AFFINITY_NAME_ELSEWHERE = 5000;

/** Cap on points kept per leg path so seed files stay lean. */
const MAX_PATH_POINTS = 220;

/** Assumed average speed per mode, for estimated_minutes (no times in source). */
const SPEED_KMH: Record<string, number> = {
  long_distance_taxi: 65,
  mini_bus_taxi: 28,
};

const args = process.argv.slice(2);
const flags = {
  push: args.includes('--push'),
  withDemand: !args.includes('--no-demand'),
  outDir: args
    .find((a) => a.startsWith('--out='))
    ?.slice('--out='.length)
    ?.trim(),
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const outDir = flags.outDir ? path.resolve(flags.outDir) : path.join(repoRoot, 'data', 'seed');

// ---------------------------------------------------------------------------
// ArcGIS REST access
// ---------------------------------------------------------------------------

type Attrs = Record<string, any>;

interface EsriFeature {
  attributes: Attrs;
  geometry?: { paths?: number[][][]; x?: number; y?: number };
}

async function fetchAllFeatures(queryUrl: string): Promise<EsriFeature[]> {
  const features: EsriFeature[] = [];
  let offset = 0;

  for (;;) {
    const url =
      `${queryUrl}?where=1%3D1&outFields=*&returnGeometry=true` +
      `&resultOffset=${offset}&resultRecordCount=1000&f=json`;
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) {
      throw new Error(`CSIR server responded ${response.status} for ${queryUrl}`);
    }
    const body = (await response.json()) as {
      features?: EsriFeature[];
      exceededTransferLimit?: boolean;
      error?: { message?: string };
    };
    if (body.error) {
      throw new Error(`CSIR query error: ${body.error.message ?? 'unknown'}`);
    }

    const page = body.features ?? [];
    features.push(...page);
    if (!body.exceededTransferLimit || page.length === 0) break;
    offset += page.length;
  }

  return features;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Trimmed string, or undefined for null/" "/"null"/empty values. */
function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.trim().replace(/\s+/g, ' ');
  return s === '' || s.toLowerCase() === 'null' ? undefined : s;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function roundTo(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function titleCaseWords(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Display name: typo fixes, plus title-casing of ALL-CAPS survey names. */
function fixDisplayName(raw: unknown): string {
  let s = str(raw) ?? '';
  for (const [pattern, replacement] of NAME_FIXES) s = s.replace(pattern, replacement);
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length > 0 && letters === letters.toUpperCase()) s = titleCaseWords(s);
  return s;
}

/** Matching key: lowercase, typo-fixed, generic words and punctuation removed. */
function normalizeName(raw: unknown): string {
  let s = (str(raw) ?? '').toLowerCase();
  for (const [pattern, replacement] of NAME_FIXES) s = s.replace(pattern, replacement);
  s = s.replace(/\b(taxi|rank|station|terminal|st)\b/g, ' ');
  return s.replace(/[^a-z0-9]/g, '');
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'x';
}

// ---------------------------------------------------------------------------
// Geometry helpers (source layers are Web Mercator / EPSG:3857)
// ---------------------------------------------------------------------------

function mercatorToGeo(x: number, y: number): GeoPoint {
  const longitude = (x / 20037508.34) * 180;
  const latitude =
    (2 * Math.atan(Math.exp((y / 20037508.34) * Math.PI)) - Math.PI / 2) * (180 / Math.PI);
  return { latitude: roundTo(latitude, 7), longitude: roundTo(longitude, 7) };
}

function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Thin out polyline points to roughly MAX_PATH_POINTS, keeping ends exact. */
function decimateMercatorPath(points: number[][]): number[][] {
  if (points.length <= 2) return points;

  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    total += Math.hypot(cur[0]! - prev[0]!, cur[1]! - prev[1]!);
  }
  const spacing = Math.max(25, total / (MAX_PATH_POINTS - 1));

  const kept: number[][] = [points[0]!];
  let accumulated = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    accumulated += Math.hypot(cur[0]! - prev[0]!, cur[1]! - prev[1]!);
    if (accumulated >= spacing) {
      kept.push(cur);
      accumulated = 0;
    }
  }
  kept.push(points[points.length - 1]!);
  return kept;
}

/** Longest sub-path of the track, converted to WGS84 GeoPoints. */
function trackPath(feature: EsriFeature, routeId: string, multiPath: string[]): GeoPoint[] | undefined {
  const paths = feature.geometry?.paths;
  if (!paths || paths.length === 0) return undefined;
  if (paths.length > 1) multiPath.push(routeId);
  const longest = paths.reduce((best, p) => (p.length > best.length ? p : best));
  if (longest.length < 2) return undefined;
  return decimateMercatorPath(longest).map(([x, y]) => mercatorToGeo(x!, y!));
}

/** Deterministic RNG so reruns produce the same demo signal structure. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

interface FareSnapshot {
  legId: string;
  fareZar: number;
  observedAt: string;
  source: string;
}

const issues = {
  zeroFareLegs: [] as string[],
  routesMissingDirection: [] as string[],
  splitRouteGroups: [] as string[],
  selfLoopLegs: [] as string[],
  routesWithoutLegs: [] as string[],
  mergedFacilityNames: [] as string[],
  multiPathTracks: [] as string[],
  assocIdCollisions: [] as string[],
  facilitiesWithoutLocation: [] as string[],
};

async function main(): Promise<void> {
  console.log('Fetching Tshwane taxi data from the CSIR ArcGIS server...');
  const routeFeatures = (await fetchAllFeatures(ROUTES_LAYER_URL)).sort(
    (a, b) => (num(a.attributes.fid) ?? 0) - (num(b.attributes.fid) ?? 0),
  );
  const facilityFeatures = (await fetchAllFeatures(FACILITIES_LAYER_URL)).sort(
    (a, b) => (num(a.attributes.fid) ?? 0) - (num(b.attributes.fid) ?? 0),
  );
  console.log(`  ${routeFeatures.length} route tracks, ${facilityFeatures.length} taxi facilities`);

  // --- Associations -------------------------------------------------------
  const associations = new Map<string, TaxiAssociation>();
  const assocIdByNormName = new Map<string, string>();

  function registerAssociation(rawName: unknown, numericId: unknown): string | undefined {
    const name = (str(rawName) ?? '').replace(/\.$/, '');
    if (!name) return undefined;
    const norm = normalizeName(name);
    const byName = assocIdByNormName.get(norm);
    if (byName) return byName;

    let id = num(numericId) !== undefined ? `assoc-${numericId}` : `assoc-${slug(name)}`;
    const taken = associations.get(id);
    if (taken && taken.name !== name) {
      // Same assoc_id under two names in the survey: keep both, second gets a
      // slug id so neither silently overwrites the other.
      issues.assocIdCollisions.push(`${id}: "${taken.name}" vs "${name}"`);
      id = `assoc-${slug(name)}`;
      if (associations.has(id)) return associations.get(id)!.id;
    }
    associations.set(id, { id, name });
    assocIdByNormName.set(norm, id);
    return id;
  }

  // --- Ranks from the facility survey -------------------------------------
  const ranks = new Map<string, Rank>();
  const rankIdByNormName = new Map<string, string>();
  const facilityPoints: Array<{ rankId: string; point: GeoPoint }> = [];
  const facilityRankIds = new Set<string>();

  function facilityLocation(attrs: Attrs, geometry: EsriFeature['geometry']): GeoPoint | undefined {
    const text = str(attrs.cordinates) ?? `${str(attrs.fxcoordy) ?? ''}, ${str(attrs.fxcoordx) ?? ''}`;
    const match = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(text);
    if (match) {
      const latitude = Number(match[1]);
      const longitude = Number(match[2]);
      if (latitude < -20 && latitude > -35 && longitude > 14 && longitude < 36) {
        return { latitude: roundTo(latitude, 7), longitude: roundTo(longitude, 7) };
      }
    }
    if (num(geometry?.x) !== undefined && num(geometry?.y) !== undefined) {
      return mercatorToGeo(geometry!.x!, geometry!.y!);
    }
    return undefined;
  }

  for (const facility of facilityFeatures) {
    const attrs = facility.attributes;
    const rawName = str(attrs.fxfaciname);
    if (!rawName) continue;

    const norm = normalizeName(rawName);
    if (norm && rankIdByNormName.has(norm)) {
      issues.mergedFacilityNames.push(rawName);
      continue;
    }

    const location = facilityLocation(attrs, facility.geometry);
    if (!location) {
      issues.facilitiesWithoutLocation.push(rawName);
      continue;
    }

    const kind = str(attrs.typefacili)?.toLowerCase() === 'formal' ? 'formal' : 'informal';
    const fid = num(attrs.fid)!;
    const rankId = `rank-f${fid}`;

    const facilities = AMENITY_FIELDS.filter(([field]) => attrs[field] === 'Yes').map(
      ([, label]) => label,
    );

    const noteBits: string[] = [];
    const place = fixDisplayName(attrs.surburb || attrs.town);
    noteBits.push(`${kind === 'formal' ? 'Formal rank' : 'Informal loading point'}${place ? ` in ${place}` : ''}.`);
    if (num(attrs.numquemars)) noteBits.push(`${num(attrs.numquemars)} queue marshals on duty.`);
    if (num(attrs.numbaysloa)) noteBits.push(`${num(attrs.numbaysloa)} loading bays.`);
    if (num(attrs.numbayshol)) noteBits.push(`${num(attrs.numbayshol)} holding bays.`);
    if (str(attrs.ownerrank)) noteBits.push(`Operated by: ${str(attrs.ownerrank)}.`);
    if (str(attrs.maintainsr)) noteBits.push(`Maintained by: ${str(attrs.maintainsr)}.`);
    if (str(attrs.structurer)) {
      noteBits.push(`Structure: ${str(attrs.structurer)}${str(attrs.roofcondit) ? `, ${str(attrs.roofcondit)!.toLowerCase()} condition` : ''}.`);
    }
    if (str(attrs.usetransfe)?.toLowerCase() === 'yes') {
      noteBits.push('Used as a transfer point between routes.');
    }
    if (str(attrs.streetaddr)) noteBits.push(`Address: ${str(attrs.streetaddr)}.`);

    const areaBits = [fixDisplayName(attrs.surburb), fixDisplayName(attrs.town)]
      .filter((v, i, arr): v is string => Boolean(v) && arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);

    const rank: Rank = {
      id: rankId,
      name: fixDisplayName(rawName),
      area: areaBits.join(', ') || undefined,
      location,
      modes: ['mini_bus_taxi'],
      kind,
      facilities: facilities.length > 0 ? facilities : undefined,
      landmarkNotes: noteBits.join(' '),
    };
    ranks.set(rankId, rank);
    if (norm) rankIdByNormName.set(norm, rankId);
    facilityPoints.push({ rankId, point: location });
    facilityRankIds.add(rankId);
  }

  // Centroid of the surveyed facilities: anchor for deciding which end of a
  // long-distance track is the Tshwane side.
  const facilityCentroid: GeoPoint | undefined =
    facilityPoints.length > 0
      ? {
          latitude: facilityPoints.reduce((sum, f) => sum + f.point.latitude, 0) / facilityPoints.length,
          longitude: facilityPoints.reduce((sum, f) => sum + f.point.longitude, 0) / facilityPoints.length,
        }
      : undefined;

  // --- Route endpoint -> rank resolution ----------------------------------
  let unnamedCounter = 0;

  function unionMode(rankId: string, mode: TransportMode): void {
    const rank = ranks.get(rankId);
    if (rank && !rank.modes.includes(mode)) rank.modes.push(mode);
  }

  /** Nearest candidate rank within radius, or undefined. */
  function nearestWithin(
    candidates: Array<{ rankId: string; point: GeoPoint }>,
    point: GeoPoint,
    radius: number,
  ): string | undefined {
    let best: { rankId: string; distance: number } | undefined;
    for (const candidate of candidates) {
      const distance = haversineMeters(candidate.point, point);
      if (distance <= radius && (!best || distance < best.distance)) {
        best = { rankId: candidate.rankId, distance };
      }
    }
    return best?.rankId;
  }

  // Ranks derived from route endpoints, for clustering later endpoints onto
  // the same physical loading point.
  const derivedPoints: Array<{ rankId: string; point: GeoPoint }> = [];

  /**
   * Resolves a surveyed track endpoint to a rank id.
   *
   * Order matters: surveyed facility coordinates are ground truth, so a
   * spatial snap wins over names (survey name labels are inconsistent - one
   * mislabelled track must not drag a rank name to the wrong end of the
   * province). A name match is only trusted for surveyed facilities, or for
   * derived ranks whose stored location agrees with this endpoint.
   *
   * farFromCity marks the far end of a long-distance route. Surveyed tracks
   * stop inside the study area, so that endpoint is a town node whose
   * identity is its name - it is never clustered spatially, because tracks
   * to different towns can end at the same boundary point.
   */
  function resolveRank(options: {
    name: string | undefined;
    point: GeoPoint;
    type: string | undefined;
    place: string | undefined;
    municipality: string | undefined;
    boardingPoint: string | undefined;
    mode: TransportMode;
    farFromCity?: boolean;
  }): string {
    const norm = normalizeName(options.name);
    const byName = norm ? rankIdByNormName.get(norm) : undefined;

    if (options.farFromCity) {
      if (byName) {
        unionMode(byName, options.mode);
        return byName;
      }
      return deriveRank(options, true);
    }

    // 1. Exact name match against a surveyed facility. Facility points are
    //    surveyed directly, so the name wins even when the track geometry
    //    only covers part of the route.
    if (byName && facilityRankIds.has(byName)) {
      unionMode(byName, options.mode);
      return byName;
    }

    // 2. Nearest surveyed facility within the matching radius.
    const facilityHit = nearestWithin(facilityPoints, options.point, FACILITY_MATCH_RADIUS_M);
    if (facilityHit) {
      unionMode(facilityHit, options.mode);
      return facilityHit;
    }

    // 3. A previously derived rank within the cluster radius: the same
    //    physical loading point, surveyed under a different name.
    const derivedHit = nearestWithin(derivedPoints, options.point, DERIVED_CLUSTER_RADIUS_M);
    if (derivedHit) {
      unionMode(derivedHit, options.mode);
      return derivedHit;
    }

    // 4. Name match against a derived rank, accepted only when the stored
    //    location is close enough to this endpoint to be the same place.
    if (byName) {
      const rank = ranks.get(byName);
      if (rank && haversineMeters(rank.location, options.point) <= DERIVED_NAME_MATCH_RADIUS_M) {
        unionMode(byName, options.mode);
        return byName;
      }
    }

    return deriveRank(options, false);
  }

  /** Creates a new rank at a track endpoint and returns its id. */
  function deriveRank(
    options: {
      name: string | undefined;
      point: GeoPoint;
      type: string | undefined;
      place: string | undefined;
      municipality: string | undefined;
      boardingPoint: string | undefined;
      mode: TransportMode;
    },
    isTownDestination: boolean,
  ): string {
    const displayName = options.name
      ? fixDisplayName(options.name)
      : `Unnamed boarding point ${++unnamedCounter}`;
    let rankId = `rank-${slug(displayName)}`;
    let suffix = 2;
    while (ranks.has(rankId)) rankId = `rank-${slug(displayName)}-${suffix++}`;

    const areaBits = [fixDisplayName(options.place), fixDisplayName(options.municipality)]
      .filter((v, i, arr): v is string => Boolean(v) && arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);

    ranks.set(rankId, {
      id: rankId,
      name: displayName,
      area: areaBits.join(', ') || 'City of Tshwane',
      location: options.point,
      modes: [options.mode],
      kind: options.type?.toLowerCase() === 'formal' ? 'formal' : 'informal',
      landmarkNotes: isTownDestination
        ? `${options.type ?? 'Town'} destination - the surveyed track ends inside the Tshwane study area, so this location is approximate.`
        : `${options.type ?? 'Loading point'} boarding point` +
          `${options.boardingPoint ? `: ${options.boardingPoint}` : ''}.`,
    });
    if (!isTownDestination) {
      derivedPoints.push({ rankId, point: options.point });
    }
    // Register the name only when it is still free: a second, genuinely
    // different place sharing the name must not hijack the mapping.
    const norm = normalizeName(options.name);
    if (norm && !rankIdByNormName.has(norm)) rankIdByNormName.set(norm, rankId);
    return rankId;
  }

  // --- Routes and legs ----------------------------------------------------
  const groups = new Map<string, EsriFeature[]>();
  for (const feature of routeFeatures) {
    const routeId = str(feature.attributes.route_id) ?? `x${feature.attributes.fid}`;
    const bucket = groups.get(routeId);
    if (bucket) bucket.push(feature);
    else groups.set(routeId, [feature]);
  }

  function mapCategory(raw: unknown): TaxiRouteCategory {
    const c = (str(raw) ?? '').toLowerCase();
    if (c.startsWith('short')) return 'short';
    if (c.startsWith('medium')) return 'medium';
    if (c.startsWith('long')) return 'long';
    return 'short';
  }

  function pickCanonical(features: EsriFeature[]): EsriFeature | undefined {
    let best: EsriFeature | undefined;
    let bestLength = -1;
    for (const feature of features) {
      const length =
        num(feature.attributes['SHAPE__Length']) ?? (num(feature.attributes.routelengt) ?? 0) * 1000;
      if (length > bestLength) {
        best = feature;
        bestLength = length;
      }
    }
    return best;
  }

  const routes = new Map<string, TaxiRoute>();
  const legs: Leg[] = [];
  const fareSnapshots: FareSnapshot[] = [];

  /**
   * How well a survey endpoint label agrees with a physical point (lower is
   * better). A name whose known rank sits near the point scores the distance;
   * a name that points somewhere else scores a fixed penalty (the magnitude
   * would be noise); a point that snaps to a surveyed facility without a name
   * match is neutral; anything else is unknown.
   */
  function labelAffinity(rawName: unknown, point: GeoPoint): number {
    const norm = normalizeName(rawName);
    const byName = norm ? rankIdByNormName.get(norm) : undefined;
    const rank = byName ? ranks.get(byName) : undefined;
    if (rank) {
      const distance = haversineMeters(rank.location, point);
      if (distance <= DERIVED_NAME_MATCH_RADIUS_M) return distance;
      return AFFINITY_NAME_ELSEWHERE;
    }
    return nearestWithin(facilityPoints, point, FACILITY_MATCH_RADIUS_M) !== undefined
      ? AFFINITY_SPATIAL_ONLY
      : AFFINITY_UNKNOWN;
  }

  /** The origin-side or dest-side label set of a track. */
  interface EndpointInfo {
    name: string | undefined;
    type: string | undefined;
    place: string | undefined;
    municipality: string | undefined;
    boardingPoint: string | undefined;
  }

  function endpointInfo(attrs: Attrs, side: 'origin' | 'dest'): EndpointInfo {
    return side === 'origin'
      ? {
          name: str(attrs.originname),
          type: str(attrs.origintype),
          place: str(attrs.spo_mp_nm),
          municipality: str(attrs.originmuni),
          boardingPoint: str(attrs.originpnt),
        }
      : {
          name: str(attrs.destname),
          type: str(attrs.desttype),
          place: str(attrs.spd_mp_nm),
          municipality: str(attrs.destmuni),
          boardingPoint: str(attrs.destpnt),
        };
  }

  for (const [surveyRouteId, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // A survey route_id sometimes lumps several distinct services together
    // (different destinations under one id). Bucket the tracks by unordered
    // origin/destination pair so each service becomes its own route.
    const pairBuckets = new Map<string, EsriFeature[]>();
    for (const feature of group) {
      const originNorm = normalizeName(feature.attributes.originname);
      const destNorm = normalizeName(feature.attributes.destname);
      const key =
        originNorm && destNorm
          ? [originNorm, destNorm].sort().join('|')
          : `x${num(feature.attributes.fid) ?? 'unnamed'}`;
      const bucket = pairBuckets.get(key);
      if (bucket) bucket.push(feature);
      else pairBuckets.set(key, [feature]);
    }

    const pairLength = (tracks: EsriFeature[]): number =>
      tracks.reduce(
        (sum, f) =>
          sum + (num(f.attributes['SHAPE__Length']) ?? (num(f.attributes.routelengt) ?? 0) * 1000),
        0,
      );
    const orderedPairs = [...pairBuckets.entries()].sort(
      ([keyA, tracksA], [keyB, tracksB]) =>
        tracksB.length - tracksA.length ||
        pairLength(tracksB) - pairLength(tracksA) ||
        keyA.localeCompare(keyB),
    );

    for (let pairIndex = 0; pairIndex < orderedPairs.length; pairIndex++) {
      const [pairKey, pairTracks] = orderedPairs[pairIndex]!;
      const routeKey =
        pairIndex === 0
          ? surveyRouteId.toLowerCase()
          : `${surveyRouteId.toLowerCase()}-${pairIndex + 1}`;
      const routeId = `rt-${routeKey}`;
      if (pairIndex > 0) issues.splitRouteGroups.push(`${surveyRouteId} -> ${routeId}`);

      // "out" is the majority label direction (surveyed out legs break ties):
      // origin/dest names are per-track, and the geometry direction is not
      // reliable, so the labels decide which way is out.
      const splitKey = pairKey.split('|');
      const aNorm = splitKey[0];
      const bNorm = splitKey[1];
      const trackDirection = (feature: EsriFeature): 'ab' | 'ba' => {
        if (!aNorm || !bNorm || aNorm === bNorm) {
          return num(feature.attributes.routeleg) === 2 ? 'ba' : 'ab';
        }
        return normalizeName(feature.attributes.originname) === bNorm ? 'ba' : 'ab';
      };
      const abTracks = pairTracks.filter((f) => trackDirection(f) === 'ab');
      const baTracks = pairTracks.filter((f) => trackDirection(f) === 'ba');
      const directionScore = (tracks: EsriFeature[]): number =>
        tracks.length * 100 + tracks.filter((f) => num(f.attributes.routeleg) !== 2).length;
      const outIsAb = directionScore(abTracks) >= directionScore(baTracks);
      const outTracks = outIsAb ? abTracks : baTracks;
      const returnTracks = outIsAb ? baTracks : abTracks;

      const canonicalOut = pickCanonical(outTracks);
      const canonicalReturn = pickCanonical(returnTracks);
      if (!canonicalOut) issues.routesMissingDirection.push(`${routeId} (out)`);
      if (!canonicalReturn) issues.routesMissingDirection.push(`${routeId} (return)`);

      const labelSource = canonicalOut ?? canonicalReturn!;
      const outAttrs = labelSource.attributes;

      const category = mapCategory(outAttrs.category);
      const mode: TransportMode = category === 'long' ? 'long_distance_taxi' : 'mini_bus_taxi';
      const associationId = registerAssociation(outAttrs.assocname, outAttrs.assoc_id);
      const surveyDate = num(outAttrs.surveydate);
      const surveyDay = surveyDate !== undefined ? new Date(surveyDate).toISOString().slice(0, 10) : undefined;

      const pairLegs: Leg[] = [];
      for (const direction of ['out', 'return'] as const) {
        const canonical = direction === 'out' ? canonicalOut : canonicalReturn;
        const directionFeatures = direction === 'out' ? outTracks : returnTracks;
        if (!canonical) continue;

        const attrs = canonical.attributes;
        const pathPoints = trackPath(canonical, routeKey, issues.multiPathTracks);
        if (!pathPoints || pathPoints.length < 2) continue; // no usable geometry

        const first = pathPoints[0]!;
        const last = pathPoints[pathPoints.length - 1]!;
        const origin = endpointInfo(attrs, 'origin');
        const dest = endpointInfo(attrs, 'dest');

        let fromRankId: string;
        let toRankId: string;
        let legPath: GeoPoint[] = pathPoints;

        // Long-distance surveyed tracks are partial and can be digitised in
        // either direction, so pair this track's own labels with the physical
        // endpoints by distance from the facility centroid: the near end is
        // the Tshwane boarding rank, the far end a town node resolved by name
        // only. Which label belongs to the near end is decided by affinity,
        // because the track's label direction need not match its geometry.
        const useNearFar =
          category === 'long' &&
          facilityCentroid !== undefined &&
          Math.min(
            haversineMeters(facilityCentroid, first),
            haversineMeters(facilityCentroid, last),
          ) <= 50000;

        if (useNearFar) {
          const startsNear =
            haversineMeters(facilityCentroid!, first) <= haversineMeters(facilityCentroid!, last);
          const nearPoint = startsNear ? first : last;
          const farPoint = startsNear ? last : first;
          const originNear =
            labelAffinity(origin.name, nearPoint) <= labelAffinity(dest.name, nearPoint);
          const nearInfo = originNear ? origin : dest;
          const farInfo = originNear ? dest : origin;
          const nearRankId = resolveRank({ ...nearInfo, point: nearPoint, mode });
          const farRankId = resolveRank({ ...farInfo, point: farPoint, mode, farFromCity: true });

          if (direction === 'out') {
            fromRankId = nearRankId;
            toRankId = farRankId;
            if (!startsNear) legPath = [...pathPoints].reverse();
          } else {
            fromRankId = farRankId;
            toRankId = nearRankId;
            if (startsNear) legPath = [...pathPoints].reverse();
          }
        } else {
          // Short/medium tracks: decide whether the geometry runs with or
          // against the labels by how well each label fits each endpoint.
          const forwardScore =
            labelAffinity(origin.name, first) + labelAffinity(dest.name, last);
          const reverseScore =
            labelAffinity(origin.name, last) + labelAffinity(dest.name, first);
          const reversed = reverseScore < forwardScore;
          const fromPoint = reversed ? last : first;
          const toPoint = reversed ? first : last;
          if (reversed) legPath = [...pathPoints].reverse();
          fromRankId = resolveRank({ ...origin, point: fromPoint, mode });
          toRankId = resolveRank({ ...dest, point: toPoint, mode });
        }

        const legId = `leg-${routeKey}-${direction}`;
        if (fromRankId === toRankId) {
          // A track that returns to the rank it left (surveyed circular run):
          // useless as a graph edge, so skip it and report it.
          issues.selfLoopLegs.push(legId);
          continue;
        }

        // Fares: the canonical track's fare is current; every distinct surveyed
        // value (including alternates reported on other runs) is a snapshot.
        const distinctFares = [...new Set(
          directionFeatures.flatMap((f) =>
            ['fare', 'alt_fare1', 'alt_fare2', 'alt_fare3', 'alt_fare4']
              .map((key) => num(f.attributes[key]))
              .filter((v): v is number => v !== undefined && v > 0)
              .map((v) => roundTo(v, 2)),
          ),
        )].sort((a, b) => a - b);

        const canonicalFare = num(attrs.fare);
        const fareZar =
          canonicalFare !== undefined && canonicalFare > 0
            ? roundTo(canonicalFare, 2)
            : distinctFares[0] ?? 0;
        if (fareZar === 0) issues.zeroFareLegs.push(legId);

        const km =
          num(attrs.routelengt) ?? roundTo((num(attrs['SHAPE__Length']) ?? 0) / 1000, 2);
        const speed = SPEED_KMH[mode] ?? 28;

        pairLegs.push({
          id: legId,
          mode,
          fromRankId,
          toRankId,
          fareZar,
          estimatedMinutes: Math.max(3, Math.round((km / speed) * 60)),
          distanceKm: roundTo(km, 1),
          reliability: 0.8,
          departsWhenFull: true,
          path: legPath,
          routeId,
          direction,
        });

        const observedAt = surveyDate !== undefined ? new Date(surveyDate).toISOString() : new Date().toISOString();
        for (const fare of distinctFares) {
          fareSnapshots.push({ legId, fareZar: fare, observedAt, source: FARE_SOURCE });
        }
      }

      if (pairLegs.length === 0) {
        issues.routesWithoutLegs.push(routeId);
        continue;
      }
      routes.set(routeId, {
        id: routeId,
        label: `${fixDisplayName(outAttrs.originname)} ↔ ${fixDisplayName(outAttrs.destname)}`,
        associationId,
        category,
        mode,
        seats: num(outAttrs.noofseats),
        isBlocked: false,
        sourceNote: `CSIR taxi route survey (route_id ${surveyRouteId}${surveyDay ? `, surveyed ${surveyDay}` : ''})`,
      });
      legs.push(...pairLegs);
    }
  }

  // Sanity check: every leg's rank anchor should sit near its surveyed track.
  // Facility-anchored warnings are expected (a name match on a surveyed
  // facility intentionally outranks a partial track's endpoint); anything
  // else means a rank landed far from where the vehicle actually goes.
  const rankPlacementWarnings = { facilityAnchored: [] as string[], suspicious: [] as string[] };
  for (const leg of legs) {
    const check = (rankId: string | undefined, point: GeoPoint | undefined, side: string) => {
      const rank = rankId ? ranks.get(rankId) : undefined;
      if (!rank || !point) return;
      if (haversineMeters(rank.location, point) <= RANK_PLACEMENT_WARN_RADIUS_M) return;
      const bucket = facilityRankIds.has(rank.id)
        ? rankPlacementWarnings.facilityAnchored
        : rankPlacementWarnings.suspicious;
      bucket.push(`${leg.id}:${side}`);
    };
    check(leg.fromRankId, leg.path?.[0], 'from');
    check(leg.toRankId, leg.path?.[leg.path.length - 1], 'to');
  }

  // --- Pin drawn lines to their rank anchors -------------------------------
  // The rank anchor is the ground truth (surveyed facility or track end), so
  // drawn lines must start and end there; without this a line stops short of
  // its map pin. The bridge is a straight connector, not surveyed road - the
  // placement check above deliberately runs first so it keeps measuring the
  // surveyed track rather than the bridge it exists to flag.
  let snappedPathEndpoints = 0;
  for (const leg of legs) {
    if (!leg.path || leg.path.length < 2) continue;
    const fromRank = ranks.get(leg.fromRankId);
    const toRank = ranks.get(leg.toRankId);
    if (fromRank && haversineMeters(fromRank.location, leg.path[0]!) > PATH_PIN_SNAP_MIN_GAP_M) {
      leg.path.unshift(fromRank.location);
      snappedPathEndpoints++;
    }
    if (toRank && haversineMeters(toRank.location, leg.path[leg.path.length - 1]!) > PATH_PIN_SNAP_MIN_GAP_M) {
      leg.path.push(toRank.location);
      snappedPathEndpoints++;
    }
  }

  // --- Impute missing fares ------------------------------------------------
  // The survey leaves a few legs with no usable fare. A R0 leg outranks every
  // priced alternative in both "cheapest" and "fastest" ranking, so it must
  // not reach the planner: fill each one from the median fare per km of its
  // category (surveyed legs only), rounded to whole rand. Imputed values are
  // estimates, not fare snapshots - they are listed in the report's repairs.
  const fareRateSamples: Record<TaxiRouteCategory, number[]> = { short: [], medium: [], long: [] };
  for (const leg of legs) {
    const category = leg.routeId ? routes.get(leg.routeId)?.category : undefined;
    if (!category || leg.fareZar <= 0 || !leg.distanceKm) continue;
    fareRateSamples[category].push(leg.fareZar / leg.distanceKm);
  }
  const fareRatePerKm: Partial<Record<TaxiRouteCategory, number>> = {};
  for (const category of ['short', 'medium', 'long'] as const) {
    const samples = fareRateSamples[category];
    if (samples.length > 0) fareRatePerKm[category] = roundTo(median(samples), 2);
  }
  const imputedFareLegs: Array<{ legId: string; fareZar: number }> = [];
  for (const leg of legs) {
    if (leg.fareZar !== 0) continue;
    const category = leg.routeId ? routes.get(leg.routeId)?.category : undefined;
    const rate = category ? fareRatePerKm[category] : undefined;
    if (rate === undefined || !leg.distanceKm) continue;
    leg.fareZar = Math.max(1, Math.round(leg.distanceKm * rate));
    imputedFareLegs.push({ legId: leg.id, fareZar: leg.fareZar });
  }
  // Whatever stays at zero had no imputation rate: keep it flagged.
  const imputedIds = new Set(imputedFareLegs.map((imputed) => imputed.legId));
  issues.zeroFareLegs = issues.zeroFareLegs.filter((legId) => !imputedIds.has(legId));

  // --- Synthetic demo demand ----------------------------------------------
  const demandSignals: DemandSignal[] = [];
  if (flags.withDemand) {
    const rand = mulberry32(20260926);
    const peakHours = new Set([5, 6, 7, 8, 9, 15, 16, 17, 18]);
    const now = Date.now();
    let signalId = 0;

    // Peak hours of the last 48h get 3x the weight. The bucket list depends
    // on the import time, and every signal draws a fixed number of random
    // values, so reruns produce the same signal structure (counts,
    // directions, passenger numbers) with only the timestamps shifting to
    // stay recent.
    const hourBuckets: number[] = [];
    for (let hoursAgo = 0; hoursAgo < 48; hoursAgo++) {
      const hourOfDay = new Date(now - hoursAgo * 3_600_000).getHours();
      const weight = peakHours.has(hourOfDay) ? 3 : 1;
      for (let w = 0; w < weight; w++) hourBuckets.push(hoursAgo);
    }

    const sortedRoutes = [...routes.values()].sort((a, b) => a.id.localeCompare(b.id));
    for (const route of sortedRoutes) {
      const count =
        route.category === 'long'
          ? 8 + Math.floor(rand() * 18)
          : route.category === 'medium'
            ? 6 + Math.floor(rand() * 12)
            : 3 + Math.floor(rand() * 8);

      for (let i = 0; i < count; i++) {
        const direction: 'out' | 'return' = rand() < 0.55 ? 'out' : 'return';
        const leg = legs.find((l) => l.routeId === route.id && l.direction === direction);
        if (!leg) continue;

        const hoursAgo = hourBuckets[Math.floor(rand() * hourBuckets.length)]!;
        const minutesAgo = Math.floor(rand() * 60);
        const signalAt = new Date(now - hoursAgo * 3_600_000 - minutesAgo * 60_000);

        demandSignals.push({
          id: `dsig-${++signalId}`,
          routeId: route.id,
          rankId: direction === 'out' ? leg.fromRankId : leg.toRankId,
          direction,
          passengers: 1 + Math.floor(rand() * 3),
          signalAt: signalAt.toISOString(),
          source: DEMAND_SOURCE,
        });
      }
    }
  }

  // --- Write seed files ---------------------------------------------------
  const sortedRanks = [...ranks.values()].sort((a, b) => a.id.localeCompare(b.id));
  const sortedRoutes = [...routes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const sortedLegs = [...legs].sort((a, b) => a.id.localeCompare(b.id));
  const sortedAssociations = [...associations.values()].sort((a, b) => a.id.localeCompare(b.id));
  fareSnapshots.sort((a, b) => a.legId.localeCompare(b.legId) || a.fareZar - b.fareZar);
  demandSignals.sort((a, b) => a.id.localeCompare(b.id));

  const sourceNote =
    'Real Tshwane taxi data from the CSIR public ArcGIS server: taxi route survey (December 2018) ' +
    'and taxi facility survey (2021). Fares are the 2018 surveyed baseline - marshals correct them ' +
    'through the admin tool, which should record updates as new fare snapshots. ' +
    'Generated by services/api/src/scripts/import-csir.ts - do not edit by hand.';

  await mkdir(outDir, { recursive: true });
  const write = (name: string, data: unknown) =>
    writeFile(path.join(outDir, name), JSON.stringify(data, null, 2) + '\n', 'utf8');

  await write('associations.json', { note: sourceNote, associations: sortedAssociations });
  await write('ranks.json', { note: sourceNote, ranks: sortedRanks });
  await write('routes.json', { note: sourceNote, routes: sortedRoutes });
  await write('legs.json', { note: sourceNote, legs: sortedLegs });
  await write('fare-snapshots.json', { note: sourceNote, snapshots: fareSnapshots });
  await write('demand-demo.json', {
    note:
      'SYNTHETIC demand signals for demo purposes only (source "demo_seed") - there are no real ' +
      'commuters yet. Generated with a fixed seed so reruns produce the same signal structure; ' +
      'timestamps are relative to the import time so they stay inside the demo window.',
    generatedAt: new Date().toISOString(),
    signals: demandSignals,
  });

  const facilityRankCount = sortedRanks.filter((r) => r.id.startsWith('rank-f')).length;
  const report = {
    generatedAt: new Date().toISOString(),
    sources: {
      routesLayer: ROUTES_LAYER_URL,
      facilitiesLayer: FACILITIES_LAYER_URL,
      attribution:
        'Council for Scientific and Industrial Research (CSIR), South Africa - public ArcGIS ' +
        'services (query-only). Route survey December 2018; facility survey 2021.',
    },
    counts: {
      routeTracksFetched: routeFeatures.length,
      facilitiesFetched: facilityFeatures.length,
      associations: sortedAssociations.length,
      ranks: {
        total: sortedRanks.length,
        fromFacilitySurvey: facilityRankCount,
        derivedFromRouteEndpoints: sortedRanks.length - facilityRankCount,
      },
      routes: sortedRoutes.length,
      legs: {
        total: sortedLegs.length,
        out: sortedLegs.filter((l) => l.direction === 'out').length,
        return: sortedLegs.filter((l) => l.direction === 'return').length,
      },
      fareSnapshots: fareSnapshots.length,
      demoDemandSignals: demandSignals.length,
    },
    repairs: {
      snappedPathEndpoints,
      fareRatePerKm,
      imputedFareLegs,
    },
    issues: {
      zeroFareLegs: issues.zeroFareLegs,
      routesMissingDirection: issues.routesMissingDirection.slice(0, 60),
      splitRouteGroups: issues.splitRouteGroups.slice(0, 40),
      splitRouteGroupCount: issues.splitRouteGroups.length,
      selfLoopLegsSkipped: issues.selfLoopLegs,
      routesWithoutLegs: issues.routesWithoutLegs,
      mergedFacilityNames: issues.mergedFacilityNames,
      facilitiesWithoutLocation: issues.facilitiesWithoutLocation,
      multiPathTrackCount: issues.multiPathTracks.length,
      assocIdCollisions: issues.assocIdCollisions,
      rankPlacementWarnings: {
        facilityAnchoredCount: rankPlacementWarnings.facilityAnchored.length,
        suspicious: rankPlacementWarnings.suspicious.slice(0, 40),
        suspiciousCount: rankPlacementWarnings.suspicious.length,
      },
    },
  };
  await write('import-report.json', report);

  console.log('\nImport complete:');
  console.log(`  ${report.counts.associations} associations`);
  console.log(
    `  ${report.counts.ranks.total} ranks (${report.counts.ranks.fromFacilitySurvey} from the facility survey, ${report.counts.ranks.derivedFromRouteEndpoints} derived from route endpoints)`,
  );
  console.log(`  ${report.counts.routes} routes`);
  console.log(
    `  ${report.counts.legs.total} legs (${report.counts.legs.out} out / ${report.counts.legs.return} return)`,
  );
  console.log(`  ${report.counts.fareSnapshots} fare snapshots`);
  console.log(`  ${report.counts.demoDemandSignals} demo demand signals`);
  if (snappedPathEndpoints > 0) {
    console.log(`  repaired: pinned ${snappedPathEndpoints} path endpoint(s) to their rank anchors`);
  }
  if (imputedFareLegs.length > 0) {
    console.log(`  repaired: imputed ${imputedFareLegs.length} zero-fare leg(s) from category fare rates`);
  }
  console.log(`Files written to ${outDir}`);
  if (report.counts.legs.total === 0) {
    console.error('WARNING: no legs were produced - check import-report.json.');
  }
  if (rankPlacementWarnings.suspicious.length > 0) {
    console.warn(
      `WARNING: ${rankPlacementWarnings.suspicious.length} legs have a rank anchor >2km from their surveyed track - see import-report.json`,
    );
  }

  // --- Optional Supabase push ---------------------------------------------
  if (flags.push) {
    await pushToSupabase({ sortedAssociations, sortedRanks, sortedRoutes, sortedLegs, fareSnapshots, demandSignals });
  }
}

async function pushToSupabase(data: {
  sortedAssociations: TaxiAssociation[];
  sortedRanks: Rank[];
  sortedRoutes: TaxiRoute[];
  sortedLegs: Leg[];
  fareSnapshots: FareSnapshot[];
  demandSignals: DemandSignal[];
}): Promise<void> {
  const supabaseUrl = config.supabaseUrl;
  const serviceKey = config.supabaseServiceRoleKey;
  if (!supabaseUrl || !serviceKey || !hasSupabaseCredentials) {
    console.error(
      '--push needs SUPABASE_URL and SUPABASE_SECRET_KEY (or the legacy ' +
        'SUPABASE_SERVICE_ROLE_KEY) set in services/api/.env',
    );
    process.exitCode = 1;
    return;
  }
  const supabase: SupabaseClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const chunkSize = 200;
  async function upsert(table: string, rows: Array<Record<string, unknown>>): Promise<void> {
    for (let i = 0; i < rows.length; i += chunkSize) {
      const { error } = await supabase.from(table).upsert(rows.slice(i, i + chunkSize), {
        onConflict: 'id',
      });
      if (error) throw new Error(`upsert ${table}: ${error.message}`);
    }
    console.log(`  pushed ${rows.length} rows to ${table}`);
  }
  async function insert(table: string, rows: Array<Record<string, unknown>>): Promise<void> {
    for (let i = 0; i < rows.length; i += chunkSize) {
      const { error } = await supabase.from(table).insert(rows.slice(i, i + chunkSize));
      if (error) throw new Error(`insert ${table}: ${error.message}`);
    }
    console.log(`  pushed ${rows.length} rows to ${table}`);
  }

  console.log('\nPushing to Supabase...');

  await upsert(
    'associations',
    data.sortedAssociations.map((a) => ({ id: a.id, name: a.name })),
  );

  await upsert(
    'ranks',
    data.sortedRanks.map((r) => ({
      id: r.id,
      name: r.name,
      area: r.area ?? null,
      location: { type: 'Point', coordinates: [r.location.longitude, r.location.latitude] },
      modes: r.modes,
      landmark_notes: r.landmarkNotes ?? null,
      landmark_photo_url: null,
      facilities: r.facilities ?? [],
      kind: r.kind ?? null,
    })),
  );

  await upsert(
    'routes',
    data.sortedRoutes.map((r) => ({
      id: r.id,
      label: r.label,
      association_id: r.associationId ?? null,
      category: r.category,
      mode: r.mode,
      seats: r.seats ?? null,
      is_blocked: false,
      source_note: r.sourceNote ?? null,
    })),
  );

  await upsert(
    'legs',
    data.sortedLegs.map((l) => ({
      id: l.id,
      mode: l.mode,
      from_rank_id: l.fromRankId,
      to_rank_id: l.toRankId,
      fare_zar: l.fareZar,
      estimated_minutes: l.estimatedMinutes,
      distance_km: l.distanceKm ?? null,
      reliability: l.reliability ?? null,
      departs_when_full: l.departsWhenFull ?? true,
      path:
        l.path && l.path.length >= 2
          ? { type: 'LineString', coordinates: l.path.map((p) => [p.longitude, p.latitude]) }
          : null,
      route_id: l.routeId ?? null,
      direction: l.direction ?? null,
    })),
  );

  // Snapshots and demo demand are append-only tables (identity PKs): clear
  // this import's rows first so reruns do not duplicate them.
  await supabase.from('fare_snapshots').delete().eq('source', FARE_SOURCE);
  await insert(
    'fare_snapshots',
    data.fareSnapshots.map((s) => ({
      leg_id: s.legId,
      fare_zar: s.fareZar,
      observed_at: s.observedAt,
      source: s.source,
    })),
  );

  if (data.demandSignals.length > 0) {
    await supabase.from('demand_signals').delete().eq('source', DEMAND_SOURCE);
    await insert(
      'demand_signals',
      data.demandSignals.map((s) => ({
        route_id: s.routeId ?? null,
        rank_id: s.rankId ?? null,
        direction: s.direction ?? null,
        passengers: s.passengers,
        signal_at: s.signalAt,
        source: s.source,
      })),
    );
  }
}

main().catch((error: unknown) => {
  console.error(`Import failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
