import 'dotenv/config';
import cors from 'cors';
import express, { type Response } from 'express';
import { z } from 'zod';
import type { HealthResponse, PlanPriority, PlanResult } from '@hackathon26/shared';
import { config, hasSupabaseCredentials } from './config';
import { PlanError, planRoute } from './planner';
import { fetchRanks } from './ranks';
import demandRoutes from './routes/demand';
import marshalRoutes from './routes/marshal';

/** Runtime copy of the shared PlanPriority union, kept in sync by `satisfies`. */
const PLAN_PRIORITIES = [
  'cheapest',
  'fastest',
  'easiest',
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

// Marshal (strike toggles) and commuter-demand endpoints.
app.use('/demand', demandRoutes);
app.use('/marshal', marshalRoutes);

app.get('/health', (_req, res) => {
  const body: HealthResponse = {
    status: 'ok',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    dataSource: hasSupabaseCredentials ? 'supabase' : 'fixtures',
  };
  res.json(body);
});

/**
 * Rank lookup for the search box: ?q=<fragment> matches rank names or their
 * town/city (partial, case-insensitive) so "Pretoria" or "Temba" works too;
 * no query returns the full list for the initial autocomplete population.
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

  const { fromRankId, toRankId } = parsed.data;
  // The planner engine returns one option per requested priority; the app
  // asks for exactly one, so that single option is the response.
  const priority: PlanPriority = parsed.data.priority ?? 'cheapest';

  try {
    const plan = await planRoute({ fromRankId, toRankId, priorities: [priority] });
    const option = plan.options[0]!;
    const result: PlanResult = {
      legs: option.legs,
      totalFareZar: option.totalFareZar,
      legCount: option.legs.length,
    };
    res.json(result);
  } catch (error) {
    if (error instanceof PlanError) {
      res.status(error.status).json({
        error: error.status === 404 ? 'No route found' : 'Planning unavailable',
        message: error.message,
      });
      return;
    }
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
