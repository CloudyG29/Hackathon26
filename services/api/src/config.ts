/** Runtime configuration, read once at boot. */

export const config = {
  port: Number(process.env.PORT ?? 4000),
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
} as const;

/** True when the API has enough credentials to talk to Supabase. */
export const hasSupabaseCredentials = Boolean(
  config.supabaseUrl && config.supabaseServiceRoleKey,
);
