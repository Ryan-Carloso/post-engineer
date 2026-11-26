import 'server-only';

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { resolveApiKey, validateApiKeyFormat } from '@/lib/api-keys';
import { getOAuthKeys } from '@/lib/oauth/keys';
import { verifyAccessToken } from '@/lib/oauth/tokens';
import { getMcpResource } from '@/lib/oauth/config';
import { noteMcpToolCaller } from '@/lib/mcp-tool-telemetry';
import { checkMcpVersion } from '@/lib/mcp-version-gate';

interface SupabaseSessionAuth {
  userId: string;
  accessToken: string;
  isApiKey?: boolean;
  isOAuth?: boolean;
  keyId?: string;
  personaIds?: string[] | null;
  displayName?: string;
}

function displayNameFromUserMetadata(userMetadata: unknown): string | undefined {
  if (userMetadata === null || typeof userMetadata !== 'object' || Array.isArray(userMetadata)) {
    return undefined;
  }
  const metadata = userMetadata as Record<string, unknown>;
  for (const key of ['full_name', 'name', 'display_name', 'user_name']) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

export type SupabaseSessionAuthResult =
  | { auth: SupabaseSessionAuth; error: null }
  | { auth: null; error: NextResponse };

export async function requireSupabaseSession(request?: Request): Promise<SupabaseSessionAuthResult> {
  if (request) {
    const versionMismatch = checkMcpVersion(request);
    if (versionMismatch !== null) return { auth: null, error: versionMismatch };

    const authHeader = request.headers.get('authorization');
    const xApiKey = request.headers.get('x-api-key');
    let candidateKey: string | null = null;

    if (authHeader?.startsWith('Bearer ')) {
      candidateKey = authHeader.slice(7).trim();
    } else if (xApiKey) {
      candidateKey = xApiKey.trim();
    }

    if (candidateKey && validateApiKeyFormat(candidateKey)) {
      const serviceClient = createSupabaseServiceClient();
      const resolved = await resolveApiKey(candidateKey, serviceClient);
      if (!resolved) {
        return {
          auth: null,
          error: NextResponse.json(
            { success: false, error: 'Invalid API key.' },
            { status: 401 },
          ),
        };
      }
      noteMcpToolCaller(request, resolved.userId, 'api_key');
      return {
        auth: {
          userId: resolved.userId,
          accessToken: candidateKey,
          isApiKey: true,
          keyId: resolved.keyId,
          personaIds: resolved.personaIds,
        },
        error: null,
      };
    }

    if (candidateKey && looksLikeJwt(candidateKey)) {
      const oauth = await resolveOAuthAccessToken(candidateKey);
      if (oauth) {
        noteMcpToolCaller(request, oauth.userId, 'oauth');
        return { auth: oauth, error: null };
      }
    }
  }

  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId: unknown = claims?.sub;
  if (claimsError !== null || claims === undefined || typeof userId !== 'string' || userId.length === 0) {
    return unauthorized();
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    return unauthorized();
  }

  return {
    auth: {
      userId,
      accessToken,
      displayName: displayNameFromUserMetadata(claims.user_metadata),
    },
    error: null,
  };
}

function looksLikeJwt(value: string): boolean {
  return value.split('.').length === 3;
}

async function resolveOAuthAccessToken(
  candidateKey: string,
): Promise<SupabaseSessionAuth | null> {
  try {
    const keys = await getOAuthKeys();
    const claims = await verifyAccessToken(keys, candidateKey, { resource: getMcpResource() });
    return { userId: claims.sub, accessToken: candidateKey, isOAuth: true };
  } catch {
    return null;
  }
}

function unauthorized(): SupabaseSessionAuthResult {
  return {
    auth: null,
    error: NextResponse.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    ),
  };
}

export function engineAuthHeaders(userId: string): Record<string, string> {
  const secret = process.env.MONEYPRINT_API_SECRET;
  if (!secret) {
    throw new Error('MONEYPRINT_API_SECRET is not defined');
  }
  return {
    Authorization: `Bearer ${secret}`,
    'x-user-id': userId,
  };
}
