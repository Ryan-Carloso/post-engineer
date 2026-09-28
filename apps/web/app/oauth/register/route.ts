import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { validateDcrMetadata } from '@/lib/oauth/clients';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

//---------------
// POST /oauth/register — Dynamic Client Registration (RFC 7591).
// Public clients (ChatGPT/Codex) register without a secret
// (token_endpoint_auth_method: none) and receive a persisted client_id.
// CIMD (client_id = https URL) does not need to register.
//---------------

export async function POST(request: Request): Promise<NextResponse> {
  const limited = await applyRateLimit(request, RATE_LIMITS.oauthRegister);
  if (limited) return limited;

  let body: unknown;
  try {
    body = (await request.json()) as unknown;
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const validation = validateDcrMetadata(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const clientId = `mcp_client_${randomBytes(16).toString('hex')}`;
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from('mcp_oauth_clients').insert({
    client_id: clientId,
    client_name: validation.clientName,
    redirect_uris: validation.redirectUris,
  });

  if (error) {
    logger.error('[oauth/register] client registration failed', error);
    return NextResponse.json({ error: 'Failed to register client.' }, { status: 500 });
  }

  return NextResponse.json(
    {
      client_id: clientId,
      client_name: validation.clientName,
      redirect_uris: validation.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    { status: 201 },
  );
}
