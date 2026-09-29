/** Runtime configuration, read once at boot. */

/**
 * Secret key: Supabase renamed the legacy "service_role" key to "secret"
 * (sb_secret_...). Accept either name so old and new projects both work.
 */
const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

export const config = {
  port: Number(process.env.PORT ?? 4000),
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: supabaseSecretKey,
  /** Publishable key (legacy "anon") - for future client-side auth use. */
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
  /** JSON Web Key Set, for verifying user JWTs if we add auth. */
  supabaseJwksUrl: process.env.SUPABASE_JWKS_URL,
  /**
   * Python executable for the services/routing planner, spawned per
   * POST /routes/plan request. Override when `python` is not on PATH
   * (e.g. "py" or a virtualenv interpreter).
   */
  routingPython: process.env.ROUTING_PYTHON ?? 'python',
} as const;

/** True when the API has enough credentials to talk to Supabase. */
export const hasSupabaseCredentials = Boolean(
  config.supabaseUrl && config.supabaseServiceRoleKey,
);
