import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LatLng, PlanJourneyResponse, PlanPriority, RankSearchResult } from '@hackathon26/shared';
import { config } from './config';
import { supabase } from './db';
import { parseLineString } from './geo';
import { fetchRanks } from './ranks';

/** One leg of the network snapshot handed to the Python planner. */
interface PlannerLeg {
  legId: string;
  fromRankId: string;
  toRankId: string;
  fareZar: number;
  minutes: number;
  blocked: boolean;
  path: LatLng[];
}

interface PlannerRequest {
  fromRankId: string;
  toRankId: string;
  priority: PlanPriority;
  ranks: RankSearchResult[];
  legs: PlannerLeg[];
}

/** The planner answers found/not-found; the API maps that to 200/404. */
export type PlannerResult =
  | ({ found: true } & PlanJourneyResponse)
  | { found: false; reason: string; detail?: string };

/** services/api/src -> services/routing. */
const routingDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'routing');
const routingSrcDir = path.join(routingDir, 'src');
const PLANNER_TIMEOUT_MS = 10_000;

/**
 * Loads the rank/leg network from Supabase, then asks the services/routing
 * NetworkX engine for the best journey. The engine runs as a per-request
 * subprocess over its stdin/stdout JSON protocol, so nothing is cached here
 * and a strike toggled in the database is visible on the very next plan.
 */
export async function planJourney(options: {
  fromRankId: string;
  toRankId: string;
  priority?: PlanPriority;
}): Promise<PlannerResult> {
  if (!supabase) {
    throw new Error('Supabase credentials are not configured (services/api/.env)');
  }

  const ranks = await fetchRanks();
  for (const [field, rankId] of [
    ['fromRankId', options.fromRankId],
    ['toRankId', options.toRankId],
  ] as const) {
    if (!ranks.some((rank) => rank.rankId === rankId)) {
      return {
        found: false,
        reason: 'unknown_rank',
        detail: `${field} "${rankId}" does not exist`,
      };
    }
  }

  const { data: legRows, error: legError } = await supabase
    .from('legs')
    .select('id, from_rank_id, to_rank_id, fare_zar, estimated_minutes, path, route_id');
  if (legError) throw new Error(`${legError.code ?? 'error'}: ${legError.message}`);

  const { data: routeRows, error: routeError } = await supabase
    .from('routes')
    .select('id, is_blocked');
  if (routeError) throw new Error(`${routeError.code ?? 'error'}: ${routeError.message}`);

  // A struck route blocks both of its directed legs; legs without a parent
  // route are never blocked.
  const blockedRouteIds = new Set(
    (routeRows ?? [])
      .filter((route) => route.is_blocked)
      .map((route) => route.id as string),
  );

  const legs: PlannerLeg[] = (legRows ?? []).map((row) => {
    const path = parseLineString(row.path);
    if (row.path != null && path === null) {
      throw new Error(`leg "${row.id}" has an unreadable path geometry`);
    }
    return {
      legId: row.id as string,
      fromRankId: row.from_rank_id as string,
      toRankId: row.to_rank_id as string,
      fareZar: Number(row.fare_zar),
      minutes: Number(row.estimated_minutes),
      blocked: row.route_id ? blockedRouteIds.has(row.route_id as string) : false,
      path: path ?? [],
    };
  });

  return runPlanner({
    fromRankId: options.fromRankId,
    toRankId: options.toRankId,
    priority: options.priority ?? 'cheapest',
    ranks,
    legs,
  });
}

/** Runs `python -m routing.cli`: one request over stdin, one result over stdout. */
function runPlanner(request: PlannerRequest): Promise<PlannerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.routingPython, ['-m', 'routing.cli'], {
      cwd: routingDir,
      env: {
        ...process.env,
        PYTHONPATH: process.env.PYTHONPATH
          ? `${routingSrcDir}${path.delimiter}${process.env.PYTHONPATH}`
          : routingSrcDir,
        // Keep the pipe UTF-8 so non-ASCII rank names survive Windows defaults.
        PYTHONUTF8: '1',
      },
      windowsHide: true,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`routing engine timed out after ${PLANNER_TIMEOUT_MS} ms`));
    }, PLANNER_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(
        new Error(`could not start the routing engine ("${config.routingPython}"): ${error.message}`),
      );
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const output = Buffer.concat(stdout).toString('utf8');
      const diagnostics = Buffer.concat(stderr).toString('utf8').trim();
      if (code !== 0) {
        reject(
          new Error(`routing engine exited with code ${code}${diagnostics ? `: ${diagnostics}` : ''}`),
        );
        return;
      }
      try {
        resolve(JSON.parse(output) as PlannerResult);
      } catch {
        reject(
          new Error(
            `routing engine returned unreadable output${diagnostics ? `: ${diagnostics}` : ''}`,
          ),
        );
      }
    });

    // The engine may exit before consuming stdin; the close handler reports it.
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}
