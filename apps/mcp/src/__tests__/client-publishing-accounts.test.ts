import { describe, expect, it, vi } from 'vitest';
import type { PostEngineerClient } from '../client.js';
import { getPersonaPublishingAccounts, setPersonaPublishingAccounts } from '../client-publishing-accounts.js';

const FULL_DEFAULTS = {
  youtube: ['UC-1'],
  instagram: [],
  bluesky: [],
  linkedin: [],
  threads: [],
  facebook: [],
  pinterest: [],
  '3speak': [],
  rumble: [],
  fanvue: [],
};

function mockClient(payload: unknown): PostEngineerClient {
  return {
    request: vi.fn(async () => payload),
    getHeaders: () => ({ Authorization: 'Bearer <redacted>' }),
  } as unknown as PostEngineerClient;
}

describe('publishing-accounts client', () => {
  it('parses a well-formed get 200', async () => {
    const client = mockClient({ success: true, defaults: FULL_DEFAULTS });
    const result = await getPersonaPublishingAccounts(client, '11111111-1111-4111-8111-111111111111');
    expect(result.defaults.youtube).toEqual(['UC-1']);
  });

  it('rejects a malformed get 200', async () => {
    const client = mockClient({ success: true, defaults: { youtube: ['UC-1'] } });
    await expect(getPersonaPublishingAccounts(client, '11111111-1111-4111-8111-111111111111')).rejects.toThrow(
      'Malformed response from GET /api/persona/publishing-accounts',
    );
  });

  it('rejects a get 200 with no defaults at all', async () => {
    const client = mockClient({ success: true });
    await expect(getPersonaPublishingAccounts(client, '11111111-1111-4111-8111-111111111111')).rejects.toThrow(
      'Malformed response from GET /api/persona/publishing-accounts',
    );
  });

  it('parses a well-formed set 200', async () => {
    const client = mockClient({ success: true, defaults: FULL_DEFAULTS });
    const result = await setPersonaPublishingAccounts(client, '11111111-1111-4111-8111-111111111111', { youtube: ['UC-1'] });
    expect(result.defaults.youtube).toEqual(['UC-1']);
  });

  it('rejects a malformed set 200', async () => {
    const client = mockClient({ success: true, defaults: { youtube: ['UC-1'] } });
    await expect(
      setPersonaPublishingAccounts(client, '11111111-1111-4111-8111-111111111111', { youtube: ['UC-1'] }),
    ).rejects.toThrow('Malformed response from PUT /api/persona/publishing-accounts');
  });
});
