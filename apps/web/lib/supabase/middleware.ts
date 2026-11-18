import 'server-only';

import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from './server'

export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    await supabase.auth.getSession()
  }

  return { response, user }
}
