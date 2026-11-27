import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseRequestClient } from '@/lib/supabase/request-client'
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

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === PUBLIC_SITEMAP_PATH || PUBLIC_STATIC_ASSET_PATH.test(pathname) || pathname === PUBLIC_OPENAPI_SPEC_PATH || pathname === PUBLIC_MCP_PATH) {
    return NextResponse.next({
      request: {
        headers: request.headers,
      },
    });
  }

  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createSupabaseRequestClient(request, response)

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
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|gif|webp|svg|ico|txt|mp3|woff2?|ttf)$|sitemap\\.xml$|openapi\\.json$|mcp$|api/|auth/|.well-known/|oauth/|(?:login|landing|privacy|terms|recipes|s|docs|help|en/help)(?:/|$)).*)',
  ],
}
