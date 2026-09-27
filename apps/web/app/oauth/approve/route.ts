import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getOAuthKeys } from '@/lib/oauth/keys';
import { verifyConsentRequest, mintAuthorizationCode } from '@/lib/oauth/tokens';

//---------------
// POST /oauth/approve — decisão do consentimento (form da página
// /oauth/consent). Aprova → authorization code no redirect_uri. Nega →
// error=access_denied. O pedido é um JWT assinado: nada de estado no banco.
//---------------

function errorRedirect(redirectUri: string, error: string, state: string): NextResponse {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  url.searchParams.set('state', state);
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
    return errorRedirect(claims.redirectUri, 'access_denied', claims.state);
  }

  const code = await mintAuthorizationCode(keys, {
    sub: claims.sub,
    clientId: claims.clientId,
    redirectUri: claims.redirectUri,
    scope: claims.scope,
    resource: claims.resource,
    codeChallenge: claims.codeChallenge,
  });
  const url = new URL(claims.redirectUri);
  url.searchParams.set('code', code);
  url.searchParams.set('state', claims.state);
  return NextResponse.redirect(url);
}
