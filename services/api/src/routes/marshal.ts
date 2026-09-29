import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../db';

const router = Router();

const routeCreateSchema = z.object({
    from_rank_id: z.string(),
    to_rank_id: z.string(),
    fare: z.number(),
    time_mins: z.number(),
    taxi_association: z.string().optional().default('Independent'),
});

// Create or update a route (edge)
router.put('/', async (req, res) => {
    if (!supabase) {
        return res.status(503).json({ error: 'Database not configured' });
    }

    const parsed = routeCreateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues });
    }

    const { error } = await supabase.from('routes').upsert(parsed.data);

    if (error) {
        return res.status(500).json({ error: 'Failed to save route', details: error.message });
    }

    res.json({ message: 'Route saved successfully' });
});

// Toggle block status (road block / strike)
router.patch('/:id/block', async (req, res) => {
    if (!supabase) {
        return res.status(503).json({ error: 'Database not configured' });
    }

    const { id } = req.params;
    const is_blocked = req.body.is_blocked;

    if (typeof is_blocked !== 'boolean') {
        return res.status(400).json({ error: 'is_blocked must be a boolean' });
    }

    const { error } = await supabase
        .from('routes')
        .update({ is_blocked })
        .eq('id', id);

    if (error) {
        return res.status(500).json({ error: 'Failed to update route', details: error.message });
    }

    res.json({ message: `Route block status updated to ${is_blocked}` });
});

export default router;