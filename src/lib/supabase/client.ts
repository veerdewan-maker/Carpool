"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./env";

let client: SupabaseClient | null = null;

/** Browser-side Supabase client (singleton). Throws if env is missing. */
export function supabase(): SupabaseClient {
  if (client) return client;
  const env = getSupabaseEnv();
  if (!env) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local and fill in your project URL and key."
    );
  }
  client = createBrowserClient(env.url, env.key);
  return client;
}
