import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { z } from 'zod';
import type { HealthResponse, PlanRouteRequest } from '@hackathon26/shared';
import { config, hasSupabaseCredentials } from './config';

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

app.get('/health', (_req, res) => {
  const body: HealthResponse = {
    status: 'ok',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    dataSource: hasSupabaseCredentials ? 'supabase' : 'fixtures',
  };
  res.json(body);
});

/**
 * Route planning contract.
 *
 * Request validation is wired up end to end, but the ranking engine is not
 * built yet — graph search belongs in services/routing. See
 * docs/ARCHITECTURE.md for the intended data flow.
 */
app.post('/routes/plan', (req, res) => {
  const parsed = planRouteRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', issues: parsed.error.issues });
    return;
  }

  const request: PlanRouteRequest = parsed.data;

  res.status(501).json({
    error: 'Not implemented',
    message:
      `Route planning from "${request.origin.label}" to ` +
      `"${request.destination.label}" is not wired up yet.`,
  });
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
