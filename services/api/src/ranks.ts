import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RankSearchResult } from '@hackathon26/shared';
import { supabase } from './db';

interface RankRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

/** One record of the generated seed corpus, the town/city lookup source. */
interface SeedRankRecord {
  id: string;
  area?: string;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Town/city per rank, read once from the generated seed corpus in data/seed
 * (same rank ids). The live ranks table still carries the old flat shape with
 * no area column, so the corpus fills the gap; promise-cached so the file is
 * parsed at most once per process.
 */
let areaByIdPromise: Promise<Map<string, string>> | undefined;

function rankAreaById(): Promise<Map<string, string>> {
  areaByIdPromise ??= readSeedAreas();
  return areaByIdPromise;
}

async function readSeedAreas(): Promise<Map<string, string>> {
  const areas = new Map<string, string>();
  try {
    const raw = await readFile(path.join(repoRoot, 'data', 'seed', 'ranks.json'), 'utf8');
    const seed = JSON.parse(raw) as { ranks?: SeedRankRecord[] };
    for (const rank of seed.ranks ?? []) {
      if (rank.id && rank.area) areas.set(rank.id, rank.area);
    }
  } catch {
    // Seed file unavailable (e.g. deployed without the data folder): rank
    // names still match, town/city search just degrades to nothing.
  }
  return areas;
}

/**
 * Ranks for the search box: no query returns the full list (initial
 * autocomplete population); a query matches the rank name or its town/city
 * (area) case-insensitively, partially, so "Pretoria" or "Temba" finds every
 * rank in that town. Reads the flat live schema (ranks carry plain lat/lng
 * columns) and filters in memory over the small reference list.
 */
export async function fetchRanks(query?: string): Promise<RankSearchResult[]> {
  if (!supabase) {
    throw new Error('Supabase credentials are not configured (services/api/.env)');
  }

  const { data, error } = await supabase
    .from('ranks')
    .select('id, name, lat, lng')
    .order('name', { ascending: true });
  if (error) throw new Error(`${error.code ?? 'error'}: ${error.message}`);

  const rows = (data ?? []) as RankRow[];
  const areas = await rankAreaById();
  const search = query?.trim().toLowerCase();

  const matches = search
    ? rows.filter(
        (row) =>
          row.name.toLowerCase().includes(search) ||
          (areas.get(row.id)?.toLowerCase().includes(search) ?? false),
      )
    : rows;

  return matches.map((row) => ({
    rankId: row.id,
    name: row.name,
    area: areas.get(row.id),
    lat: Number(row.lat),
    lng: Number(row.lng),
  }));
}
