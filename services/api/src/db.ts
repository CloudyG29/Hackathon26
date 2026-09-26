import { createClient } from '@supabase/supabase-js';
import { config, hasSupabaseCredentials } from './config';

/**
 * Server-side Supabase client, or null when env vars are missing so the API can
 * still boot against local fixtures during development.
 *
 * Uses the service-role key to sidestep row-level security for the hackathon.
 * Before real users touch this, switch to per-request clients carrying the
 * caller's access token.
 */
export const supabase = hasSupabaseCredentials
  ? createClient(config.supabaseUrl!, config.supabaseServiceRoleKey!, {
      auth: { persistSession: false },
    })
  : null;
