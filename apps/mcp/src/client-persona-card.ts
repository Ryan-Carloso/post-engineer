import type { PostEngineerClient } from './client.js';
import { parseContractResponse } from './contract-response.js';
import type { ResponseOf } from './contracts/endpoint.js';
import {
  getPersonaIdentityCard as getPersonaIdentityCardContract,
  renderPersonaIdentityPrompt as renderPersonaIdentityPromptContract,
  type Scene,
} from './contracts/persona-identity-card.js';

export async function getPersonaIdentityCard(
  client: PostEngineerClient,
  personaId: string,
): Promise<ResponseOf<typeof getPersonaIdentityCardContract>> {
  const raw = await client.request(
    `/api/persona/identity-card?personaId=${encodeURIComponent(personaId)}`,
    { method: 'GET', headers: client.getHeaders() },
    'get persona identity card',
  );
  return parseContractResponse(getPersonaIdentityCardContract, raw);
}

export async function renderPersonaIdentityPrompt(
  client: PostEngineerClient,
  personaId: string,
  scene: Scene,
): Promise<ResponseOf<typeof renderPersonaIdentityPromptContract>> {
  const raw = await client.request(
    '/api/persona/identity-card',
    { method: 'POST', headers: client.getHeaders(), body: JSON.stringify({ personaId, scene }) },
    'render persona identity prompt',
  );
  return parseContractResponse(renderPersonaIdentityPromptContract, raw);
}
