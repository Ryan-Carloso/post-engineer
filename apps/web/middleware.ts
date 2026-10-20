import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

// auth-js reports these as { user: null, error } and does not clear the
// session. 429 is an AuthApiError; aborted fetches and 5xx (including
// Cloudflare 520-530) are AuthRetryableFetchError. A 307 to /landing on
// any of them sticks: the matcher excludes /landing, so a still-valid
// session never bounces back.
const TRANSIENT_AUTH_STATUSES: ReadonlySet<number> = new Set([
  429, 500, 501, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530,
])

function isTransientAuthError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if ('name' in error && error.name === 'AuthRetryableFetchError') return true
  return 'status' in error && typeof error.status === 'number' && TRANSIENT_AUTH_STATUSES.has(error.status)
}

function authErrorLogFields(error: unknown): { name: string; status: number | null } {
  if (typeof error !== 'object' || error === null) return { name: 'unknown', status: null }
  const name = 'name' in error && typeof error.name === 'string' ? error.name : 'unknown'
  const status = 'status' in error && typeof error.status === 'number' ? error.status : null
  return { name, status }
}

//---------------
// getSupabaseEnv — fail when the public Supabase env vars are missing
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
// Middleware — require a session on protected pages
//---------------

export async function middleware(request: NextRequest) {
  const { url, key } = getSupabaseEnv()

  // Create an unmodified response
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

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

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  // Public pages. .well-known (OAuth discovery/JWKS) and oauth/* handle
  // their own session: authorize/consent redirect to /login with `next`,
  // and token/register are public by spec.
  const publicPaths = ['/landing', '/login', '/privacy', '/terms'];
  const pathname = request.nextUrl.pathname;

  // No user on a protected page → /landing. A transient getUser failure
  // is not "logged out": the cookie is still there, and following the
  // redirect leaves the browser on /landing for the rest of the navigation.
  if (!user && !publicPaths.includes(pathname)) {
    if (!isTransientAuthError(error)) {
      return NextResponse.redirect(new URL('/landing', request.url))
    }
    // Name and status only. error.message can echo upstream response text.
    console.warn('[middleware] auth check failed transiently; continuing', {
      ...authErrorLogFields(error),
      pathname,
    })
  }

  // Authenticated visitor on the landing or login page → home
  if (user && (pathname === '/login' || pathname === '/landing')) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return response
}

//---------------
// Matcher — protected routes, excluding static files, API, and auth
//---------------

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - api/ (API routes)
     * - auth/ (auth callback)
     * - login, landing, privacy, terms (public pages)
     */
    '/((?!_next/static|_next/image|favicon.ico|api/|auth/|.well-known/|oauth/|login|landing|privacy|terms).*)',
  ],
}
