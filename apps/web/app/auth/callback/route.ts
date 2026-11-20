import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { isCodeRelayTarget } from '@/lib/auth-code-relay'
import { safeNextPath } from '@/lib/safe-next-path'

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

export async function GET(request: NextRequest) {
  const { url, key } = getSupabaseEnv()
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const rawNext = requestUrl.searchParams.get('next') ?? '/'

  const oauthError = requestUrl.searchParams.get('error')
  if (oauthError) {
    const cancelled = oauthError === 'access_denied'
    return NextResponse.redirect(
      new URL(cancelled ? '/login?error=cancelled' : '/login?error=auth', request.url),
    )
  }

  if (code) {
    if (isCodeRelayTarget(rawNext)) {
      const relayUrl = new URL(rawNext)
      relayUrl.searchParams.set('code', code)
      return NextResponse.redirect(relayUrl.toString())
    }

    const next = safeNextPath(rawNext)
    const response = NextResponse.redirect(new URL(next, request.url))

    const supabase = createServerClient(url, key, {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          })
          response.cookies.set({
            name,
            value,
            ...options,
          })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          })
          response.cookies.set({
            name,
            value: '',
            ...options,
          })
        },
      },
    })

    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return response
    }
  }

  return NextResponse.redirect(new URL('/login?error=auth', request.url))
}
