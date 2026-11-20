import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getOAuthKeys } from '@/lib/oauth/keys';
import { verifyConsentRequest, mintAuthorizationCode } from '@/lib/oauth/tokens';
import { clientRedirectUrl, REDIRECT_URI_NOT_ALLOWED } from '@/lib/oauth/redirect-uri';

function redirectToClient(
  redirectUri: string,
  params: Record<string, string | undefined>,
): NextResponse {
  const url = clientRedirectUrl(redirectUri, params);
  if (url === null) {
    return NextResponse.json({ error: REDIRECT_URI_NOT_ALLOWED }, { status: 400 });
  }
  return NextResponse.redirect(url);
}

export async function POST(request: Request): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form body.' }, { status: 400 });
  }

  const token = form.get('request');
  const decision = form.get('decision');
  if (typeof token !== 'string' || token.length === 0) {
    return NextResponse.json({ error: 'Missing consent request.' }, { status: 400 });
  }

  const keys = await getOAuthKeys();
  const claims = await verifyConsentRequest(keys, token).catch(() => null);
  if (!claims) {
    return NextResponse.json({ error: 'Invalid or expired consent request.' }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== claims.sub) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  if (decision !== 'approve') {
    return redirectToClient(claims.redirectUri, { error: 'access_denied', state: claims.state });
  }

  const code = await mintAuthorizationCode(keys, {
    sub: claims.sub,
    clientId: claims.clientId,
    redirectUri: claims.redirectUri,
    scope: claims.scope,
    resource: claims.resource,
    codeChallenge: claims.codeChallenge,
  });
  return redirectToClient(claims.redirectUri, { code, state: claims.state });
}
