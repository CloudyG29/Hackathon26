import type { RankSearchResult } from '@hackathon26/shared';
import { supabase } from './db';
import { parseGeoPoint } from './geo';

interface RankRow {
  id: string;
  name: string;
  location: unknown;
}

/**
 * Ranks for the search box: no query returns the full list (initial
 * autocomplete population), a query returns case-insensitive partial name
 * matches.
 */
export async function fetchRanks(query?: string): Promise<RankSearchResult[]> {
  if (!supabase) {
    throw new Error('Supabase credentials are not configured (services/api/.env)');
  }

  let request = supabase.from('ranks').select('id, name, location').order('name', { ascending: true });
  const search = query?.trim();
  if (search) {
    request = request.ilike('name', `%${escapeLike(search)}%`);
  }

  const { data, error } = await request;
  if (error) throw new Error(`${error.code ?? 'error'}: ${error.message}`);

  return ((data ?? []) as RankRow[]).map((row) => {
    const point = parseGeoPoint(row.location);
    if (!point) throw new Error(`rank "${row.id}" has an unreadable location value`);
    return { rankId: row.id, name: row.name, lat: point.lat, lng: point.lng };
  });
}

/** `%`, `_` and `\` typed by a user are literal characters, not LIKE wildcards. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
