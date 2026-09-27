import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { isCimdClientId, fetchCimdDocument } from './clients';

//---------------
// resolveClient — DCR first (database), CIMD second (fetch, stateless).
// Returns null when the client is unknown or the document is invalid.
//---------------

export interface ResolvedOAuthClient {
  clientName: string;
  redirectUris: string[];
}

interface DcrRow {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[] | null;
}

export async function resolveClient(
  clientId: string,
  supabase: SupabaseClient,
): Promise<ResolvedOAuthClient | null> {
  if (isCimdClientId(clientId)) {
    const document = await fetchCimdDocument(clientId);
    if (!document) return null;
    return { clientName: 'MCP client', redirectUris: document.redirect_uris };
  }

  const { data, error } = await supabase
    .from('mcp_oauth_clients')
    .select('client_id, client_name, redirect_uris')
    .eq('client_id', clientId)
    .single();

  if (error || !data) return null;
  const row = data as DcrRow;
  if (!Array.isArray(row.redirect_uris) || row.redirect_uris.length === 0) return null;
  return {
    clientName: row.client_name ?? 'MCP client',
    redirectUris: row.redirect_uris,
  };
}
