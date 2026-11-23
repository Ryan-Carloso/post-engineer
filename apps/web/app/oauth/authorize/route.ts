import { NextResponse } from 'next/server';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { parseAuthorizeRequest, buildErrorRedirect } from '@/lib/oauth/authorize';
import { REDIRECT_URI_NOT_ALLOWED } from '@/lib/oauth/redirect-uri';
import { getOAuthKeys } from '@/lib/oauth/keys';
import { mintConsentRequest } from '@/lib/oauth/tokens';
import { getIssuer } from '@/lib/oauth/config';

export async function GET(request: Request): Promise<NextResponse> {
  const limited = await applyRateLimit(request, RATE_LIMITS.oauthAuthorize);
  if (limited) return limited;
  const url = new URL(request.url);
  const service = createSupabaseServiceClient();
  const validation = await parseAuthorizeRequest(url, service);

  if (!validation.ok) {
    if (validation.redirectUri) {
      const target = buildErrorRedirect(
        validation.redirectUri,
        validation.error,
        validation.state,
        validation.description,
      );
      if (target === null) {
        return NextResponse.json({ error: REDIRECT_URI_NOT_ALLOWED }, { status: 400 });
      }
      return NextResponse.redirect(target);
    }
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const login = new URL('/login', getIssuer());
    login.searchParams.set('next', `${url.pathname}${url.search}`);
    return NextResponse.redirect(login);
  }

  const keys = await getOAuthKeys();
  const consent = await mintConsentRequest(keys, {
    sub: user.id,
    ...validation.params,
    scope: validation.params.scope.join(' '),
  });
  const consentUrl = new URL('/oauth/consent', getIssuer());
  consentUrl.searchParams.set('request', consent);
  return NextResponse.redirect(consentUrl);
}
