// The Supabase clients for server code. There's no login, so plain clients are
// all the app needs. Each returns null when Supabase isn't set up, so callers
// can say "I can't check that right now" instead of crashing.
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig, supabaseSecretConfig } from "@/lib/supabase/config";

export {
  isRefundsConfigured,
  isSupabaseConfigured,
} from "@/lib/supabase/config";

/**
 * A Supabase client for server code that runs outside a request (a tool, a
 * Server Action). Returns null if Supabase isn't set up.
 * Example: const supabase = createStatelessClient(); if (!supabase) return null;
 */
export function createStatelessClient() {
  const config = supabaseConfig();
  return config
    ? createSupabaseClient(config.url, config.key, {
        auth: { persistSession: false },
      })
    : null;
}

/**
 * A Supabase client that can write, using the secret key. Server code only:
 * the refund flow uses it to record refunds. Returns null if the secret key
 * isn't set.
 */
export function createSecretClient() {
  const config = supabaseSecretConfig();
  return config
    ? createSupabaseClient(config.url, config.key, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
}
