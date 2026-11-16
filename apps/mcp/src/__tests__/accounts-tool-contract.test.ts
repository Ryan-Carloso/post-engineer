import { describe, expect, it } from 'vitest';
import { DisconnectAccountSchema } from '../account-shapes.js';
import { ConnectAccountSchema } from '../connect-account.js';
import { ListPinterestBoardsSchema } from '../tools-pinterest.js';
import { SetPersonaPublishingAccountsSchema } from '../tools-publishing-accounts.js';
import {
  BlueskyConnectBodySchema,
  parseDisconnectAccountQuery,
  parseListPinterestBoardsQuery,
  parsePersonaPublishingAccountsQuery,
  RumbleConnectBodySchema,
  SetPersonaPublishingAccountsBodySchema,
  ThreespeakConnectBodySchema,
} from '../contracts/accounts.js';
import { GetPersonaPublishingAccountsSchema } from '../tools-publishing-accounts.js';

//---------------
// accounts tool↔contract equivalence (shared/contracts/accounts.ts):
// the tool schemas and the contract schemas/parsers must accept and
// reject the same inputs, so a call the tool allows is one the route
// accepts and a call the route rejects fails fast in the tool.
//
// Deliberate differences, pinned here so they stay deliberate:
// - The connect tool shape is one flat shape for all providers: a
//   missing credential passes the tool schema and the handler enforces
//   presence per provider, while each contract body requires both of its
//   fields. Only the blank-credential cases are equivalent.
// - The publishing-accounts PUT body accepts unknown provider keys on
//   both sides; the route rejects them server-side.
// - The publishing-accounts GET personaId is a UUID on the route only;
//   the tool accepts any non-empty string and the route 400s the rest.
//---------------

const ALL_PROVIDERS = ['youtube', 'instagram', 'linkedin', 'bluesky', 'threads', 'facebook', 'pinterest', 'fanvue', '3speak', 'rumble'] as const;

describe('accounts tool-contract equivalence', () => {
  it('disconnect accepts every provider on both sides', () => {
    for (const provider of ALL_PROVIDERS) {
      expect(DisconnectAccountSchema.safeParse({ provider, providerAccountId: 'acc-1' }).success).toBe(true);
      const parsed = parseDisconnectAccountQuery(new URLSearchParams({ provider, providerAccountId: 'acc-1' }));
      expect(parsed.ok).toBe(true);
    }
  });

  it('disconnect rejects an unknown provider on both sides', () => {
    expect(DisconnectAccountSchema.safeParse({ provider: 'myspace', providerAccountId: 'acc-1' }).success).toBe(false);
    const parsed = parseDisconnectAccountQuery(new URLSearchParams({ provider: 'myspace', providerAccountId: 'acc-1' }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toBe('Unknown provider.');
      expect(parsed.code).toBe('INVALID_PROVIDER');
    }
  });

  it('disconnect rejects a missing or empty account id on both sides', () => {
    expect(DisconnectAccountSchema.safeParse({ provider: 'youtube', providerAccountId: '' }).success).toBe(false);
    const missing = parseDisconnectAccountQuery(new URLSearchParams({ provider: 'youtube' }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error).toBe('provider and providerAccountId are required.');
      expect(missing.code).toBe('INVALID_PARAMS');
    }
    const empty = parseDisconnectAccountQuery(new URLSearchParams({ provider: 'youtube', providerAccountId: '' }));
    expect(empty.ok).toBe(false);
  });

  it('connect rejects a blank credential on both sides', () => {
    const cases: Array<{ tool: unknown; contract: unknown }> = [
      { tool: { provider: 'bluesky', handle: '   ', appPassword: 'x' }, contract: { handle: '   ', appPassword: 'x' } },
      { tool: { provider: 'bluesky', handle: 'x', appPassword: '   ' }, contract: { handle: 'x', appPassword: '   ' } },
      { tool: { provider: '3speak', username: '   ', postingKey: 'x' }, contract: { username: '   ', postingKey: 'x' } },
      { tool: { provider: '3speak', username: 'x', postingKey: '   ' }, contract: { username: 'x', postingKey: '   ' } },
      { tool: { provider: 'rumble', channelId: '   ', accessToken: 'x' }, contract: { channelId: '   ', accessToken: 'x' } },
      { tool: { provider: 'rumble', channelId: 'x', accessToken: '   ' }, contract: { channelId: 'x', accessToken: '   ' } },
    ];
    const contracts = [BlueskyConnectBodySchema, BlueskyConnectBodySchema, ThreespeakConnectBodySchema, ThreespeakConnectBodySchema, RumbleConnectBodySchema, RumbleConnectBodySchema];
    for (const [index, { tool, contract }] of cases.entries()) {
      expect(ConnectAccountSchema.safeParse(tool).success).toBe(false);
      expect(contracts[index]?.safeParse(contract).success).toBe(false);
    }
  });

  it('connect accepts a valid credential pair on both sides', () => {
    expect(ConnectAccountSchema.safeParse({ provider: 'bluesky', handle: 'user.bsky.social', appPassword: 'secret' }).success).toBe(true);
    expect(BlueskyConnectBodySchema.safeParse({ handle: 'user.bsky.social', appPassword: 'secret' }).success).toBe(true);
    expect(ConnectAccountSchema.safeParse({ provider: '3speak', username: 'alice', postingKey: '5Kkey' }).success).toBe(true);
    expect(ThreespeakConnectBodySchema.safeParse({ username: 'alice', postingKey: '5Kkey' }).success).toBe(true);
    expect(ConnectAccountSchema.safeParse({ provider: 'rumble', channelId: 'chan-1', accessToken: 'a'.repeat(40) }).success).toBe(true);
    expect(RumbleConnectBodySchema.safeParse({ channelId: 'chan-1', accessToken: 'a'.repeat(40) }).success).toBe(true);
  });

  it('pinterest boards rejects a blank account id on both sides and trims a valid one', () => {
    expect(ListPinterestBoardsSchema.safeParse({ accountId: '' }).success).toBe(false);
    expect(ListPinterestBoardsSchema.safeParse({ accountId: '   ' }).success).toBe(false);
    expect(ListPinterestBoardsSchema.safeParse({ accountId: 'user-9' }).success).toBe(true);
    expect(parseListPinterestBoardsQuery(new URLSearchParams({ accountId: '' })).ok).toBe(false);
    expect(parseListPinterestBoardsQuery(new URLSearchParams({ accountId: '   ' })).ok).toBe(false);
    const parsed = parseListPinterestBoardsQuery(new URLSearchParams({ accountId: '  user-9 ' }));
    expect(parsed).toEqual({ ok: true, accountId: 'user-9' });
  });

  it('publishing-accounts set agrees on the accounts map shape', () => {
    const valid = { accounts: { youtube: ['UC-1'], bluesky: [] } };
    expect(SetPersonaPublishingAccountsSchema.safeParse({ personaId: 'p-1', ...valid }).success).toBe(true);
    expect(SetPersonaPublishingAccountsBodySchema.safeParse(valid).success).toBe(true);
    const blankId = { accounts: { youtube: [''] } };
    expect(SetPersonaPublishingAccountsSchema.safeParse({ personaId: 'p-1', ...blankId }).success).toBe(false);
    expect(SetPersonaPublishingAccountsBodySchema.safeParse(blankId).success).toBe(false);
    const notArray = { accounts: { youtube: 'UC-1' } };
    expect(SetPersonaPublishingAccountsSchema.safeParse({ personaId: 'p-1', ...notArray }).success).toBe(false);
    expect(SetPersonaPublishingAccountsBodySchema.safeParse(notArray).success).toBe(false);
    // Unknown provider keys pass both sides; the route rejects them.
    const unknownProvider = { accounts: { myspace: ['id-1'] } };
    expect(SetPersonaPublishingAccountsSchema.safeParse({ personaId: 'p-1', ...unknownProvider }).success).toBe(true);
    expect(SetPersonaPublishingAccountsBodySchema.safeParse(unknownProvider).success).toBe(true);
  });

  it('publishing-accounts get requires a UUID on the route only', () => {
    const uuid = '11111111-1111-4111-8111-111111111111';
    expect(GetPersonaPublishingAccountsSchema.safeParse({ personaId: uuid }).success).toBe(true);
    expect(parsePersonaPublishingAccountsQuery(new URLSearchParams({ personaId: uuid })).ok).toBe(true);
    // The tool accepts any non-empty id; the route 400s a non-UUID.
    expect(GetPersonaPublishingAccountsSchema.safeParse({ personaId: 'p-1' }).success).toBe(true);
    const parsed = parsePersonaPublishingAccountsQuery(new URLSearchParams({ personaId: 'p-1' }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toBe('personaId must be a UUID.');
    const missing = parsePersonaPublishingAccountsQuery(new URLSearchParams({}));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe('personaId is required.');
  });
});
