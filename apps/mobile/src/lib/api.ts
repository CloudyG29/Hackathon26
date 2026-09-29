/**
 * API client for the journey screen.
 *
 * Contract (agreed with the backend team):
 *   GET  /ranks?q=<text>          -> [{ rankId, name, lat, lng }, ...]
 *   POST /routes/plan             -> { legs, totalFareZar, legCount } | 404
 *   Request body: { fromRankId, toRankId, priority? }
 *
 * USE_STUBS forces the local fake responses regardless of connectivity.
 * When it is false, every call tries the real API first and falls back to
 * the seeded fixtures on any failure (API down, timeout, bad status) so the
 * UI stays demoable offline.
 *
 * Default base URL: the Android emulator cannot reach the dev machine via
 * localhost, so it gets the 10.0.2.2 host alias instead (see .env.example).
 */

import { Platform } from 'react-native';
import type { PlanLeg, PlanPriority, PlanResult, RankSuggestion } from '@hackathon26/shared';
import { buildFixturePlan } from './fixtures';
import { stubPlanJourney, stubSearchRanks } from './stubs';

const USE_STUBS = false;

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000');

// The mobile app speaks the same wire shapes as the backend, straight from
// the shared package.
export type { PlanLeg, PlanPriority, PlanResult, RankSuggestion };

/** Where the currently displayed plan came from, shown as a badge on screen. */
export type PlanSource = 'api' | 'fixtures' | 'stubs';

interface PlanCallResult {
  plan: PlanResult | null;
  source: PlanSource;
}

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
  ).catch(() => stubSearchRanks(query));
}

export async function planJourney(
  fromRankId: string,
  toRankId: string,
  priority: PlanPriority = 'cheapest',
): Promise<PlanCallResult> {
  if (USE_STUBS) {
    return { plan: stubPlanJourney(fromRankId, toRankId), source: 'stubs' };
  }
  try {
    const plan = await fetchJson<PlanResult | null>('/routes/plan', {
      method: 'POST',
      body: JSON.stringify({ fromRankId, toRankId, priority }),
    });
    return { plan, source: 'api' };
  } catch {
    // API unreachable: the seeded corridor keeps the demo alive.
    return { plan: buildFixturePlan(fromRankId, toRankId), source: 'fixtures' };
  }
}
