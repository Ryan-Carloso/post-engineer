import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.gen'

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

let cachedClient: SupabaseClient<Database> | null = null

export function createSupabaseServiceClient(): SupabaseClient<Database> {
  if (cachedClient) return cachedClient

  const { url, serviceKey } = getServiceEnv()

  cachedClient = createClient<Database>(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  return cachedClient
}