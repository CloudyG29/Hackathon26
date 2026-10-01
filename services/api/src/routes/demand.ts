import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../db';

const router = Router();

/**
 * One "I want to travel" signal for a corridor.
 *
 * The deployed Supabase project's demand_signals table is
 * (id, user_id, from_rank_id, to_rank_id, timestamp) — snake_case, no SQL
 * aggregation functions. The supabase/migrations folder describes a later
 * schema revision that has not been applied there yet, so this route speaks
 * the deployed shape.
 */
const demandSchema = z.object({
    from_rank_id: z.string().min(1),
    to_rank_id: z.string().min(1),
    user_id: z.string().min(1).optional(),
});

// Record commuter demand
router.post('/', async (req, res) => {
    if (!supabase) {
        return res.status(503).json({ error: 'Database not configured' });
    }

    const parsed = demandSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues });
    }

    const { from_rank_id, to_rank_id, user_id } = parsed.data;
    const { error } = await supabase.from('demand_signals').insert({
        user_id: user_id ?? 'transitguide-mobile',
        from_rank_id,
        to_rank_id,
    });

    if (error) {
        return res.status(500).json({ error: 'Failed to record demand', details: error.message });
    }

    res.status(201).json({ message: 'Demand signal recorded' });
});

// Fetch aggregated demand signals: one entry per corridor, busiest first.
router.get('/', async (req, res) => {
    if (!supabase) {
        return res.status(503).json({ error: 'Database not configured' });
    }

    const requested = Number.parseInt(String(req.query.hours ?? '24'), 10);
    const hours = Number.isFinite(requested) && requested > 0 ? requested : 24;
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
        .from('demand_signals')
        .select('from_rank_id, to_rank_id')
        .gte('timestamp', cutoffTime);

    if (error) {
        return res.status(500).json({ error: 'Failed to fetch demand', details: error.message });
    }

    const counts: Record<string, number> = {};
    data?.forEach((signal) => {
        const key = `${signal.from_rank_id}->${signal.to_rank_id}`;
        counts[key] = (counts[key] || 0) + 1;
    });

    const entries = Object.entries(counts)
        .map(([key, count]) => {
            const [from, to] = key.split('->');
            return { from_rank_id: from, to_rank_id: to, signal_count: count };
        })
        .sort((a, b) => b.signal_count - a.signal_count);

    res.json(entries);
});

export default router;
