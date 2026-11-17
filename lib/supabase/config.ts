// Supabase is optional: every helper returns null when it isn't set up, so the
// app still builds and renders without environment variables.
export function supabaseConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

export function isSupabaseConfigured(): boolean {
  return supabaseConfig() !== null;
}

/**
 * The server-only settings for writing refunds. SUPABASE_SECRET_KEY has no
 * NEXT_PUBLIC_ prefix, so Next.js never sends it to the browser.
 */
export function supabaseSecretConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  return url && key ? { url, key } : null;
}

/** True when the refund flow can read and write its tables. */
export function isRefundsConfigured(): boolean {
  return supabaseSecretConfig() !== null;
}
