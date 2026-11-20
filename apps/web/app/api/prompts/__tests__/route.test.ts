// @vitest-environment node

import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireSupabaseSession = vi.hoisted(() => vi.fn());
const holder = vi.hoisted(() => ({ db: null as unknown }));
const applyRateLimit = vi.hoisted(() => vi.fn(async () => null));

vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession }));
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  applyRateLimit,
}));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: () => holder.db }));
vi.mock('@/lib/api-error-reporting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-error-reporting')>()),
  withApiErrorReporting: (_route: string, handler: unknown) => handler,
  resolveReportingUserId: vi.fn(),
}));

import { GET as listPrompts, POST as createPrompt } from '../route';
import { GET as getPrompt, PATCH as patchPrompt, DELETE as deletePrompt } from '../[slug]/route';
import { GetPromptResponseSchema, ListPromptsResponseSchema, USER_PROMPT_LIMITS } from '@/lib/contracts/prompts';
import { PROMPTS } from '@/app/recipes/prompts';
import { recipesI18nEn } from '@/lib/i18n/recipes-i18n-en';
import { DAILY_NEWS_PROMPT } from '@/lib/generation/prompt-base';
import { createFakeUserPromptsDb, type FakeUserPromptsDb } from '@/lib/__tests__/support/fake-user-prompts-db';

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function authenticatedAs(userId: string, extra: Record<string, unknown> = {}): void {
  requireSupabaseSession.mockResolvedValue({ auth: { userId, accessToken: 't', ...extra }, error: null });
}

function scopedKeyOf(userId: string): void {
  authenticatedAs(userId, { isApiKey: true, personaIds: [] });
}

function signedOut(status = 401): void {
  requireSupabaseSession.mockResolvedValue({
    auth: null,
    error: NextResponse.json({ success: false, error: 'Authentication required.' }, { status }),
  });
}

function request(path: string, init?: { method?: string; body?: unknown; rawBody?: string; credentials?: boolean }): Request {
  const hasBody = init?.body !== undefined || init?.rawBody !== undefined;
  const headers: Record<string, string> = {};
  if (init?.credentials !== false) headers.authorization = 'Bearer pe_test';
  if (hasBody) headers['content-type'] = 'application/json';
  return new Request(`https://post-engineer.test${path}`, {
    method: init?.method ?? 'GET',
    headers,
    body: init?.rawBody ?? (init?.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}

function slugContext(slug: string): { params: Promise<{ slug: string }> } {
  return { params: Promise.resolve({ slug }) };
}

function seedDb(seed: Parameters<typeof createFakeUserPromptsDb>[0] = []): FakeUserPromptsDb {
  const db = createFakeUserPromptsDb(seed);
  holder.db = db.client;
  return db;
}

function publicRow(owner: string, slug: string, title = 'Shared'): Record<string, unknown> {
  return { owner_id: owner, slug, title, description: 'About', body: 'Community text', visibility: 'public' };
}

beforeEach(() => {
  requireSupabaseSession.mockReset();
  applyRateLimit.mockClear();
  applyRateLimit.mockResolvedValue(null);
  seedDb();
});

describe('GET /api/prompts', () => {
  it('lists the official prompts first, in order, without prompt text', async () => {
    authenticatedAs(ALICE);
    const response = await listPrompts(request('/api/prompts'));
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(ListPromptsResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      success: true,
      prompts: PROMPTS.map((entry) => ({
        slug: entry.slug,
        title: expect.any(String),
        description: expect.any(String),
        source: 'official',
        visibility: 'public',
      })),
    });
    expect(JSON.stringify(body)).not.toContain(DAILY_NEWS_PROMPT.slice(0, 200));
    expect(body).toMatchObject({
      prompts: expect.arrayContaining([
        expect.objectContaining({ slug: 'daily-news', title: recipesI18nEn.dailyNewsTitle, description: recipesI18nEn.dailyNewsObjective }),
      ]),
    });
  });

  it('adds the caller own prompts, private ones included, and other users public prompts as community', async () => {
    seedDb([
      { owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'a' },
      { owner_id: BOB, slug: 'bobs-private', title: 'Bobs private', body: 'b' },
      publicRow(BOB, 'bobs-shared', 'Bobs shared'),
    ]);
    authenticatedAs(ALICE);
    const body = (await (await listPrompts(request('/api/prompts'))).json()) as { prompts: Array<Record<string, unknown>> };
    expect(body.prompts.slice(PROMPTS.length)).toEqual([
      { slug: 'mine', title: 'Mine', description: '', source: 'own', visibility: 'private' },
      { slug: 'bobs-shared', title: 'Bobs shared', description: 'About', source: 'community', visibility: 'public' },
    ]);
    expect(JSON.stringify(body)).not.toContain('bobs-private');
    expect(JSON.stringify(body)).not.toContain('Community text');
  });

  it('shows the caller own public prompt once, as own', async () => {
    seedDb([publicRow(ALICE, 'mine-shared', 'Mine shared')]);
    authenticatedAs(ALICE);
    const body = (await (await listPrompts(request('/api/prompts'))).json()) as { prompts: Array<{ slug: string; source: string }> };
    expect(body.prompts.filter((entry) => entry.slug === 'mine-shared')).toEqual([
      expect.objectContaining({ slug: 'mine-shared', source: 'own' }),
    ]);
  });

  it('hides a public prompt whose slug an official or own prompt already uses', async () => {
    seedDb([
      publicRow(BOB, 'daily-news', 'Fake official'),
      { owner_id: ALICE, slug: 'clash', title: 'Own clash', body: 'a' },
      publicRow(BOB, 'clash', 'Community clash'),
    ]);
    authenticatedAs(ALICE);
    const body = (await (await listPrompts(request('/api/prompts'))).json()) as { prompts: Array<{ slug: string; source: string }> };
    expect(body.prompts.filter((entry) => entry.slug === 'daily-news')).toHaveLength(1);
    expect(body.prompts.find((entry) => entry.slug === 'clash')?.source).toBe('own');
  });

  it('does not show a persona-scoped key the account private prompts', async () => {
    seedDb([{ owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'a' }]);
    scopedKeyOf(ALICE);
    const body = (await (await listPrompts(request('/api/prompts'))).json()) as { prompts: Array<{ slug: string }> };
    expect(body.prompts.map((entry) => entry.slug)).not.toContain('mine');
  });

  it('filters the list by search words across slug, title and description, case-insensitively', async () => {
    seedDb([
      { owner_id: ALICE, slug: 'weekly-report', title: 'Weekly Report', body: 'a', description: 'for the team' },
      { owner_id: ALICE, slug: 'other', title: 'Other', body: 'b' },
    ]);
    authenticatedAs(ALICE);
    const body = (await (await listPrompts(request('/api/prompts?q=WEEKLY%20team'))).json()) as { prompts: Array<{ slug: string }> };
    expect(body.prompts.map((entry) => entry.slug)).toEqual(['weekly-report']);
  });

  it('finds a prompt beyond the newest 200 because the search runs in the database before the cap', async () => {
    const filler = Array.from({ length: 205 }, (_, index) => ({
      owner_id: BOB,
      slug: `filler-${index}`,
      title: `Filler ${index}`,
      body: 'x',
      visibility: 'public' as const,
    }));
    const oldest = { owner_id: BOB, slug: 'needle-prompt', title: 'Needle', body: 'x', visibility: 'public' as const, created_at: '2020-01-01T00:00:00.000Z' };
    seedDb([oldest, ...filler]);
    authenticatedAs(ALICE);
    const everything = (await (await listPrompts(request('/api/prompts?source=community'))).json()) as { prompts: Array<{ slug: string }> };
    const searched = (await (await listPrompts(request('/api/prompts?q=needle'))).json()) as { prompts: Array<{ slug: string }> };
    expect(everything.prompts.map((entry) => entry.slug)).not.toContain('needle-prompt');
    expect(searched.prompts.map((entry) => entry.slug)).toEqual(['needle-prompt']);
  });

  it('reads only the lists the requested source needs', async () => {
    const db = seedDb([{ owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'a' }, publicRow(BOB, 'theirs')]);
    authenticatedAs(ALICE);
    await listPrompts(request('/api/prompts?source=official'));
    expect(db.queries).toEqual([]);
    await listPrompts(request('/api/prompts?source=own'));
    expect(db.queries.some((query) => query.includes('eq visibility=public'))).toBe(false);
    db.queries.length = 0;
    await listPrompts(request('/api/prompts?source=community'));
    expect(db.queries.some((query) => query.includes('eq owner_id='))).toBe(false);
  });

  it('filters the list by source', async () => {
    seedDb([{ owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'a' }, publicRow(BOB, 'theirs')]);
    authenticatedAs(ALICE);
    const own = (await (await listPrompts(request('/api/prompts?source=own'))).json()) as { prompts: Array<{ slug: string }> };
    const community = (await (await listPrompts(request('/api/prompts?source=community'))).json()) as { prompts: Array<{ slug: string }> };
    expect(own.prompts.map((entry) => entry.slug)).toEqual(['mine']);
    expect(community.prompts.map((entry) => entry.slug)).toEqual(['theirs']);
  });

  it('rejects an unknown source, an unknown parameter and an over-long query with 400 before reading the database', async () => {
    const db = seedDb();
    authenticatedAs(ALICE);
    for (const path of ['/api/prompts?source=mine', '/api/prompts?sort=asc', `/api/prompts?q=${'x'.repeat(101)}`]) {
      const response = await listPrompts(request(path));
      expect(response.status).toBe(400);
    }
    expect(db.queries).toEqual([]);
  });

  it('shows a persona-scoped key the account own public prompt, as community', async () => {
    seedDb([{ owner_id: ALICE, slug: 'mine-shared', title: 'Mine shared', body: 'Community text', visibility: 'public' }]);
    scopedKeyOf(ALICE);
    const body = (await (await listPrompts(request('/api/prompts'))).json()) as { prompts: Array<{ slug: string; source: string }> };
    expect(body.prompts.filter((entry) => entry.slug === 'mine-shared')).toEqual([
      { slug: 'mine-shared', title: 'Mine shared', description: '', source: 'community', visibility: 'public' },
    ]);
  });

  it('serves the official and public prompts to a caller with no credentials, limited by IP, and never a private one', async () => {
    seedDb([
      { owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'secret text' },
      publicRow(BOB, 'bobs-shared'),
    ]);
    signedOut();
    const response = await listPrompts(request('/api/prompts', { credentials: false }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { prompts: Array<{ slug: string; source: string }> };
    expect(body.prompts.map((entry) => entry.slug)).toContain('bobs-shared');
    expect(body.prompts.map((entry) => entry.slug)).toContain('daily-news');
    expect(JSON.stringify(body)).not.toContain('mine');
    expect(applyRateLimit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: 'prompts-read' }));
  });

  it('answers 401 to a caller whose API key is invalid instead of falling back to the public view', async () => {
    signedOut();
    expect((await listPrompts(request('/api/prompts'))).status).toBe(401);
  });

  it('passes a non-401 auth response through, such as an MCP version mismatch', async () => {
    signedOut(426);
    expect((await listPrompts(request('/api/prompts', { credentials: false }))).status).toBe(426);
  });

  it('returns the rate limit response when an anonymous caller is limited', async () => {
    signedOut();
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({ success: false }, { status: 429 }) as never);
    expect((await listPrompts(request('/api/prompts', { credentials: false }))).status).toBe(429);
  });

  it('returns a logged 500 when the database read fails', async () => {
    const db = seedDb();
    db.failNext('XX000');
    authenticatedAs(ALICE);
    expect((await listPrompts(request('/api/prompts'))).status).toBe(500);
  });
});

describe('POST /api/prompts', () => {
  const valid = { slug: 'my-prompt', title: 'Title', description: 'About', prompt: 'Body text' };

  it('creates a private prompt by default and returns it', async () => {
    const db = seedDb();
    authenticatedAs(ALICE);
    const response = await createPrompt(request('/api/prompts', { method: 'POST', body: valid }));
    expect(response.status).toBe(201);
    const body: unknown = await response.json();
    expect(GetPromptResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      success: true,
      prompt: { slug: 'my-prompt', title: 'Title', description: 'About', source: 'own', visibility: 'private', prompt: 'Body text' },
    });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].owner_id).toBe(ALICE);
  });

  it('creates a public prompt in one call, with no review', async () => {
    const db = seedDb();
    authenticatedAs(ALICE);
    const response = await createPrompt(request('/api/prompts', { method: 'POST', body: { ...valid, visibility: 'public' } }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ prompt: { visibility: 'public' } });
    expect(db.rows[0].visibility).toBe('public');
  });

  it('stores an empty description when none is sent', async () => {
    const db = seedDb();
    authenticatedAs(ALICE);
    await createPrompt(request('/api/prompts', { method: 'POST', body: { slug: 'no-about', title: 'T', prompt: 'P' } }));
    expect(db.rows[0].description).toBe('');
  });

  it.each([
    ['a malformed slug', { ...valid, slug: 'Bad Slug' }, 'slug'],
    ['an empty title', { ...valid, title: '' }, 'title'],
    ['an over-long title', { ...valid, title: 'x'.repeat(USER_PROMPT_LIMITS.title + 1) }, 'title'],
    ['an over-long description', { ...valid, description: 'x'.repeat(USER_PROMPT_LIMITS.description + 1) }, 'description'],
    ['an empty prompt', { ...valid, prompt: '' }, 'prompt'],
    ['an over-long prompt', { ...valid, prompt: 'x'.repeat(USER_PROMPT_LIMITS.prompt + 1) }, 'prompt'],
    ['an unknown visibility', { ...valid, visibility: 'approved' }, 'visibility'],
    ['an unknown field', { ...valid, owner_id: BOB }, undefined],
  ])('returns 400 for %s without writing anything', async (_label, body, field) => {
    const db = seedDb();
    authenticatedAs(ALICE);
    const response = await createPrompt(request('/api/prompts', { method: 'POST', body }));
    expect(response.status).toBe(400);
    if (field !== undefined) expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED', field });
    expect(db.rows).toEqual([]);
    expect(db.queries).toEqual([]);
  });

  it('returns 400 for a body that is not JSON', async () => {
    const db = seedDb();
    authenticatedAs(ALICE);
    expect((await createPrompt(request('/api/prompts', { method: 'POST', rawBody: '{nope' }))).status).toBe(400);
    expect(db.queries).toEqual([]);
  });

  it('returns 409 PROMPT_SLUG_RESERVED for an official slug and never queries the database', async () => {
    const db = seedDb();
    authenticatedAs(ALICE);
    const response = await createPrompt(request('/api/prompts', { method: 'POST', body: { ...valid, slug: 'daily-news' } }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'PROMPT_SLUG_RESERVED' });
    expect(db.queries).toEqual([]);
  });

  it('returns 409 PROMPT_SLUG_TAKEN when the owner already has the slug, and when the slug is public and taken', async () => {
    seedDb([{ owner_id: ALICE, slug: 'my-prompt', title: 'Old', body: 'a' }]);
    authenticatedAs(ALICE);
    expect((await createPrompt(request('/api/prompts', { method: 'POST', body: valid }))).status).toBe(409);
    seedDb([publicRow(BOB, 'my-prompt')]);
    const response = await createPrompt(request('/api/prompts', { method: 'POST', body: { ...valid, visibility: 'public' } }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'PROMPT_SLUG_TAKEN' });
  });

  it('answers 401 to a caller with no credentials before touching the database', async () => {
    const db = seedDb();
    signedOut();
    expect((await createPrompt(request('/api/prompts', { method: 'POST', body: valid, credentials: false }))).status).toBe(401);
    expect(db.queries).toEqual([]);
  });

  it('returns 403 to a persona-scoped key before touching the database', async () => {
    const db = seedDb();
    scopedKeyOf(ALICE);
    expect((await createPrompt(request('/api/prompts', { method: 'POST', body: valid }))).status).toBe(403);
    expect(db.queries).toEqual([]);
  });

  it('applies the write rate limit to the caller', async () => {
    authenticatedAs(ALICE);
    await createPrompt(request('/api/prompts', { method: 'POST', body: valid }));
    expect(applyRateLimit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: 'prompts-write' }), ALICE);
  });
});

describe('GET /api/prompts/[slug]', () => {
  it('returns 401 without a valid API key and never reads the slug', async () => {
    const params = vi.fn();
    signedOut();
    const context = { get params(): Promise<{ slug: string }> { params(); return Promise.resolve({ slug: 'daily-news' }); } };
    const response = await getPrompt(request('/api/prompts/daily-news'), context);
    expect(response.status).toBe(401);
    expect(params).not.toHaveBeenCalled();
  });

  it('returns the full official recipe for a known slug without querying the database', async () => {
    const db = seedDb();
    authenticatedAs(ALICE);
    const response = await getPrompt(request('/api/prompts/daily-news'), slugContext('daily-news'));
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toEqual({
      success: true,
      prompt: {
        slug: 'daily-news',
        title: recipesI18nEn.dailyNewsTitle,
        description: recipesI18nEn.dailyNewsObjective,
        source: 'official',
        visibility: 'public',
        prompt: DAILY_NEWS_PROMPT,
      },
    });
    expect(GetPromptResponseSchema.safeParse(body).success).toBe(true);
    expect(db.queries).toEqual([]);
  });

  it('serves an official prompt and a public one to a caller with no credentials', async () => {
    seedDb([publicRow(BOB, 'bobs-shared')]);
    signedOut();
    expect((await getPrompt(request('/api/prompts/daily-news', { credentials: false }), slugContext('daily-news'))).status).toBe(200);
    const response = await getPrompt(request('/api/prompts/bobs-shared', { credentials: false }), slugContext('bobs-shared'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ prompt: { slug: 'bobs-shared', source: 'community', visibility: 'public', prompt: 'Community text' } });
  });

  it('returns 404 to a caller with no credentials for a private prompt', async () => {
    seedDb([{ owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'secret text' }]);
    signedOut();
    const response = await getPrompt(request('/api/prompts/mine', { credentials: false }), slugContext('mine'));
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain('secret text');
  });

  it('decodes a percent-encoded slug before matching', async () => {
    authenticatedAs(ALICE);
    const response = await getPrompt(request('/api/prompts/daily%2Dnews'), slugContext('daily%2Dnews'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ prompt: { slug: 'daily-news' } });
  });

  it('returns 400 on a malformed percent-encoding', async () => {
    authenticatedAs(ALICE);
    expect((await getPrompt(request('/api/prompts/%E0%A4%A'), slugContext('%E0%A4%A'))).status).toBe(400);
  });

  it('returns the caller own private prompt with its visibility', async () => {
    seedDb([{ owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'secret text' }]);
    authenticatedAs(ALICE);
    const response = await getPrompt(request('/api/prompts/mine'), slugContext('mine'));
    expect(await response.json()).toMatchObject({ prompt: { slug: 'mine', source: 'own', visibility: 'private', prompt: 'secret text' } });
  });

  it('returns 404 for another owner private prompt, same as an unknown slug', async () => {
    seedDb([{ owner_id: BOB, slug: 'bobs', title: 'Bobs', body: 'secret text' }]);
    authenticatedAs(ALICE);
    const response = await getPrompt(request('/api/prompts/bobs'), slugContext('bobs'));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'PROMPT_NOT_FOUND' });
    expect(JSON.stringify(body)).not.toContain('secret text');
  });

  it('returns another owner public prompt as community', async () => {
    seedDb([publicRow(BOB, 'bobs-shared')]);
    authenticatedAs(ALICE);
    const response = await getPrompt(request('/api/prompts/bobs-shared'), slugContext('bobs-shared'));
    expect(await response.json()).toMatchObject({ prompt: { slug: 'bobs-shared', source: 'community', visibility: 'public', prompt: 'Community text' } });
  });

  it('returns 404 for a slug that cannot be a prompt without querying the database', async () => {
    const db = seedDb();
    authenticatedAs(ALICE);
    expect((await getPrompt(request('/api/prompts/Not%20A%20Slug'), slugContext('Not%20A%20Slug'))).status).toBe(404);
    expect(db.queries).toEqual([]);
  });

  it('returns 404 with the PROMPT_NOT_FOUND code for an unknown slug', async () => {
    authenticatedAs(ALICE);
    const response = await getPrompt(request('/api/prompts/nope'), slugContext('nope'));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ success: false, code: 'PROMPT_NOT_FOUND' });
  });

  it('keeps a persona-scoped key away from the account private prompts', async () => {
    seedDb([{ owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'secret text' }]);
    scopedKeyOf(ALICE);
    expect((await getPrompt(request('/api/prompts/mine'), slugContext('mine'))).status).toBe(404);
  });
});

describe('PATCH /api/prompts/[slug]', () => {
  it('edits the supplied fields of the caller prompt and keeps the rest', async () => {
    const db = seedDb([{ owner_id: ALICE, slug: 'mine', title: 'Old', description: 'Keep', body: 'old body' }]);
    authenticatedAs(ALICE);
    const response = await patchPrompt(request('/api/prompts/mine', { method: 'PATCH', body: { title: 'New', prompt: 'new body' } }), slugContext('mine'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ prompt: { title: 'New', description: 'Keep', prompt: 'new body', visibility: 'private' } });
    expect(db.rows[0]).toMatchObject({ title: 'New', description: 'Keep', body: 'new body' });
  });

  it('makes a prompt public and private again with no review in between', async () => {
    const db = seedDb([{ owner_id: ALICE, slug: 'mine', title: 'T', body: 'a' }]);
    authenticatedAs(ALICE);
    const published = await patchPrompt(request('/api/prompts/mine', { method: 'PATCH', body: { visibility: 'public' } }), slugContext('mine'));
    expect(await published.json()).toMatchObject({ prompt: { visibility: 'public' } });
    expect(db.rows[0].visibility).toBe('public');
    await patchPrompt(request('/api/prompts/mine', { method: 'PATCH', body: { visibility: 'private' } }), slugContext('mine'));
    expect(db.rows[0].visibility).toBe('private');
  });

  it('keeps a public prompt public when its text changes', async () => {
    const db = seedDb([publicRow(ALICE, 'mine')]);
    authenticatedAs(ALICE);
    await patchPrompt(request('/api/prompts/mine', { method: 'PATCH', body: { prompt: 'changed' } }), slugContext('mine'));
    expect(db.rows[0]).toMatchObject({ visibility: 'public', body: 'changed' });
  });

  it('returns 409 PROMPT_SLUG_TAKEN when another public prompt already owns the slug', async () => {
    const db = seedDb([publicRow(BOB, 'same'), { owner_id: ALICE, slug: 'same', title: 'Mine', body: 'a' }]);
    authenticatedAs(ALICE);
    const response = await patchPrompt(request('/api/prompts/same', { method: 'PATCH', body: { visibility: 'public' } }), slugContext('same'));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'PROMPT_SLUG_TAKEN' });
    expect(db.rows[1].visibility).toBe('private');
  });

  it('returns 400 for an empty patch and for a field the caller may not set', async () => {
    const db = seedDb([{ owner_id: ALICE, slug: 'mine', title: 'Old', body: 'old body' }]);
    authenticatedAs(ALICE);
    for (const body of [{}, { slug: 'renamed' }, { owner_id: BOB }, { visibility: 'approved' }]) {
      expect((await patchPrompt(request('/api/prompts/mine', { method: 'PATCH', body }), slugContext('mine'))).status).toBe(400);
    }
    expect(db.queries).toEqual([]);
  });

  it('returns 404 and changes nothing for another owner prompt, even a public one', async () => {
    const db = seedDb([publicRow(BOB, 'bobs-shared', 'Bobs')]);
    authenticatedAs(ALICE);
    const response = await patchPrompt(request('/api/prompts/bobs-shared', { method: 'PATCH', body: { title: 'Mine now', prompt: 'hijacked' } }), slugContext('bobs-shared'));
    expect(response.status).toBe(404);
    expect(db.rows[0]).toMatchObject({ title: 'Bobs', body: 'Community text', owner_id: BOB });
  });

  it('answers 401 to a caller with no credentials and 403 to a persona-scoped key, without querying', async () => {
    const db = seedDb([{ owner_id: ALICE, slug: 'mine', title: 'Old', body: 'old' }]);
    signedOut();
    expect((await patchPrompt(request('/api/prompts/mine', { method: 'PATCH', body: { title: 'New' }, credentials: false }), slugContext('mine'))).status).toBe(401);
    scopedKeyOf(ALICE);
    expect((await patchPrompt(request('/api/prompts/mine', { method: 'PATCH', body: { title: 'New' } }), slugContext('mine'))).status).toBe(403);
    expect(db.queries).toEqual([]);
  });
});

describe('DELETE /api/prompts/[slug]', () => {
  it('deletes the caller prompt', async () => {
    const db = seedDb([{ owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'a' }]);
    authenticatedAs(ALICE);
    const response = await deletePrompt(request('/api/prompts/mine', { method: 'DELETE' }), slugContext('mine'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(db.rows).toEqual([]);
  });

  it('returns 404 and keeps another owner prompt, even a public one', async () => {
    const db = seedDb([publicRow(BOB, 'bobs-shared')]);
    authenticatedAs(ALICE);
    expect((await deletePrompt(request('/api/prompts/bobs-shared', { method: 'DELETE' }), slugContext('bobs-shared'))).status).toBe(404);
    expect(db.rows).toHaveLength(1);
  });

  it('answers 401 to a caller with no credentials and 403 to a persona-scoped key, keeping the prompt', async () => {
    const db = seedDb([{ owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'a' }]);
    signedOut();
    expect((await deletePrompt(request('/api/prompts/mine', { method: 'DELETE', credentials: false }), slugContext('mine'))).status).toBe(401);
    scopedKeyOf(ALICE);
    expect((await deletePrompt(request('/api/prompts/mine', { method: 'DELETE' }), slugContext('mine'))).status).toBe(403);
    expect(db.rows).toHaveLength(1);
  });
});

describe('database failures answer a logged 500, never a partial success', () => {
  const body = { slug: 'my-prompt', title: 'T', prompt: 'P' };

  it('on create, update and delete', async () => {
    const db = seedDb([{ owner_id: ALICE, slug: 'mine', title: 'T', body: 'a' }]);
    authenticatedAs(ALICE);
    db.failNext('XX000');
    expect((await createPrompt(request('/api/prompts', { method: 'POST', body }))).status).toBe(500);
    db.failNext('XX000');
    expect((await patchPrompt(request('/api/prompts/mine', { method: 'PATCH', body: { title: 'New' } }), slugContext('mine'))).status).toBe(500);
    db.failNext('XX000');
    expect((await deletePrompt(request('/api/prompts/mine', { method: 'DELETE' }), slugContext('mine'))).status).toBe(500);
    expect(db.rows[0].title).toBe('T');
  });

  it('on reading one prompt, own or public', async () => {
    const db = seedDb([{ owner_id: ALICE, slug: 'mine', title: 'T', body: 'a' }]);
    authenticatedAs(ALICE);
    db.failNext('XX000');
    expect((await getPrompt(request('/api/prompts/mine'), slugContext('mine'))).status).toBe(500);
    signedOut();
    db.failNext('XX000');
    expect((await getPrompt(request('/api/prompts/mine', { credentials: false }), slugContext('mine'))).status).toBe(500);
  });

  it('on an unexpected error that is not a store error', async () => {
    holder.db = { from: (): never => { throw new Error('connection reset'); } };
    authenticatedAs(ALICE);
    const response = await listPrompts(request('/api/prompts'));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('connection reset');
  });

  it('returns 400 on a malformed percent-encoded slug for update and delete', async () => {
    const db = seedDb();
    authenticatedAs(ALICE);
    expect((await patchPrompt(request('/api/prompts/%E0%A4%A', { method: 'PATCH', body: { title: 'T' } }), slugContext('%E0%A4%A'))).status).toBe(400);
    expect((await deletePrompt(request('/api/prompts/%E0%A4%A', { method: 'DELETE' }), slugContext('%E0%A4%A'))).status).toBe(400);
    expect(db.queries).toEqual([]);
  });

  it('returns 404 for a slug that cannot be a prompt on update and delete, without querying', async () => {
    const db = seedDb();
    authenticatedAs(ALICE);
    expect((await patchPrompt(request('/api/prompts/Bad%20Slug', { method: 'PATCH', body: { title: 'T' } }), slugContext('Bad%20Slug'))).status).toBe(404);
    expect((await deletePrompt(request('/api/prompts/Bad%20Slug', { method: 'DELETE' }), slugContext('Bad%20Slug'))).status).toBe(404);
    expect(db.queries).toEqual([]);
  });

  it('returns 404 when updating an unknown own prompt', async () => {
    seedDb();
    authenticatedAs(ALICE);
    expect((await patchPrompt(request('/api/prompts/nope', { method: 'PATCH', body: { title: 'T' } }), slugContext('nope'))).status).toBe(404);
  });
});
