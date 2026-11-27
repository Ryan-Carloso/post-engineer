import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseEnv } from '@/lib/supabase/env'

export function createSupabaseClient() {
  const { url, key } = getSupabaseEnv()

  return createBrowserClient(url, key)
}
