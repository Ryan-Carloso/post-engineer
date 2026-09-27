import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { isLocalHostname } from '@/lib/oauth-utils'
import { isOwnVercelPreviewHost } from '@/lib/vercel-preview-host'

//---------------
// getSupabaseEnv — validates env vars, no fallback
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
// isLocalDevUrl — only relays the code to local hosts (IPv4/IPv6).
//---------------

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

//---------------
// isVercelPreviewUrl — relays the code to THIS project's Vercel preview
// deployments (ownership check lives in lib/vercel-preview-host.ts). Only
// https and the exact /auth/callback path: the code is never relayed to
// another path, to third-party *.vercel.app hosts, or to lookalike domains.
//---------------

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

//---------------
// safeNextPath — the `next` param may only be a same-origin relative path
// (starts with '/', never '//' or backslashes which browsers normalize as
// protocol-relative / host escapes). Absolute or schemed URLs are rejected:
// without this check, `next` would be an open redirect. Separately validated
// code-relay targets (isCodeRelayTarget: local dev and this project's own
// Vercel previews) keep their exact URL so the code can be relayed intact.
//---------------

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

//---------------
// isCodeRelayTarget — destinations the code may be relayed to intact
// (without exchanging it for a session here): localhost (dev) and this
// project's Vercel previews. In both cases the path must be /auth/callback —
// the code only ever goes back to this app's own callback route.
//---------------

function isCodeRelayTarget(value: string): boolean {
  try {
    const parsed = new URL(value)
    if (parsed.pathname !== '/auth/callback') return false
    return isLocalDevUrl(value) || isVercelPreviewUrl(value)
  } catch {
    return false
  }
}

//---------------
// GET /auth/callback — exchanges the code for a session, writes cookies and
// redirects. When the flow started on local dev, relays the code intact to
// localhost.
//---------------

export async function GET(request: NextRequest) {
  const { url, key } = getSupabaseEnv()
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const rawNext = requestUrl.searchParams.get('next') ?? '/'

  //---------------
  // Cancelled/denied flow at the provider (e.g. the user clicked "Cancel"
  // on GitHub): returns with no code and ?error=access_denied. Distinguishes
  // cancellation from a technical error so the login screen can explain.
  //---------------
  const oauthError = requestUrl.searchParams.get('error')
  if (oauthError) {
    const cancelled = oauthError === 'access_denied'
    return NextResponse.redirect(
      new URL(cancelled ? '/login?error=cancelled' : '/login?error=auth', request.url),
    )
  }

  if (code) {
    // The flow may have started on local dev or a Vercel preview: relay the
    // code intact to the same origin that started the login — it exchanges
    // the code for the session with its own PKCE verifier (its cookie).
    if (isCodeRelayTarget(rawNext)) {
      const relayUrl = new URL(rawNext)
      relayUrl.searchParams.set('code', code)
      return NextResponse.redirect(relayUrl.toString())
    }

    // Any other `next` must be a safe same-origin relative path — absolute
    // URLs (open redirect) fall back to '/'.
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
