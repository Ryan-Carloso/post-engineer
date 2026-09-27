import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

//---------------
// createSupabaseServiceClient — service_role client (server-only)
// WARNING: service_role BYPASSES all Row Level Security policies.
// Use ONLY on internal routes (engine, webhook) and ALWAYS filter by
// user_id on every query. A forgotten .eq('user_id', ...) = a data leak
// of all users' data. Prefer createSupabaseServerClient
// (per-session RLS) whenever the request has session cookies.
//---------------

function getServiceEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not defined')
  }
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not defined')
  }

  return { url, serviceKey }
}

let cachedClient: SupabaseClient | null = null

export function createSupabaseServiceClient(): SupabaseClient {
  if (cachedClient) return cachedClient

  const { url, serviceKey } = getServiceEnv()

  cachedClient = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  return cachedClient
}