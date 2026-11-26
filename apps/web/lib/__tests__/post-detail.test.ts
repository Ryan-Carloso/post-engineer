import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSlotPost, personaScopeOf } from '../post-detail';
import { createSupabaseServiceClient } from '../supabase/service';
import { logger } from '../logger';

vi.mock('../supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));

vi.mock('../publish-links', () => ({
  resolvePublishLinks: vi.fn(() => []),
}));

vi.mock('../logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const PGRST116 = { code: 'PGRST116', message: 'zero rows' };

function chain(result: { data: unknown; error: unknown }) {
  const single = vi.fn(async () => result);
  const maybeSingle = vi.fn(async () => result);
  const order = vi.fn(async () => result);
  const eq = vi.fn(() => ({ single, maybeSingle, eq, order }));
  const select = vi.fn(() => ({ eq, order }));
  return { select, eq, single, maybeSingle, order };
}

function mockSupabase(tables: Record<string, { data: unknown; error: unknown }>) {
  const chains: Record<string, ReturnType<typeof chain>> = {};
  const from = vi.fn((table: string) => {
    if (!chains[table]) chains[table] = chain(tables[table] ?? { data: null, error: PGRST116 });
    return chains[table];
  });
  const supabase = { from } as unknown as SupabaseClient;
  return { supabase, from, chains };
}

const SLOT_ROW = {
  id: 'slot-1',
  schedule_id: 'sched-1',
  slot_at: '2026-10-18T10:00:00.000Z',
  status: 'ready',
  title: 'myth busting',
  error: null,
  published_at: null,
  publish_outcomes: null,
  prompt_version_id: null,
};

const SCHEDULE_ROW = {
  id: 'sched-1',
  persona_id: 'persona-1',
  providers: ['youtube'],
  youtube_account_ids: ['acct-1'],
  instagram_account_ids: [],
  linkedin_account_ids: [],
  bluesky_account_ids: [],
  timezone: 'UTC',
  publish_mode: 'scheduled',
};

describe('getSlotPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the full slot detail for the owner', async () => {
    const { supabase, chains } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: SCHEDULE_ROW, error: null },
      personas: { data: { id: 'persona-1', name: 'Viva Leve' }, error: null },
    });
    const detail = await getSlotPost(supabase, 'slot-1', 'user-1', null);
    expect(detail?.slot.id).toBe('slot-1');
    expect(chains['scheduled_posts'].select).toHaveBeenCalledWith(
      'id, schedule_id, slot_at, status, title, error, published_at, publish_outcomes, prompt_version_id'
    );
    expect(chains['schedules'].select).toHaveBeenCalledWith(
      'id, persona_id, providers, youtube_account_ids, instagram_account_ids, linkedin_account_ids, bluesky_account_ids, threads_account_ids, facebook_account_ids, pinterest_account_ids, pinterest_board_id, threespeak_account_ids, rumble_account_ids, fanvue_account_ids, telegram_account_ids, timezone, publish_mode'
    );
    expect(detail?.slot.status).toBe('ready');
    expect(detail?.schedule.publishMode).toBe('scheduled');
    expect(detail?.persona?.name).toBe('Viva Leve');
    expect(detail?.prompt).toBeNull();
    expect(detail).not.toHaveProperty('generation');
    expect(detail?.slot).not.toHaveProperty('progress');
  });

  it('returns postUrl built from the public app URL', async () => {
    const { supabase } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: SCHEDULE_ROW, error: null },
      personas: { data: { id: 'persona-1', name: 'Viva Leve' }, error: null },
    });
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://post-engineer.com');
    const detail = await getSlotPost(supabase, 'slot-1', 'user-1', null);
    expect(detail?.slot.postUrl).toBe('https://post-engineer.com/posts/slot-1');
  });

  it('returns a null postUrl when the public app URL is not configured', async () => {
    const { supabase } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: SCHEDULE_ROW, error: null },
      personas: { data: { id: 'persona-1', name: 'Viva Leve' }, error: null },
    });
    vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined);
    const detail = await getSlotPost(supabase, 'slot-1', 'user-1', null);
    expect(detail?.slot.postUrl).toBeNull();
  });

  it('scopes the slot lookup by user_id, so another user’s slot never matches', async () => {
    const { supabase, chains } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: SCHEDULE_ROW, error: null },
      personas: { data: { id: 'persona-1', name: 'Viva Leve' }, error: null },
    });
    await getSlotPost(supabase, 'slot-1', 'user-1', null);
    expect(chains['scheduled_posts'].eq).toHaveBeenCalledWith('id', 'slot-1');
    expect(chains['scheduled_posts'].eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('returns the schedule facebook page ids, empty when the column is absent', async () => {
    const tables = {
      scheduled_posts: { data: SLOT_ROW, error: null },
      personas: { data: { id: 'persona-1', name: 'Viva Leve' }, error: null },
    };
    const withPages = mockSupabase({ ...tables, schedules: { data: { ...SCHEDULE_ROW, providers: ['facebook'], facebook_account_ids: ['page-1', 'page-2'] }, error: null } });
    const detail = await getSlotPost(withPages.supabase, 'slot-1', 'user-1', null);
    expect(detail?.schedule.facebookAccountIds).toEqual(['page-1', 'page-2']);

    const legacy = mockSupabase({ ...tables, schedules: { data: SCHEDULE_ROW, error: null } });
    const legacyDetail = await getSlotPost(legacy.supabase, 'slot-1', 'user-1', null);
    expect(legacyDetail?.schedule.facebookAccountIds).toEqual([]);
  });

  it('returns the schedule rumble channel ids, empty when the column is absent', async () => {
    const tables = {
      scheduled_posts: { data: SLOT_ROW, error: null },
      personas: { data: { id: 'persona-1', name: 'Viva Leve' }, error: null },
    };
    const withChannels = mockSupabase({ ...tables, schedules: { data: { ...SCHEDULE_ROW, providers: ['rumble'], rumble_account_ids: ['chan-1', 'chan-2'] }, error: null } });
    const detail = await getSlotPost(withChannels.supabase, 'slot-1', 'user-1', null);
    expect(detail?.schedule.rumbleAccountIds).toEqual(['chan-1', 'chan-2']);

    const legacy = mockSupabase({ ...tables, schedules: { data: SCHEDULE_ROW, error: null } });
    const legacyDetail = await getSlotPost(legacy.supabase, 'slot-1', 'user-1', null);
    expect(legacyDetail?.schedule.rumbleAccountIds).toEqual([]);
  });

  it('returns the schedule fanvue account ids, empty when the column is absent', async () => {
    const tables = {
      scheduled_posts: { data: SLOT_ROW, error: null },
      personas: { data: { id: 'persona-1', name: 'Viva Leve' }, error: null },
    };
    const withAccounts = mockSupabase({ ...tables, schedules: { data: { ...SCHEDULE_ROW, providers: ['fanvue'], fanvue_account_ids: ['fv-1', 'fv-2'] }, error: null } });
    const detail = await getSlotPost(withAccounts.supabase, 'slot-1', 'user-1', null);
    expect(detail?.schedule.fanvueAccountIds).toEqual(['fv-1', 'fv-2']);

    const legacy = mockSupabase({ ...tables, schedules: { data: SCHEDULE_ROW, error: null } });
    const legacyDetail = await getSlotPost(legacy.supabase, 'slot-1', 'user-1', null);
    expect(legacyDetail?.schedule.fanvueAccountIds).toEqual([]);
  });

  it('returns null for an unknown id (PGRST116)', async () => {
    const { supabase } = mockSupabase({});
    await expect(getSlotPost(supabase, 'nope', 'user-1', null)).resolves.toBeNull();
  });

  it('returns null when the schedule row is gone', async () => {
    const { supabase } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: null, error: null },
    });
    await expect(getSlotPost(supabase, 'slot-1', 'user-1', null)).resolves.toBeNull();
  });

  it('throws on DB errors so callers can 500', async () => {
    const { supabase } = mockSupabase({
      scheduled_posts: { data: null, error: new Error('db down') },
    });
    await expect(getSlotPost(supabase, 'slot-1', 'user-1', null)).rejects.toThrow('db down');
  });

  it('throws when the schedule lookup hits a DB error', async () => {
    const { supabase } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: null, error: new Error('db down') },
    });
    await expect(getSlotPost(supabase, 'slot-1', 'user-1', null)).rejects.toThrow('db down');
  });

  it('degrades to a null persona when the persona lookup 404s', async () => {
    const { supabase } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: SCHEDULE_ROW, error: null },
      personas: { data: null, error: PGRST116 },
    });
    const detail = await getSlotPost(supabase, 'slot-1', 'user-1', null);
    expect(detail?.persona).toBeNull();
    expect(detail?.slot.id).toBe('slot-1');
  });

});


describe('persona scope (persona-scoped API keys)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('personaScopeOf is null for a session, OAuth or unscoped key and the list for a scoped key', () => {
    expect(personaScopeOf({ isApiKey: false })).toBeNull();
    expect(personaScopeOf({ isApiKey: true, personaIds: null })).toBeNull();
    expect(personaScopeOf({ isApiKey: true, personaIds: ['persona-1'] })).toEqual(['persona-1']);
    expect(personaScopeOf({ isApiKey: true, personaIds: [] })).toEqual([]);
  });

  it('returns an in-scope slot', async () => {
    const { supabase } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: SCHEDULE_ROW, error: null },
      personas: { data: { id: 'persona-1', name: 'Viva Leve' }, error: null },
    });
    const detail = await getSlotPost(supabase, 'slot-1', 'user-1', ['persona-1']);
    expect(detail?.slot.id).toBe('slot-1');
  });

  it('returns null for a slot of another persona', async () => {
    const { supabase, from } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: SCHEDULE_ROW, error: null },
    });
    await expect(getSlotPost(supabase, 'slot-1', 'user-1', ['persona-2'])).resolves.toBeNull();
    expect(from).toHaveBeenCalledWith('schedules');
    expect(from).not.toHaveBeenCalledWith('personas');
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it('returns a persona-less slot to a scoped key', async () => {
    const { supabase } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: { ...SCHEDULE_ROW, persona_id: null }, error: null },
    });
    const detail = await getSlotPost(supabase, 'slot-1', 'user-1', []);
    expect(detail?.slot.id).toBe('slot-1');
    expect(detail?.persona).toBeNull();
  });

});

describe('getSlotPost prompt facts', () => {
  const VERSION_ID = '7b0e6c1e-0000-4000-8000-000000000001';
  const SLOT_WITH_PROMPT = { ...SLOT_ROW, prompt_version_id: VERSION_ID };
  const PERMISSION_DENIED = { code: '42501', message: 'permission denied for table prompt_versions' };
  const PUBLIC_PROMPT_OF_ANOTHER_USER = {
    slug: 'community-hook',
    title: 'Community hook',
    version: 2,
    source: 'user',
    owner_id: 'other-user',
  };

  function sessionTables(overrides: Record<string, { data: unknown; error: unknown }> = {}) {
    return {
      scheduled_posts: { data: SLOT_WITH_PROMPT, error: null },
      schedules: { data: SCHEDULE_ROW, error: null },
      personas: { data: { id: 'persona-1', name: 'Viva Leve' }, error: null },
      prompt_versions: { data: null, error: PERMISSION_DENIED },
      ...overrides,
    };
  }

  function useServiceClient(outcome: { data: unknown; error: unknown }) {
    const service = mockSupabase({ prompt_versions: outcome });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(service.supabase);
    return service;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the prompt version with the service client for a cookie-session caller, even when another user owns the public prompt', async () => {
    const session = mockSupabase(sessionTables());
    const service = useServiceClient({ data: PUBLIC_PROMPT_OF_ANOTHER_USER, error: null });
    const detail = await getSlotPost(session.supabase, 'slot-1', 'user-1', null);
    expect(detail?.prompt).toEqual({ slug: 'community-hook', title: 'Community hook', version: 2, source: 'user' });
    expect(session.from).not.toHaveBeenCalledWith('prompt_versions');
    expect(service.from).toHaveBeenCalledWith('prompt_versions');
    expect(service.chains['prompt_versions'].eq.mock.calls).toEqual([['id', VERSION_ID]]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('does not touch the service client when the slot is not the caller\'s', async () => {
    const session = mockSupabase(sessionTables({ scheduled_posts: { data: null, error: PGRST116 } }));
    await expect(getSlotPost(session.supabase, 'slot-1', 'user-1', null)).resolves.toBeNull();
    expect(session.chains['scheduled_posts'].eq.mock.calls).toContainEqual(['user_id', 'user-1']);
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it('does not touch the service client when the schedule is outside the API-key persona scope', async () => {
    const session = mockSupabase(sessionTables());
    await expect(getSlotPost(session.supabase, 'slot-1', 'user-1', ['persona-2'])).resolves.toBeNull();
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it('does not create the service client for a slot with no prompt version', async () => {
    const session = mockSupabase(sessionTables({ scheduled_posts: { data: { ...SLOT_ROW, prompt_version_id: null }, error: null } }));
    const detail = await getSlotPost(session.supabase, 'slot-1', 'user-1', null);
    expect(detail?.prompt).toBeNull();
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it('does not touch the service client when the schedule is not the caller\'s', async () => {
    const session = mockSupabase(sessionTables({ schedules: { data: null, error: null } }));
    await expect(getSlotPost(session.supabase, 'slot-1', 'user-1', null)).resolves.toBeNull();
    expect(session.chains['schedules'].eq.mock.calls).toContainEqual(['user_id', 'user-1']);
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it('logs at error level and hides the prompt when the service read fails', async () => {
    const session = mockSupabase(sessionTables());
    useServiceClient({ data: null, error: { code: 'XX000', message: 'down' } });
    const detail = await getSlotPost(session.supabase, 'slot-1', 'user-1', null);
    expect(detail?.prompt).toBeNull();
    expect(detail?.slot.id).toBe('slot-1');
    expect(logger.error).toHaveBeenCalledWith(
      '[prompt-versions] post prompt lookup failed',
      { code: 'XX000', message: 'down' },
      { versionId: VERSION_ID, code: 'XX000' },
    );
  });
});
