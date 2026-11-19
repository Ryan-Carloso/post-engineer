import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { isLocalHostname } from '@/lib/oauth-utils'
import { isOwnVercelPreviewHost } from '@/lib/vercel-preview-host'

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

function isLocalDevUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (
      parsed.protocol === 'http:' &&
      isLocalHostname(parsed.hostname)
    )
  } catch {
    return false
  }
}

function isVercelPreviewUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (
      parsed.protocol === 'https:' &&
      isOwnVercelPreviewHost(parsed.hostname) &&
      parsed.pathname === '/auth/callback'
    )
  } catch {
    return false
  }
}

export function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/';
  }
  try {
    const dummy = new URL(value, 'http://localhost');
    if (dummy.origin !== 'http://localhost') return '/';
    return value;
  } catch {
    return '/';
  }
}

function isCodeRelayTarget(value: string): boolean {
  try {
    const parsed = new URL(value)
    if (parsed.pathname !== '/auth/callback') return false
    return isLocalDevUrl(value) || isVercelPreviewUrl(value)
  } catch {
    return false
  }
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
