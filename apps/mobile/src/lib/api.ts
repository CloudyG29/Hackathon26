/**
 * API client for the journey screen.
 *
 * Contract (agreed with the backend team):
 *   GET  /ranks?q=<text>          -> [{ rankId, name, lat, lng }, ...]
 *   POST /routes/plan             -> { legs, totalFareZar, legCount } | 404
 *   Request body: { fromRankId, toRankId, priority? }
 *
 * USE_STUBS is the single switch between the local fake responses and the
 * real endpoints. Flip it to false (and delete lib/stubs.ts) once the
 * backend lands — nothing else changes.
 */

import { stubPlanJourney, stubSearchRanks } from './stubs';

const USE_STUBS = true;

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface RankSuggestion {
  rankId: string;
  name: string;
  lat: number;
  lng: number;
}

export interface PlanLegPathPoint {
  lat: number;
  lng: number;
}

export interface PlanLeg {
  fromRankId: string;
  fromName: string;
  toRankId: string;
  toName: string;
  path: PlanLegPathPoint[];
  fareZar: number;
}

export interface PlanResult {
  legs: PlanLeg[];
  totalFareZar: number;
  legCount: number;
}

export type RoutePriority = 'cheapest' | 'fastest' | 'easiest' | 'safest';

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (response.status === 404) {
    // The agreed "no route found" shape: an empty result, not an error.
    return null as T;
  }
  if (!response.ok) {
    throw new Error(`API ${response.status} for ${path}`);
  }
  return (await response.json()) as T;
}

export function searchRanks(query: string): Promise<RankSuggestion[]> {
  if (USE_STUBS) return Promise.resolve(stubSearchRanks(query));
  return fetchJson<RankSuggestion[]>(
    `/ranks?q=${encodeURIComponent(query)}`,
  );
}

export function planJourney(
  fromRankId: string,
  toRankId: string,
  priority: RoutePriority = 'cheapest',
): Promise<PlanResult | null> {
  if (USE_STUBS) return Promise.resolve(stubPlanJourney(fromRankId, toRankId));
  return fetchJson<PlanResult | null>('/routes/plan', {
    method: 'POST',
    body: JSON.stringify({ fromRankId, toRankId, priority }),
  });
}
