import type { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { getSupabaseEnv } from '@/lib/supabase/env'

export function createSupabaseRequestClient(request: NextRequest, response: NextResponse): ReturnType<typeof createServerClient> {
  const { url, key } = getSupabaseEnv()
  const write = (name: string, value: string, options: CookieOptions): void => {
    request.cookies.set({ name, value, ...options })
    response.cookies.set({ name, value, ...options })
  }
  return createServerClient(url, key, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value
      },
      set(name: string, value: string, options: CookieOptions) {
        write(name, value, options)
      },
      remove(name: string, options: CookieOptions) {
        write(name, '', options)
      },
    },
  })
}
