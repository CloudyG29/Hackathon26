/**
 * Seeds the real CSIR taxi data from data/seed/*.json into the live Supabase
 * schema used by the routing-engine-integration branch:
 *
 *   ranks          (id, name, lat, lng)
 *   routes         (id, from_rank_id, to_rank_id, fare, time_mins,
 *                   taxi_association, is_blocked)   <- one row per seed LEG
 *   demand_signals (id, user_id, from_rank_id, to_rank_id, timestamp)
 *
 * Edge ids and demand ids are deterministic UUIDs derived from the seed ids,
 * so reruns upsert cleanly instead of duplicating. The demo demand rows use
 * user_id 'demo_seed' so they can be identified and re-seeded.
 *
 * Usage (from the repo root):
 *   npm run seed:db --workspace @hackathon26/api            # wipe + seed
 *   npm run seed:db --workspace @hackathon26/api -- --no-wipe
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Leg, Rank, TaxiAssociation, TaxiRoute } from '@hackathon26/shared';
import { config, hasSupabaseCredentials } from '../config';

const DEMO_USER = 'demo_seed';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const seedDir = path.join(repoRoot, 'data', 'seed');
const args = process.argv.slice(2);
const wipe = !args.includes('--no-wipe');

interface DemoSignal {
  id: string;
  routeId?: string;
  rankId?: string;
  direction?: 'out' | 'return';
  passengers: number;
  signalAt: string;
}

/** Same seed id -> same uuid every run, so upserts land on the same row. */
function deterministicUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function loadJson<T>(name: string, key: string): Promise<T[]> {
  const body = JSON.parse(await readFile(path.join(seedDir, name), 'utf8')) as Record<string, T[]>;
  return body[key] ?? [];
}

async function main(): Promise<void> {
  if (!hasSupabaseCredentials || !config.supabaseUrl || !config.supabaseServiceRoleKey) {
    console.error('seed:db needs SUPABASE_URL and SUPABASE_SECRET_KEY in services/api/.env');
    process.exitCode = 1;
    return;
  }
  const supabase: SupabaseClient = createClient(
    config.supabaseUrl,
    config.supabaseServiceRoleKey,
    { auth: { persistSession: false } },
  );

  const ranks = await loadJson<Rank>('ranks.json', 'ranks');
  const routes = await loadJson<TaxiRoute>('routes.json', 'routes');
  const legs = await loadJson<Leg>('legs.json', 'legs');
  const associations = await loadJson<TaxiAssociation>('associations.json', 'associations');
  const signals = await loadJson<DemoSignal>('demand-demo.json', 'signals');

  const assocName = new Map(associations.map((a) => [a.id, a.name]));
  const routeById = new Map(routes.map((r) => [r.id, r]));

  if (wipe) {
    // Order matters if these become real FKs: dependents first. PostgREST
    // deletes need a filter, so use an always-true one per id type.
    const wipes: Array<[string, string]> = [
      ['demand_signals', '00000000-0000-0000-0000-000000000000'],
      ['routes', '00000000-0000-0000-0000-000000000000'],
      ['ranks', ''],
    ];
    for (const [table, neverValue] of wipes) {
      const { error } = await supabase.from(table).delete().neq('id', neverValue);
      if (error) throw new Error(`wipe ${table}: ${error.message}`);
      console.log(`  wiped ${table}`);
    }
  }

  const chunk = 500;
  async function insertAll(table: string, rows: Array<Record<string, unknown>>): Promise<void> {
    for (let i = 0; i < rows.length; i += chunk) {
      const { error } = await supabase
        .from(table)
        .upsert(rows.slice(i, i + chunk), { onConflict: 'id' });
      if (error) throw new Error(`insert ${table}: ${error.message}`);
    }
    console.log(`  seeded ${rows.length} rows into ${table}`);
  }

  console.log(`Seeding ${ranks.length} ranks, ${legs.length} route edges, ${signals.length} demo demand signals...`);

  await insertAll(
    'ranks',
    ranks.map((r) => ({
      id: r.id,
      name: r.name,
      lat: r.location.latitude,
      lng: r.location.longitude,
    })),
  );

  // One edge per seed leg: the live schema flattens fare/minutes/association
  // onto the edge and inherits the strike toggle from the parent route.
  await insertAll(
    'routes',
    legs.map((l) => ({
      id: deterministicUuid(l.id),
      from_rank_id: l.fromRankId,
      to_rank_id: l.toRankId,
      fare: l.fareZar,
      time_mins: l.estimatedMinutes,
      taxi_association:
        (l.routeId ? routeById.get(l.routeId)?.associationId : undefined) !== undefined
          ? assocName.get(routeById.get(l.routeId!)!.associationId!) ?? 'Independent'
          : 'Independent',
      is_blocked: l.routeId ? (routeById.get(l.routeId)?.isBlocked ?? false) : false,
    })),
  );

  // A demand signal travels one leg: use that leg's from/to directly.
  const legByKey = new Map(legs.map((l) => [`${l.routeId}:${l.direction}`, l]));
  const demandRows = signals
    .map((s): Record<string, unknown> | undefined => {
      const leg = s.routeId ? legByKey.get(`${s.routeId}:${s.direction}`) : undefined;
      if (!leg) return undefined;
      return {
        id: deterministicUuid(s.id),
        user_id: DEMO_USER,
        from_rank_id: leg.fromRankId,
        to_rank_id: leg.toRankId,
        timestamp: s.signalAt,
      };
    })
    .filter((r): r is Record<string, unknown> => r !== undefined);
  await insertAll('demand_signals', demandRows);

  console.log('Seed complete.');
}

main().catch((error: unknown) => {
  console.error(`Seed failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
