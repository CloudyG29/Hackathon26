import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../db';

const router = Router();

const demandSchema = z.object({
    user_id: z.string(),
    from_rank_id: z.string(),
    to_rank_id: z.string(),
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

    const { error } = await supabase.from('demand_signals').insert(parsed.data);

    if (error) {
        return res.status(500).json({ error: 'Failed to record demand', details: error.message });
    }

    res.json({ message: 'Demand signal recorded' });
});

// Fetch aggregated demand signals
router.get('/', async (req, res) => {
    if (!supabase) {
        return res.status(503).json({ error: 'Database not configured' });
    }

    const hours = parseInt((req.query.hours as string) || '24', 10);
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

    const formattedResponse = Object.entries(counts)
        .map(([key, count]) => {
            const [from, to] = key.split('->');
            return { from_rank_id: from, to_rank_id: to, signal_count: count };
        })
        .sort((a, b) => b.signal_count - a.signal_count);

    res.json(formattedResponse);
});

export default router;