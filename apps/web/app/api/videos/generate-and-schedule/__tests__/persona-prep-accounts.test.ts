import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(() => 'log-id'), warn: vi.fn(() => 'log-id'), info: vi.fn(() => 'log-id'), debug: vi.fn() },
}));

vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));

import { logger } from '@/lib/logger';
import { emptyPersonaDefaultAccounts } from '@/lib/persona-publishing-accounts';
import { loadBoundPublishingAccounts, resolvePublishingAccounts } from '../persona-prep';

const USER_ID = 'user-1';
const PERSONA_ID = '11111111-1111-4111-8111-111111111111';

function accountsClient(persona: { data: unknown; error: { message: string } | null }): SupabaseClient {
  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => (table === 'personas' ? persona : { data: null, error: null }),
        then(resolve: (value: unknown) => unknown) {
          const rows = table === 'persona_default_accounts'
            ? [{ provider: 'youtube', provider_account_id: 'UC-1' }]
            : [];
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

describe('resolvePublishingAccounts', () => {
  it('returns explicit accounts and does not query', async () => {
    const supabase = { from: () => { throw new Error('queried'); } } as unknown as SupabaseClient;
    const explicit = { youtube: ['UC-explicit'] };

    await expect(resolvePublishingAccounts(supabase, PERSONA_ID, explicit, undefined, USER_ID)).resolves.toBe(explicit);
  });

  it('returns the already loaded binding and does not query', async () => {
    const supabase = { from: () => { throw new Error('queried'); } } as unknown as SupabaseClient;
    const bound = emptyPersonaDefaultAccounts();
    bound.youtube = ['UC-bound'];

    await expect(resolvePublishingAccounts(supabase, PERSONA_ID, undefined, bound, USER_ID)).resolves.toBe(bound);
  });

  it('returns an empty map for a persona-less post', async () => {
    const supabase = { from: () => { throw new Error('queried'); } } as unknown as SupabaseClient;

    await expect(resolvePublishingAccounts(supabase, null, undefined)).resolves.toEqual({});
  });

  it('throws when the fallback has no owner', async () => {
    const supabase = { from: () => { throw new Error('queried'); } } as unknown as SupabaseClient;

    await expect(resolvePublishingAccounts(supabase, PERSONA_ID, undefined, undefined, undefined)).rejects.toThrow(
      'Failed to load persona: owner is required.',
    );
  });

  it('maps a missing persona on the fallback to PERSONA_NOT_FOUND', async () => {
    const supabase = accountsClient({ data: null, error: null });

    await expect(resolvePublishingAccounts(supabase, PERSONA_ID, {}, undefined, USER_ID)).rejects.toMatchObject({
      code: 'PERSONA_NOT_FOUND',
      message: 'Persona not found.',
    });
  });

  it('throws the persona lookup error from the fallback', async () => {
    const supabase = accountsClient({ data: null, error: { message: 'connection reset' } });

    await expect(resolvePublishingAccounts(supabase, PERSONA_ID, undefined, undefined, USER_ID)).rejects.toThrow(
      'Failed to load persona: connection reset',
    );
  });

  it('loads the owned persona defaults when no binding was passed', async () => {
    const supabase = accountsClient({ data: { id: PERSONA_ID }, error: null });

    const accounts = await resolvePublishingAccounts(supabase, PERSONA_ID, undefined, undefined, USER_ID);

    expect(accounts.youtube).toEqual(['UC-1']);
    expect(accounts.instagram).toEqual([]);
  });
});

describe('loadBoundPublishingAccounts', () => {
  it('returns null for a persona-less post and does not query', async () => {
    const supabase = { from: () => { throw new Error('queried'); } } as unknown as SupabaseClient;

    await expect(loadBoundPublishingAccounts(supabase, null, USER_ID)).resolves.toBeNull();
  });

  it('returns the owned persona defaults', async () => {
    const supabase = accountsClient({ data: { id: PERSONA_ID }, error: null });

    const bound = await loadBoundPublishingAccounts(supabase, PERSONA_ID, USER_ID);

    expect(bound).toMatchObject({ youtube: ['UC-1'] });
  });

  it('maps PERSONA_NOT_FOUND to a 404', async () => {
    const supabase = accountsClient({ data: null, error: null });

    const response = await loadBoundPublishingAccounts(supabase, PERSONA_ID, USER_ID);

    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) return;
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Persona does not exist or is not accessible.',
      code: 'PERSONA_NOT_FOUND',
      field: 'personaId',
    });
  });

  it('logs a persona lookup error and answers 500', async () => {
    const supabase = accountsClient({ data: null, error: { message: 'connection reset' } });

    const response = await loadBoundPublishingAccounts(supabase, PERSONA_ID, USER_ID);

    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) return;
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'INTERNAL_ERROR',
    });
    expect(logger.error).toHaveBeenCalledWith(
      '[generate-and-schedule] persona binding lookup failed',
      expect.objectContaining({ message: 'Failed to load persona: connection reset' }),
      { userId: USER_ID, personaId: PERSONA_ID },
    );
  });
});
