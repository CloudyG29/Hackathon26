import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { z } from 'zod';
import type { HealthResponse, PlanRouteRequest } from '@hackathon26/shared';
import { config, hasSupabaseCredentials } from './config';
import { supabase } from './db';

const ROUTING_SERVICE_URL = process.env.ROUTING_SERVICE_URL || 'http://localhost:8000';
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

app.post('/routes/plan', async (req, res) => {
  const parsed = planRouteRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', issues: parsed.error.issues });
    return;
  }

  const request: PlanRouteRequest = parsed.data;

  // Resolve Rank IDs from schema
  const originRankId = request.origin.rankId || request.origin.label;
  const destinationRankId = request.destination.rankId || request.destination.label;
  const primaryPriority = request.priorities?.[0] || 'cheapest';

  try {
    // 1. Fetch Ranks (Nodes) from Supabase
    const { data: ranks, error: ranksError } = await supabase
      .from('ranks')
      .select('id, name, lat, lng');

    if (ranksError) throw ranksError;

    // 2. Fetch Unblocked Routes (Edges) from Supabase
    const { data: routes, error: routesError } = await supabase
      .from('routes')
      .select('id, from_rank_id, to_rank_id, fare, time_mins, taxi_association')
      .eq('is_blocked', false);

    if (routesError) throw routesError;

    // 3. Call Python Routing Microservice
    const pythonResponse = await fetch(`${ROUTING_SERVICE_URL}/calculate_route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodes: ranks,
        edges: routes,
        from_rank_id: originRankId,
        to_rank_id: destinationRankId,
        priority: primaryPriority,
      }),
    });

    if (!pythonResponse.ok) {
      throw new Error(`Routing engine error: ${pythonResponse.statusText}`);
    }

    const routeResult = await pythonResponse.json();

    if (routeResult.error) {
      res.status(404).json({ error: routeResult.error, legs: [] });
      return;
    }

    res.json(routeResult);
  } catch (error: any) {
    console.error('Route planning failure:', error.message || error);
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