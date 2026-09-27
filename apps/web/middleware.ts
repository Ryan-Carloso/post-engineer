import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

//---------------
// getSupabaseEnv — valida env vars sem fallback
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
// Middleware — valida sessão e redireciona
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
  } = await supabase.auth.getUser()

  // Rotas públicas — acessíveis sem autenticação.
  // .well-known (OAuth discovery/JWKS) e oauth/* cuidam da própria sessão:
  // authorize/consent redirecionam para /login com `next`, token/register
  // são públicos por especificação.
  const publicPaths = ['/landing', '/login', '/privacy', '/terms'];
  const pathname = request.nextUrl.pathname;

  // Se não autenticado e não está em rota pública → redireciona para a landing
  if (!user && !publicPaths.includes(pathname)) {
    return NextResponse.redirect(new URL('/landing', request.url))
  }

  // Se autenticado e está na landing ou no login → redireciona para home
  if (user && (pathname === '/login' || pathname === '/landing')) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return response
}

//---------------
// Matcher — rota protegida, exclui estáticos, API, auth
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
