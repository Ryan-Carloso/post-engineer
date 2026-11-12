// Unit tests for the persona default publishing accounts lib
// (issue #212). The Supabase client is faked in-memory; the SQL lives in
// migration 022 and is pinned by the sync test below.
import { describe, it, expect } from 'vitest';
import {
  emptyPersonaDefaultAccounts,
  getPersonaDefaultAccounts,
  parsePublishingAccountsField,
  setPersonaDefaultAccounts,
  totalBoundAccounts,
} from '../persona-publishing-accounts';

type Row = Record<string, unknown>;

function makeDb(initial: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    personas: [],
    social_accounts: [],
    persona_default_accounts: [],
    ...initial,
  };
  const db = {
    tables,
    from(table: string) {
      const rows = tables[table] ?? [];
      const query: Record<string, unknown> = {
        _filters: [] as Array<(r: Row) => boolean>,
        _select: null as null | string,
      };
      const applyFilters = () => rows.filter((r) => (query._filters as Array<(r: Row) => boolean>).every((f) => f(r)));
      const chain = {
        select(cols: string) {
          query._select = cols;
          return chain;
        },
        eq(col: string, val: unknown) {
          (query._filters as Array<(r: Row) => boolean>).push((r) => r[col] === val);
          return chain;
        },
        maybeSingle() {
          const found = applyFilters()[0] ?? null;
          return Promise.resolve({ data: found, error: null });
        },
        delete() {
          const delChain = {
            eq(col: string, val: unknown) {
              (query._filters as Array<(r: Row) => boolean>).push((r) => r[col] === val);
              return delChain;
            },
            then(resolve: (v: { data: null; error: null }) => unknown) {
              const toDelete = applyFilters();
              tables[table] = rows.filter((r) => !toDelete.includes(r));
              return Promise.resolve({ data: null, error: null }).then(resolve);
            },
          };
          return delChain;
        },
        insert(newRows: Row[]) {
          tables[table] = [...rows, ...newRows];
          return Promise.resolve({ data: newRows, error: null });
        },
        then(resolve: (v: { data: Row[]; error: null }) => unknown) {
          return Promise.resolve({ data: applyFilters(), error: null }).then(resolve);
        },
      };
      return chain;
    },
  };
  return db;
}

const USER = 'user-1';
const PERSONA = 'persona-1';

function baseDb() {
  return makeDb({
    personas: [{ id: PERSONA, user_id: USER }],
    social_accounts: [
      { provider: 'youtube', provider_account_id: 'UC-1', user_id: USER },
      { provider: 'bluesky', provider_account_id: 'did:plc:a', user_id: USER },
      { provider: 'bluesky', provider_account_id: 'did:plc:b', user_id: USER },
    ],
  });
}

describe('getPersonaDefaultAccounts', () => {
  it('returns every provider grouped, empty when none stored', async () => {
    const db = baseDb();
    expect(await getPersonaDefaultAccounts(db as never, PERSONA)).toEqual({
      youtube: [],
      instagram: [],
      bluesky: [],
      linkedin: [],
      threads: [],
      facebook: [],
      pinterest: [],
      '3speak': [],
      rumble: [],
      fanvue: [],
    });
  });

  it('groups stored rows per provider and drops unknown providers', async () => {
    const db = baseDb();
    db.tables.persona_default_accounts = [
      { persona_id: PERSONA, provider: 'bluesky', provider_account_id: 'did:plc:a' },
      { persona_id: PERSONA, provider: 'bluesky', provider_account_id: 'did:plc:b' },
      { persona_id: PERSONA, provider: 'youtube', provider_account_id: 'UC-1' },
      { persona_id: PERSONA, provider: 'tiktok', provider_account_id: 'tt-1' },
      { persona_id: 'other-persona', provider: 'bluesky', provider_account_id: 'did:plc:z' },
    ];
    const got = await getPersonaDefaultAccounts(db as never, PERSONA);
    expect(got.bluesky).toEqual(['did:plc:a', 'did:plc:b']);
    expect(got.youtube).toEqual(['UC-1']);
    expect(got.instagram).toEqual([]);
    expect(got.linkedin).toEqual([]);
  });
});

describe('setPersonaDefaultAccounts', () => {
  it('writes the full set and returns the new state', async () => {
    const db = baseDb();
    const got = await setPersonaDefaultAccounts({
      supabase: db as never,
      userId: USER,
      personaId: PERSONA,
      accounts: { bluesky: ['did:plc:a', 'did:plc:b'], youtube: ['UC-1'] },
    });
    expect(got.bluesky).toEqual(['did:plc:a', 'did:plc:b']);
    expect(got.youtube).toEqual(['UC-1']);
    expect(db.tables.persona_default_accounts).toHaveLength(3);
  });

  it('replaces the previous set (delete-then-insert)', async () => {
    const db = baseDb();
    db.tables.persona_default_accounts = [
      { persona_id: PERSONA, provider: 'youtube', provider_account_id: 'UC-1' },
    ];
    await setPersonaDefaultAccounts({
      supabase: db as never,
      userId: USER,
      personaId: PERSONA,
      accounts: { bluesky: ['did:plc:a'] },
    });
    expect(db.tables.persona_default_accounts).toEqual([
      { persona_id: PERSONA, provider: 'bluesky', provider_account_id: 'did:plc:a' },
    ]);
  });

  it('dedupes and trims ids, drops empties', async () => {
    const db = baseDb();
    const got = await setPersonaDefaultAccounts({
      supabase: db as never,
      userId: USER,
      personaId: PERSONA,
      accounts: { bluesky: ['did:plc:a', ' did:plc:a ', ''] },
    });
    expect(got.bluesky).toEqual(['did:plc:a']);
  });

  it('rejects a persona that does not belong to the user', async () => {
    const db = baseDb();
    await expect(
      setPersonaDefaultAccounts({
        supabase: db as never,
        userId: 'intruder',
        personaId: PERSONA,
        accounts: { bluesky: ['did:plc:a'] },
      })
    ).rejects.toMatchObject({ code: 'PERSONA_NOT_FOUND' });
    expect(db.tables.persona_default_accounts).toHaveLength(0);
  });

  it('rejects unknown providers', async () => {
    const db = baseDb();
    await expect(
      setPersonaDefaultAccounts({
        supabase: db as never,
        userId: USER,
        personaId: PERSONA,
        accounts: { tiktok: ['tt-1'] },
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects account ids the user has not connected', async () => {
    const db = baseDb();
    await expect(
      setPersonaDefaultAccounts({
        supabase: db as never,
        userId: USER,
        personaId: PERSONA,
        accounts: { youtube: ['UC-evil'] },
      })
    ).rejects.toMatchObject({ code: 'INVALID_PROVIDER_ACCOUNT' });
    expect(db.tables.persona_default_accounts).toHaveLength(0);
  });

  it('rejects a non-array provider value', async () => {
    const db = baseDb();
    await expect(
      setPersonaDefaultAccounts({
        supabase: db as never,
        userId: USER,
        personaId: PERSONA,
        accounts: { bluesky: 'did:plc:a' as unknown as string[] },
      })
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });
});

describe('emptyPersonaDefaultAccounts', () => {
  it('returns a fresh empty record per provider', () => {
    expect(emptyPersonaDefaultAccounts()).toEqual({
      youtube: [],
      instagram: [],
      bluesky: [],
      linkedin: [],
      threads: [],
      facebook: [],
      pinterest: [],
      '3speak': [],
      rumble: [],
      fanvue: [],
    });
  });
});

describe('setPersonaDefaultAccounts — a persona must keep at least one bound account (issue #572)', () => {
  it('rejects an empty map and writes nothing', async () => {
    const db = baseDb();
    await expect(
      setPersonaDefaultAccounts({
        supabase: db as never,
        userId: USER,
        personaId: PERSONA,
        accounts: {},
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(db.tables.persona_default_accounts).toHaveLength(0);
  });

  it('rejects providers that are all empty and keeps the previous binding', async () => {
    const db = baseDb();
    db.tables.persona_default_accounts = [
      { persona_id: PERSONA, provider: 'youtube', provider_account_id: 'UC-1' },
    ];
    await expect(
      setPersonaDefaultAccounts({
        supabase: db as never,
        userId: USER,
        personaId: PERSONA,
        accounts: { youtube: [], bluesky: [] },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(db.tables.persona_default_accounts).toHaveLength(1);
  });
});

describe('totalBoundAccounts', () => {
  it('counts ids across providers', () => {
    expect(totalBoundAccounts(emptyPersonaDefaultAccounts())).toBe(0);
    expect(
      totalBoundAccounts({
        ...emptyPersonaDefaultAccounts(),
        youtube: ['UC-1'],
        bluesky: ['did:plc:a', 'did:plc:b'],
      }),
    ).toBe(3);
  });
});

describe('parsePublishingAccountsField — the create-persona form field (issue #572)', () => {
  it('parses a valid JSON map and normalizes it', () => {
    expect(
      parsePublishingAccountsField(JSON.stringify({ youtube: ['UC-1', ' UC-1 '], bluesky: ['did:plc:a'] })),
    ).toEqual({
      ok: true,
      accounts: { ...emptyPersonaDefaultAccounts(), youtube: ['UC-1'], bluesky: ['did:plc:a'] },
    });
  });

  it('rejects a missing field', () => {
    expect(parsePublishingAccountsField(null).ok).toBe(false);
  });

  it('rejects malformed JSON', () => {
    expect(parsePublishingAccountsField('{not json').ok).toBe(false);
  });

  it('rejects a non-object payload', () => {
    expect(parsePublishingAccountsField(JSON.stringify(['UC-1'])).ok).toBe(false);
  });

  it('rejects an unknown provider', () => {
    expect(parsePublishingAccountsField(JSON.stringify({ tiktok: ['tt-1'] })).ok).toBe(false);
  });

  it('rejects a non-array provider value', () => {
    expect(parsePublishingAccountsField(JSON.stringify({ youtube: 'UC-1' })).ok).toBe(false);
  });

  it('rejects a total of zero accounts', () => {
    const parsed = parsePublishingAccountsField(JSON.stringify({ youtube: [], bluesky: [] }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toMatch(/at least one/i);
    }
  });
});
