import { Platform } from 'react-native';
import type { HealthResponse, PlanRouteRequest, PlanRouteResponse } from '@hackathon26/shared';
import { buildFixturePlan } from './fixtures';

/**
 * Routing API client.
 *
 * EXPO_PUBLIC_API_URL is inlined at bundle time; when it is unset we fall
 * back to platform defaults — 10.0.2.2 is the Android emulator's alias for
 * the host machine, so an emulator reaches a locally-run `npm run api` out
 * of the box. A physical device needs the dev machine's LAN IP instead.
 */
const DEFAULT_API_URL =
  Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';

export const apiUrl = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;

export type PlanSource = 'api' | 'fixtures';

export interface JourneyPlan {
  plan: PlanRouteResponse;
  source: PlanSource;
}

/** fetch with a hard timeout so an unreachable API can never hang the UI. */
async function fetchJson<T>(path: string, init?: RequestInit, timeoutMs = 4000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiUrl}${path}`, { ...init, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Request failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Plans a journey via POST /routes/plan. Any failure — API down, 501 while
 * the routing engine is still being built, malformed response — degrades to
 * the offline fixtures so the demo never blocks on the backend. The route
 * screen shows a "sample data" badge whenever that happened.
 */
export async function planJourney(request: PlanRouteRequest): Promise<JourneyPlan> {
  try {
    const plan = await fetchJson<PlanRouteResponse>('/routes/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return { plan, source: 'api' };
  } catch {
    return { plan: buildFixturePlan(request), source: 'fixtures' };
  }
}

/** Liveness probe — returns null instead of throwing when the API is unreachable. */
export async function checkApiHealth(): Promise<HealthResponse | null> {
  try {
    return await fetchJson<HealthResponse>('/health', undefined, 2000);
  } catch {
    return null;
  }
}
