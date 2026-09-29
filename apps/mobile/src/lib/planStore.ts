import type { PlanRouteResponse } from '@hackathon26/shared';
import type { PlanSource } from './api';

export interface SavedPlan {
  plan: PlanRouteResponse;
  source: PlanSource;
}

/**
 * Module-level cache of the most recent plan. Keeps navigation params down
 * to a single planId while the route screen pulls the full payload from
 * here. Resets when the app reloads — the route screen degrades to a
 * "plan expired" state instead of crashing.
 */
let saved: SavedPlan | null = null;

export function savePlan(next: SavedPlan): void {
  saved = next;
}

export function loadPlan(planId?: string): SavedPlan | null {
  if (!saved) return null;
  if (planId && saved.plan.planId !== planId) return null;
  return saved;
}
