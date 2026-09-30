import type { PlanResult } from '@hackathon26/shared';
import type { PlanSource } from './api';

export interface SavedPlan {
  plan: PlanResult;
  /** Free-text endpoints the user searched, for the breakdown header. */
  fromLabel: string;
  toLabel: string;
  source: PlanSource;
}

/**
 * Module-level cache of the most recent plan. Keeps navigation params down
 * to nothing while the route screen pulls the full payload from here.
 * Resets when the app reloads — the route screen degrades to a
 * "plan expired" state instead of crashing.
 */
let saved: SavedPlan | null = null;

export function savePlan(next: SavedPlan): void {
  saved = next;
}

export function loadPlan(): SavedPlan | null {
  return saved;
}
