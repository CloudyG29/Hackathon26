import type { RankSearchResult } from '@hackathon26/shared';
import { supabase } from './db';

interface RankRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

/**
 * Ranks for the search box: no query returns the full list (initial
 * autocomplete population), a query returns case-insensitive partial name
 * matches. Reads the flat live schema (ranks carry plain lat/lng columns).
 */
export async function fetchRanks(query?: string): Promise<RankSearchResult[]> {
  if (!supabase) {
    throw new Error('Supabase credentials are not configured (services/api/.env)');
  }

  let request = supabase.from('ranks').select('id, name, lat, lng').order('name', { ascending: true });
  const search = query?.trim();
  if (search) {
    request = request.ilike('name', `%${escapeLike(search)}%`);
  }

  const { data, error } = await request;
  if (error) throw new Error(`${error.code ?? 'error'}: ${error.message}`);

  return ((data ?? []) as RankRow[]).map((row) => ({
    rankId: row.id,
    name: row.name,
    lat: Number(row.lat),
    lng: Number(row.lng),
  }));
}

/** `%`, `_` and `\` typed by a user are literal characters, not LIKE wildcards. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
