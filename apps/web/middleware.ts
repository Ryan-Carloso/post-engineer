import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { authErrorLogFields, isTransientAuthError } from '@/lib/auth-error'
import { isProtectedPath } from '@/lib/protected-routes'

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

  if (!signedIn && isProtectedPath(pathname)) {
    if (!isTransientAuthError(error)) {
      return NextResponse.redirect(new URL('/landing', request.url))
    }
    console.warn('[middleware] auth check failed transiently; continuing', {
      ...authErrorLogFields(error),
      pathname,
    })
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|gif|webp|svg|ico|txt|mp3|woff2?|ttf)$|sitemap\\.xml$|openapi\\.json$|mcp$|api/|auth/|.well-known/|oauth/|(?:login|landing|privacy|terms|recipes|s)(?:/|$)).*)',
  ],
}
