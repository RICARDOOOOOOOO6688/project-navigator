// Service-role Supabase client for the AI Gateway (server-only).
//
// The gateway reads control-plane config (workflows/models/user_quotas) and
// writes run records (activity_events), which the user-scoped client cannot do
// under RLS. Every query still filters by user_id explicitly.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _db: SupabaseClient | undefined;

export function gatewayDb(): SupabaseClient {
  if (!_db) {
    const url = process.env["SUPABASE_URL"] ?? import.meta.env["VITE_SUPABASE_URL"];
    const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!url || !key) {
      throw new Error("AI Gateway misconfigured: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    }
    _db = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _db;
}
