import type { PostEngineerClient } from './client.js';
import { getPersonaPublishingAccounts } from './client-publishing-accounts.js';
import { MalformedContractResponseError } from './contract-response.js';
import { SOCIAL_PROVIDERS, type SocialProvider } from './contracts/providers.js';

export async function boundAccounts(client: PostEngineerClient, personaId: string): Promise<Map<SocialProvider, string[]>> {
  let payload: unknown;
  try {
    payload = await getPersonaPublishingAccounts(client, personaId);
  } catch (error) {
    if (error instanceof MalformedContractResponseError) return new Map();
    throw error;
  }
  const defaults = typeof payload === 'object' && payload !== null ? (payload as { defaults?: unknown }).defaults : undefined;
  const bound = new Map<SocialProvider, string[]>();
  if (typeof defaults !== 'object' || defaults === null) return bound;
  for (const provider of SOCIAL_PROVIDERS) {
    const ids = (defaults as Record<string, unknown>)[provider];
    if (Array.isArray(ids) && ids.length > 0) bound.set(provider, ids.filter((id): id is string => typeof id === 'string'));
  }
  return bound;
}
