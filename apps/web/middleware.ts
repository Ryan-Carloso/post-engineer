import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

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

function hasSubjectClaim(claims: unknown): boolean {
  if (typeof claims !== 'object' || claims === null) return false
  return 'sub' in claims && typeof claims.sub === 'string' && claims.sub.length > 0
}

export const PUBLIC_STATIC_ASSET_PATH = /\.(?:png|jpe?g|gif|webp|svg|ico|txt|mp3|woff2?|ttf)$/i;
const PUBLIC_SITEMAP_PATH = '/sitemap.xml';
const PUBLIC_OPENAPI_SPEC_PATH = '/openapi.json';
const PUBLIC_MCP_PATH = '/mcp';

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

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === PUBLIC_SITEMAP_PATH || PUBLIC_STATIC_ASSET_PATH.test(pathname) || pathname === PUBLIC_OPENAPI_SPEC_PATH || pathname === PUBLIC_MCP_PATH) {
    return NextResponse.next({
      request: {
        headers: request.headers,
      },
    });
  }

  const { url, key } = getSupabaseEnv()

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

  const { data, error } = await supabase.auth.getClaims()
  const signedIn = hasSubjectClaim(data?.claims)

  const publicPaths = ['/landing', '/login', '/privacy', '/terms', '/recipes', '/s'];

  const isPublicPath = publicPaths.some(
    (publicPath) => pathname === publicPath || pathname.startsWith(`${publicPath}/`),
  );

  if (!signedIn && !isPublicPath) {
    if (!isTransientAuthError(error)) {
      return NextResponse.redirect(new URL('/landing', request.url))
    }
    console.warn('[middleware] auth check failed transiently; continuing', {
      ...authErrorLogFields(error),
      pathname,
    })
  }

  if (signedIn && (pathname === '/login' || pathname === '/landing')) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|gif|webp|svg|ico|txt|mp3|woff2?|ttf)$|sitemap\\.xml$|openapi\\.json$|mcp$|api/|auth/|.well-known/|oauth/|login|landing|privacy|terms|recipes|s/).*)',
  ],
}
