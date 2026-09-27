import { createBrowserClient } from '@supabase/ssr'

//---------------
// getSupabaseEnv — validates env vars with no fallback
//---------------

function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not defined')
  }
  if (!key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not defined')
  }

  return { url, key }
}

//---------------
// createSupabaseClient — browser client (client-side)
//---------------

export function createSupabaseClient() {
  const { url, key } = getSupabaseEnv()

  return createBrowserClient(url, key)
}
