import { useQuery } from '@tanstack/react-query';
import { GetIdentityCardResponseSchema, type IdentityCard } from './contracts/persona-identity-card';
import { HttpStatusError } from './errors';

export const PERSONA_IDENTITY_CARD_QUERY_KEY = 'persona-identity-card';

export async function fetchPersonaIdentityCard(personaId: string): Promise<IdentityCard | null> {
  const response = await fetch(`/api/persona/identity-card?personaId=${encodeURIComponent(personaId)}`);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new HttpStatusError(`Identity card request failed with status ${response.status}`, response.status);
  }
  const parsed = GetIdentityCardResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error('Identity card request returned an unexpected payload.');
  }
  return parsed.data.identityCard;
}

export function usePersonaIdentityCardQuery(personaId: string | null) {
  return useQuery<IdentityCard | null>({
    queryKey: [PERSONA_IDENTITY_CARD_QUERY_KEY, personaId],
    queryFn: () => {
      if (personaId === null) throw new Error('personaId is required.');
      return fetchPersonaIdentityCard(personaId);
    },
    enabled: personaId !== null,
    staleTime: 30_000,
  });
}
