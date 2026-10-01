/**
 * Offline rank search matching the agreed backend contract exactly.
 *
 * The ranks are derived from the seeded corridor in ./fixtures — never
 * invented here — so every id returned by search is one the fixture planner
 * understands: pick "Hammanskraal Station" while the API is down and the
 * offline fallback still plans the full journey for that rank pair.
 */

import type { RankSuggestion } from '@hackathon26/shared';
import { RANKS } from './fixtures';

export const STUB_RANKS: RankSuggestion[] = RANKS.map((rank) => ({
  rankId: rank.id,
  name: rank.name,
  lat: rank.location.latitude,
  lng: rank.location.longitude,
}));

/** Search over the fixture rank list (same intent as GET /ranks?q=). */
export function stubSearchRanks(query: string): RankSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return STUB_RANKS;
  return STUB_RANKS.filter((r) => r.name.toLowerCase().includes(q));
}
