/**
 * Local stub responses matching the agreed backend contract exactly, so the
 * journey screen can be built and visually verified while POST /routes/plan
 * and GET /ranks are still 501/empty. Delete this file (and flip USE_STUBS in
 * lib/api.ts) once the real endpoints land.
 *
 * NOTE: stub data is invented for layout work only — never a data source.
 */

import type { PlanLeg, PlanResult, RankSuggestion } from './api';

export const STUB_RANKS: RankSuggestion[] = [
  { rankId: 'rank-f12', name: 'Marabastad Taxi Rank', lat: -25.7449, lng: 28.1878 },
  { rankId: 'rank-f34', name: 'Bloed Mall Taxi Rank', lat: -25.7545, lng: 28.1905 },
  { rankId: 'rank-f57', name: 'Sunnyside Loading Point', lat: -25.7646, lng: 28.2051 },
  { rankId: 'rank-cr1-2', name: 'Hammanskraal Rank', lat: -25.4081, lng: 28.2825 },
  { rankId: 'rank-cr8', name: 'Temba Taxi Rank', lat: -25.3456, lng: 28.2871 },
  { rankId: 'rank-f71', name: 'Mamelodi Taxi Rank', lat: -25.7205, lng: 28.3817 },
];

/** One-leg journey: Marabastad -> Hammanskraal. */
const STUB_PLAN_SINGLE: PlanResult = {
  legs: [
    {
      fromRankId: 'rank-f12',
      fromName: 'Marabastad Taxi Rank',
      toRankId: 'rank-cr1-2',
      toName: 'Hammanskraal Rank',
      path: [
        { lat: -25.7449, lng: 28.1878 },
        { lat: -25.6902, lng: 28.1931 },
        { lat: -25.6317, lng: 28.2216 },
        { lat: -25.5541, lng: 28.2498 },
        { lat: -25.4772, lng: 28.2705 },
        { lat: -25.4081, lng: 28.2825 },
      ],
      fareZar: 32,
    },
  ],
  totalFareZar: 32,
  legCount: 1,
};

/** Two-leg journey with a transfer: Bloed Mall -> Marabastad -> Temba. */
const STUB_PLAN_TRANSFER: PlanResult = {
  legs: [
    {
      fromRankId: 'rank-f34',
      fromName: 'Bloed Mall Taxi Rank',
      toRankId: 'rank-f12',
      toName: 'Marabastad Taxi Rank',
      path: [
        { lat: -25.7545, lng: 28.1905 },
        { lat: -25.7508, lng: 28.1883 },
        { lat: -25.7449, lng: 28.1878 },
      ],
      fareZar: 12.5,
    },
    {
      fromRankId: 'rank-f12',
      fromName: 'Marabastad Taxi Rank',
      toRankId: 'rank-cr8',
      toName: 'Temba Taxi Rank',
      path: [
        { lat: -25.7449, lng: 28.1878 },
        { lat: -25.6815, lng: 28.1954 },
        { lat: -25.6017, lng: 28.2302 },
        { lat: -25.5083, lng: 28.2611 },
        { lat: -25.4231, lng: 28.2765 },
        { lat: -25.3456, lng: 28.2871 },
      ],
      fareZar: 30,
    },
  ],
  totalFareZar: 42.5,
  legCount: 2,
};

/** Search over the stub rank list (same intent as GET /ranks?q=). */
export function stubSearchRanks(query: string): RankSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return STUB_RANKS;
  return STUB_RANKS.filter((r) => r.name.toLowerCase().includes(q));
}

/** Alternate between the two stub journeys so both layouts get exercised. */
export function stubPlanJourney(fromRankId: string, toRankId: string): PlanResult | null {
  if (fromRankId === 'rank-f34' && toRankId === 'rank-cr8') return STUB_PLAN_TRANSFER;
  if (fromRankId === toRankId) return null;
  return STUB_PLAN_SINGLE;
}
