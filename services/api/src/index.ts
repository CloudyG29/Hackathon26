import 'dotenv/config';
import cors from 'cors';
import express, { type Response } from 'express';
import { z } from 'zod';
import type { HealthResponse, PlanPriority } from '@hackathon26/shared';
import { config, hasSupabaseCredentials } from './config';
import { planJourney } from './planner';
import { fetchRanks } from './ranks';

/** Runtime copy of the shared PlanPriority union, kept in sync by `satisfies`. */
const PLAN_PRIORITIES = [
  'cheapest',
  'fastest',
  'fewest_transfers',
] as const satisfies readonly PlanPriority[];

const planRequestSchema = z.object({
  fromRankId: z.string().min(1),
  toRankId: z.string().min(1),
  priority: z.enum(PLAN_PRIORITIES).optional(),
});

const app = express();
const startedAt = Date.now();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  const body: HealthResponse = {
    status: 'ok',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    dataSource: hasSupabaseCredentials ? 'supabase' : 'fixtures',
  };
  res.json(body);
});

/**
 * Rank lookup for the search box: ?q=<fragment> matches names
 * case-insensitively (partial); no query returns the full list for the
 * initial autocomplete population.
 */
app.get('/ranks', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : undefined;
  try {
    res.json(await fetchRanks(query));
  } catch (error) {
    sendDataLayerError(res, error);
  }
});

/**
 * Journey planning for the journey-map screen. Body is
 * { fromRankId, toRankId, priority? }; the response is an ordered list of
 * legs (names + geometry + fare) plus the fare total and leg count. No path
 * is a 404 with a clear message, never a partial journey.
 */
app.post('/routes/plan', async (req, res) => {
  const parsed = planRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', issues: parsed.error.issues });
    return;
  }

  try {
    const result = await planJourney(parsed.data);

    if (result.found) {
      res.json({ legs: result.legs, totalFareZar: result.totalFareZar, legCount: result.legCount });
      return;
    }

    if (result.reason === 'unknown_rank') {
      res.status(404).json({ error: 'Unknown rank', message: `Rank ${result.detail}.` });
      return;
    }

    if (result.reason === 'bad_priority') {
      // Unreachable through the schema above; kept so a planner-side change
      // cannot turn into a silent 404.
      res.status(400).json({ error: 'Invalid priority', message: result.detail });
      return;
    }

    res.status(404).json({
      error: 'No route found',
      message:
        `No journey from "${parsed.data.fromRankId}" to "${parsed.data.toRankId}" ` +
        'exists in the current network (disconnected ranks or blocked routes).',
    });
  } catch (error) {
    sendDataLayerError(res, error);
  }
});

/**
 * Data-layer and engine failures, answered as a service problem with the
 * underlying message. PGRST205 / "does not exist" mean the Supabase schema is
 * not provisioned yet (migrations 0001+0002 + import:csir --push).
 */
function sendDataLayerError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const notProvisioned = /PGRST205|does not exist|Could not find the table/i.test(message);
  res.status(503).json({
    error: notProvisioned ? 'Data not provisioned' : 'Planning unavailable',
    message,
  });
}

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
  console.log(
    hasSupabaseCredentials
      ? 'Data source: Supabase'
      : 'Data source: none (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to use Supabase)',
  );
});
