import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { z } from 'zod';
import type { HealthResponse, PlanRouteRequest } from '@hackathon26/shared';
import { config, hasSupabaseCredentials } from './config';
import { PlanError, planRoute } from './planner';
import demandRoutes from './routes/demand';
import marshalRoutes from './routes/marshal';

const ROUTE_PRIORITIES = ['cheapest', 'fastest', 'easiest', 'safest'] as const;

const geoPointSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

const journeyEndpointSchema = z.object({
  label: z.string().min(1),
  rankId: z.string().min(1).optional(),
  location: geoPointSchema.optional(),
});

const planRouteRequestSchema = z.object({
  origin: journeyEndpointSchema,
  destination: journeyEndpointSchema,
  /** ISO-8601 instant, e.g. "2026-09-26T06:30:00+02:00". */
  departAt: z.string().min(1).optional(),
  priorities: z.array(z.enum(ROUTE_PRIORITIES)).optional(),
});

const app = express();
const startedAt = Date.now();

app.use(cors());
app.use(express.json());

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

app.post('/routes/plan', async (req, res) => {
  const parsed = planRouteRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', issues: parsed.error.issues });
    return;
  }

  const request: PlanRouteRequest = parsed.data;

  try {
    const plan = await planRoute({
      fromRankId: request.origin.rankId || request.origin.label,
      toRankId: request.destination.rankId || request.destination.label,
      priorities: request.priorities,
    });
    res.json(plan);
  } catch (error) {
    if (error instanceof PlanError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('Route planning failure:', error);
    res.status(500).json({ error: 'Failed to calculate route.' });
  }
});

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