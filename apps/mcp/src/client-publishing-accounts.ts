import type { PostEngineerClient } from './client.js';
import type { ResponseOf } from './contracts/endpoint.js';
import { parseContractResponse } from './contract-response.js';
import {
  getPersonaPublishingAccounts as getPersonaPublishingAccountsContract,
  setPersonaPublishingAccounts as setPersonaPublishingAccountsContract,
} from './contracts/accounts.js';

export async function getPersonaPublishingAccounts(
  client: PostEngineerClient,
  personaId: string,
): Promise<ResponseOf<typeof getPersonaPublishingAccountsContract>> {
  const raw = await client.request(
    `/api/persona/publishing-accounts?personaId=${encodeURIComponent(personaId)}`,
    { method: 'GET', headers: client.getHeaders() },
    'get persona publishing accounts',
  );
  return parseContractResponse(getPersonaPublishingAccountsContract, raw);
}

export async function setPersonaPublishingAccounts(
  client: PostEngineerClient,
  personaId: string,
  accounts: Record<string, string[]>,
): Promise<ResponseOf<typeof setPersonaPublishingAccountsContract>> {
  const raw = await client.request(
    `/api/persona/publishing-accounts?personaId=${encodeURIComponent(personaId)}`,
    {
      method: 'PUT',
      headers: client.getHeaders(),
      body: JSON.stringify({ accounts }),
    },
    'set persona publishing accounts',
  );
  return parseContractResponse(setPersonaPublishingAccountsContract, raw);
}
