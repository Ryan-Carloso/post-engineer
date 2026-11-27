import 'server-only';

import type { NextRequest } from 'next/server';
import { resolveOAuthCallbackAuth } from '@/lib/oauth-connect';
import { sessionUserId } from '@/lib/oauth/session-user';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

type CallbackProvider = Parameters<typeof resolveOAuthCallbackAuth>[4];

export type SocialCallback =
  | { ok: true; code: string; userId: string; redirectUri?: string; codeVerifier?: string }
  | { ok: false; error: string };

export async function readSocialCallback(
  request: NextRequest,
  provider: CallbackProvider,
  deniedMessage: string,
): Promise<SocialCallback> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  if (searchParams.get('error')) return { ok: false, error: deniedMessage };
  if (!code) return { ok: false, error: 'Missing authorization code' };

  const auth = await resolveOAuthCallbackAuth(
    request,
    searchParams.get('state'),
    await sessionUserId(),
    () => createSupabaseServiceClient(),
    provider
  );
  if (!auth.ok) return { ok: false, error: auth.error };
  return { ok: true, code, userId: auth.userId, redirectUri: auth.redirectUri, codeVerifier: auth.codeVerifier };
}
