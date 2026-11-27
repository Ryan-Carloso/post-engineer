import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseRequestClient } from '@/lib/supabase/request-client'
import { getSupabaseEnv } from '@/lib/supabase/env'
import { isCodeRelayTarget } from '@/lib/auth-code-relay'
import { safeNextPath } from '@/lib/safe-next-path'
import { sameOriginRedirect } from '@/lib/same-origin-redirect'

export async function GET(request: NextRequest) {
  getSupabaseEnv()
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const rawNext = requestUrl.searchParams.get('next') ?? '/'

  const oauthError = requestUrl.searchParams.get('error')
  if (oauthError) {
    const cancelled = oauthError === 'access_denied'
    return sameOriginRedirect(cancelled ? '/login?error=cancelled' : '/login?error=auth')
  }

  if (code) {
    if (isCodeRelayTarget(rawNext)) {
      const relayUrl = new URL(rawNext)
      relayUrl.searchParams.set('code', code)
      return NextResponse.redirect(relayUrl.toString())
    }

    const next = safeNextPath(rawNext)
    const response = sameOriginRedirect(next)

    const supabase = createSupabaseRequestClient(request, response)

    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return response
    }
  }

  return sameOriginRedirect('/login?error=auth')
}
