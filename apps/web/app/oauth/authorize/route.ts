import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { parseAuthorizeRequest, buildErrorRedirect } from '@/lib/oauth/authorize';
import { getOAuthKeys } from '@/lib/oauth/keys';
import { mintConsentRequest } from '@/lib/oauth/tokens';
import { getIssuer } from '@/lib/oauth/config';

//---------------
// GET /oauth/authorize — ponto de entrada do fluxo OAuth (response_type=code
// + PKCE S256 + resource). Sem sessão → /login com `next` para retomar.
// Com sessão → consentimento em /oauth/consent com pedido assinado.
//---------------

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const service = createSupabaseServiceClient();
  const validation = await parseAuthorizeRequest(url, service);

  if (!validation.ok) {
    if (validation.redirectUri) {
      return NextResponse.redirect(
        buildErrorRedirect(
          validation.redirectUri,
          validation.error,
          validation.state,
          validation.description,
        ),
      );
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
