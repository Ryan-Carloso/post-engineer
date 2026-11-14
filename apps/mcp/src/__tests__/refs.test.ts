import { describe, expect, it, vi } from 'vitest';
import type { PostEngineerClient } from '../client.js';
import { resolveAccountRef, resolvePersonaRef } from '../refs.js';
import type { McpToolResponse } from '../tools-call.js';

// Issue #566 §7: a persona or account is given as an id or as a display
// name. An id wins; otherwise the name must match exactly (case-insensitive,
// trimmed). Zero matches is an actionable error, several matches is a
// candidates result and never a guess.

const PERSONA_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

function client(payloads: { personas?: unknown; accounts?: unknown }): { client: PostEngineerClient; listPersonas: ReturnType<typeof vi.fn>; listSocialAccounts: ReturnType<typeof vi.fn> } {
  const listPersonas = vi.fn(async () => payloads.personas);
  const listSocialAccounts = vi.fn(async () => payloads.accounts);
  return { client: { listPersonas, listSocialAccounts } as unknown as PostEngineerClient, listPersonas, listSocialAccounts };
}

function body(response: McpToolResponse): string {
  const block = response.content[0];
  return block.type === 'text' ? block.text : '';
}

const PERSONAS = { personas: [{ id: PERSONA_ID, name: 'Maria', niche: 'cooking' }, { id: OTHER_ID, name: 'João' }] };

describe('resolvePersonaRef', () => {
  it('takes a UUID as the id without listing personas', async () => {
    const { client: c, listPersonas } = client({ personas: PERSONAS });
    expect(await resolvePersonaRef(c, PERSONA_ID)).toEqual({ kind: 'ok', value: { id: PERSONA_ID, name: null } });
    expect(listPersonas).not.toHaveBeenCalled();
  });

  it('matches a name exactly, ignoring case and surrounding spaces', async () => {
    const { client: c } = client({ personas: PERSONAS });
    expect(await resolvePersonaRef(c, '  maria ')).toEqual({ kind: 'ok', value: { id: PERSONA_ID, name: 'Maria' } });
  });

  it('does not match a prefix or a fragment', async () => {
    const { client: c } = client({ personas: PERSONAS });
    const outcome = await resolvePersonaRef(c, 'Mar');
    expect(outcome.kind).toBe('response');
  });

  it('turns zero matches into an error that says how to list the personas', async () => {
    const { client: c } = client({ personas: PERSONAS });
    const outcome = await resolvePersonaRef(c, 'Ghost');
    expect(outcome.kind === 'response' && outcome.response.isError).toBe(true);
    expect(outcome.kind === 'response' && body(outcome.response)).toContain('No persona named "Ghost"');
    expect(outcome.kind === 'response' && body(outcome.response)).toContain('personas');
  });

  it('returns candidates, not an error and not a guess, when several personas share the name', async () => {
    const { client: c } = client({ personas: { personas: [{ id: PERSONA_ID, name: 'Maria' }, { id: OTHER_ID, name: 'maria', niche: 'travel' }] } });
    const outcome = await resolvePersonaRef(c, 'Maria');
    if (outcome.kind !== 'response') throw new Error('expected a candidates response');
    expect(outcome.response.isError).not.toBe(true);
    const parsed = JSON.parse(body(outcome.response));
    expect(parsed.ambiguous).toBe(true);
    expect(parsed.actionTaken).toBe(false);
    expect(parsed.candidates.map((entry: { id: string }) => entry.id)).toEqual([PERSONA_ID, OTHER_ID]);
    expect(parsed.candidates[1].summary).toContain('travel');
  });

  it('fails when the listing itself is malformed instead of treating it as "no persona"', async () => {
    const { client: c } = client({ personas: { personas: 'nope' } });
    const outcome = await resolvePersonaRef(c, 'Maria');
    expect(outcome.kind === 'response' && outcome.response.isError).toBe(true);
    expect(outcome.kind === 'response' && body(outcome.response)).toContain('personas');
  });

  it('reports a failed listing as an error response', async () => {
    const c = { listPersonas: vi.fn(async () => { throw new Error('boom'); }) } as unknown as PostEngineerClient;
    const outcome = await resolvePersonaRef(c, 'Maria');
    expect(outcome.kind === 'response' && outcome.response.isError).toBe(true);
    expect(outcome.kind === 'response' && body(outcome.response)).toContain('boom');
  });

  it('rejects an empty reference', async () => {
    const { client: c } = client({ personas: PERSONAS });
    const outcome = await resolvePersonaRef(c, '   ');
    expect(outcome.kind).toBe('response');
  });
});

const ACCOUNTS = {
  accounts: [
    { provider: 'youtube', channelId: 'UC123', channelName: 'Maria Cooks' },
    { provider: 'instagram', igUserId: '1784', username: 'maria.cooks', name: 'Maria' },
    { provider: 'bluesky', did: 'did:plc:abc', handle: 'maria.bsky.social', displayName: 'Maria B' },
    { provider: 'linkedin', providerAccountId: 'li-1', accountName: 'Maria Silva' },
  ],
};

describe('resolveAccountRef', () => {
  it('matches the provider-specific id, which wins over any name', async () => {
    const { client: c } = client({ accounts: ACCOUNTS });
    expect(await resolveAccountRef(c, 'UC123')).toEqual({ kind: 'ok', value: { provider: 'youtube', id: 'UC123', label: 'Maria Cooks' } });
    expect(await resolveAccountRef(c, 'did:plc:abc')).toMatchObject({ kind: 'ok', value: { provider: 'bluesky', id: 'did:plc:abc' } });
    expect(await resolveAccountRef(c, '1784')).toMatchObject({ kind: 'ok', value: { provider: 'instagram', id: '1784' } });
  });

  it('matches a channel name, username, handle (with or without @) or display name, exactly', async () => {
    const { client: c } = client({ accounts: ACCOUNTS });
    expect(await resolveAccountRef(c, 'maria cooks')).toMatchObject({ kind: 'ok', value: { provider: 'youtube' } });
    expect(await resolveAccountRef(c, '@Maria.Cooks')).toMatchObject({ kind: 'ok', value: { provider: 'instagram' } });
    expect(await resolveAccountRef(c, 'maria.bsky.social')).toMatchObject({ kind: 'ok', value: { provider: 'bluesky' } });
    expect(await resolveAccountRef(c, 'Maria Silva')).toMatchObject({ kind: 'ok', value: { provider: 'linkedin', id: 'li-1' } });
  });

  it('resolves a name that only one account carries, whatever its provider', async () => {
    const { client: c } = client({ accounts: ACCOUNTS });
    expect(await resolveAccountRef(c, 'Maria')).toMatchObject({ kind: 'ok', value: { provider: 'instagram', id: '1784' } });
  });

  it('narrows an ambiguous name with the provider', async () => {
    const shared = { accounts: [{ provider: 'youtube', channelId: 'UC1', channelName: 'Maria' }, { provider: 'instagram', igUserId: '9', username: 'maria' }] };
    const { client: c } = client({ accounts: shared });
    const wide = await resolveAccountRef(c, 'Maria');
    if (wide.kind !== 'response') throw new Error('expected candidates');
    expect(wide.response.isError).not.toBe(true);
    expect(JSON.parse(body(wide.response)).candidates).toHaveLength(2);
    expect(await resolveAccountRef(c, 'Maria', 'instagram')).toMatchObject({ kind: 'ok', value: { provider: 'instagram', id: '9' } });
  });

  it('turns zero matches into an error that says how to list the accounts', async () => {
    const { client: c } = client({ accounts: ACCOUNTS });
    const outcome = await resolveAccountRef(c, 'nobody');
    expect(outcome.kind === 'response' && outcome.response.isError).toBe(true);
    expect(outcome.kind === 'response' && body(outcome.response)).toContain('accounts');
  });

  it('reads the listing through GET /api/account only once per call', async () => {
    const { client: c, listSocialAccounts } = client({ accounts: ACCOUNTS });
    await resolveAccountRef(c, 'UC123');
    expect(listSocialAccounts).toHaveBeenCalledTimes(1);
  });
});
