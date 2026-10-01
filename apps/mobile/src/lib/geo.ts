/**
 * Pure geometry helpers over the planner's wire-format paths (LatLng[]).
 *
 * The screens used to place fare bubbles with `path[Math.floor(length / 2)]`,
 * which visibly misplaces them on short legs: a two-point path (a straight
 * line between two ranks) put the bubble exactly on the destination pin.
 * polylineMidpoint() walks by arc length instead, so the bubble always sits
 * halfway along the drawn line; regionForPath() frames one leg for the
 * "tap a leg to focus it" camera move on the breakdown screen.
 */

import type { LatLng } from '@hackathon26/shared';

/** Camera bounds for MapView.animateToRegion(). */
export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/**
 * Length proxy in "longitude-corrected degrees": the lng delta is scaled by
 * cos(lat) so east-west segments compare fairly with north-south ones. Exact
 * metres are not needed — only relative lengths along a single polyline.
 */
function segmentLength(a: LatLng, b: LatLng): number {
  const midLatRad = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  return Math.hypot(b.lat - a.lat, (b.lng - a.lng) * Math.cos(midLatRad));
}

/**
 * The point halfway along the polyline by arc length, linearly interpolated
 * inside the segment that contains the halfway mark. Long segments therefore
 * pull the midpoint toward them, unlike a plain array-index midpoint.
 *
 * Returns undefined only for an empty path; a single-point path is its own
 * midpoint.
 */
export function polylineMidpoint(path: LatLng[]): LatLng | undefined {
  if (path.length === 0) return undefined;
  const first = path[0]!;
  if (path.length === 1) return first;

  let total = 0;
  const lengths: number[] = [];
  for (let i = 1; i < path.length; i += 1) {
    const length = segmentLength(path[i - 1]!, path[i]!);
    lengths.push(length);
    total += length;
  }
  if (total === 0) return first;

  const half = total / 2;
  let travelled = 0;
  for (let i = 0; i < lengths.length; i += 1) {
    const length = lengths[i]!;
    if (travelled + length >= half) {
      const t = length === 0 ? 0 : (half - travelled) / length;
      const from = path[i]!;
      const to = path[i + 1]!;
      return {
        lat: from.lat + (to.lat - from.lat) * t,
        lng: from.lng + (to.lng - from.lng) * t,
      };
    }
    travelled += length;
  }
  // Unreachable in practice (float drift); fall back to the last point.
  return path[path.length - 1]!;
}

/**
 * Bounding region that frames a whole path with 40% padding, for
 * MapView.animateToRegion(). Deltas are floored at 0.02° so a single rank or
 * a very short leg still gets a usable zoom level instead of a 0° region.
 *
 * Returns undefined for an empty path.
 */
export function regionForPath(path: LatLng[]): MapRegion | undefined {
  if (path.length === 0) return undefined;

  let minLat = path[0]!.lat;
  let maxLat = minLat;
  let minLng = path[0]!.lng;
  let maxLng = minLng;
  for (const point of path) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLng = Math.min(minLng, point.lng);
    maxLng = Math.max(maxLng, point.lng);
  }

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.4, 0.02),
    longitudeDelta: Math.max((maxLng - minLng) * 1.4, 0.02),
  };
}
