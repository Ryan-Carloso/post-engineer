import type { PostEngineerClient } from './client.js';

//---------------
// Per-persona default publishing accounts (issue #212) — HTTP calls.
//
// Extracted from client.ts so the client module stays under the file-size
// ratchet. These are standalone functions (not methods) because the client
// class is grandfathered over the 500-line cap and may not grow.
//---------------

export async function getPersonaPublishingAccounts(
  client: PostEngineerClient,
  personaId: string,
): Promise<unknown> {
  return client.request(
    `/api/persona/publishing-accounts?personaId=${encodeURIComponent(personaId)}`,
    { method: 'GET', headers: client.getHeaders() },
    'get persona publishing accounts',
  );
}

export async function setPersonaPublishingAccounts(
  client: PostEngineerClient,
  personaId: string,
  accounts: Record<string, string[]>,
): Promise<unknown> {
  return client.request(
    `/api/persona/publishing-accounts?personaId=${encodeURIComponent(personaId)}`,
    {
      method: 'PUT',
      headers: client.getHeaders(),
      body: JSON.stringify({ accounts }),
    },
    'set persona publishing accounts',
  );
}
