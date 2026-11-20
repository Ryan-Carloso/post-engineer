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
import {
  GetPromptResponseSchema,
  ListPromptsResponseSchema,
  USER_PROMPT_LIMITS,
} from '@/lib/contracts/prompts';
import { PROMPTS } from '@/app/recipes/prompts';
import { recipesI18nEn } from '@/lib/i18n/recipes-i18n-en';
import { DAILY_NEWS_PROMPT } from '@/lib/generation/prompt-base';
import { contentHashOf, createFakeUserPromptsDb, type FakeUserPromptsDb } from '@/lib/__tests__/support/fake-user-prompts-db';

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REVIEWER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function authenticatedAs(userId: string, extra: Record<string, unknown> = {}): void {
  requireSupabaseSession.mockResolvedValue({ auth: { userId, accessToken: 't', ...extra }, error: null });
}

function scopedKeyOf(userId: string): void {
  authenticatedAs(userId, { isApiKey: true, personaIds: [] });
}

function request(path: string, init?: { method?: string; body?: unknown; rawBody?: string }): Request {
  const hasBody = init?.body !== undefined || init?.rawBody !== undefined;
  return new Request(`https://post-engineer.test${path}`, {
    method: init?.method ?? 'GET',
    headers: { authorization: 'Bearer pe_test', ...(hasBody ? { 'content-type': 'application/json' } : {}) },
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

function approvedRow(owner: string, slug: string, title = 'Shared'): Record<string, unknown> {
  return {
    owner_id: owner,
    slug,
    title,
    description: 'About',
    body: 'Community text',
    status: 'approved',
    approved_hash: contentHashOf(title, 'About', 'Community text'),
    reviewed_by: REVIEWER,
    reviewed_at: new Date().toISOString(),
  };
}

beforeEach(() => {
  requireSupabaseSession.mockReset();
  applyRateLimit.mockClear();
  applyRateLimit.mockResolvedValue(null);
  seedDb();
});

describe('GET /api/prompts', () => {
  it('returns 401 without auth and never queries the database', async () => {
    const db = seedDb();
    requireSupabaseSession.mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 }),
    });
    const response = await listPrompts(request('/api/prompts'));
    expect(response.status).toBe(401);
    expect(db.queries).toEqual([]);
  });

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
        status: null,
        rejectionReason: null,
      })),
    });
    expect(JSON.stringify(body)).not.toContain(DAILY_NEWS_PROMPT.slice(0, 200));
    expect(body).toMatchObject({
      prompts: expect.arrayContaining([
        expect.objectContaining({ slug: 'daily-news', title: recipesI18nEn.dailyNewsTitle, description: recipesI18nEn.dailyNewsObjective }),
      ]),
    });
  });

  it('adds the caller own prompts with their status and other owners approved prompts as community', async () => {
    seedDb([
      { owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'a', status: 'rejected', rejection_reason: 'Too vague' },
      { owner_id: BOB, slug: 'bobs-private', title: 'Bobs private', body: 'b' },
      approvedRow(BOB, 'bobs-shared', 'Bobs shared'),
    ]);
    authenticatedAs(ALICE);
    const body = (await (await listPrompts(request('/api/prompts'))).json()) as { prompts: Array<Record<string, unknown>> };
    const extra = body.prompts.slice(PROMPTS.length);
    expect(extra).toEqual([
      { slug: 'mine', title: 'Mine', description: '', source: 'own', status: 'rejected', rejectionReason: 'Too vague' },
      { slug: 'bobs-shared', title: 'Bobs shared', description: 'About', source: 'community', status: null, rejectionReason: null },
    ]);
    expect(JSON.stringify(body)).not.toContain('bobs-private');
    expect(JSON.stringify(body)).not.toContain('Community text');
  });

  it('shows the caller own approved prompt once, as own', async () => {
    seedDb([approvedRow(ALICE, 'mine-shared', 'Mine shared')]);
    authenticatedAs(ALICE);
    const body = (await (await listPrompts(request('/api/prompts'))).json()) as { prompts: Array<{ slug: string; source: string }> };
    expect(body.prompts.filter((entry) => entry.slug === 'mine-shared')).toEqual([
      expect.objectContaining({ slug: 'mine-shared', source: 'own' }),
    ]);
  });

  it('hides a community prompt whose slug an official or own prompt already uses', async () => {
    seedDb([
      approvedRow(BOB, 'daily-news', 'Fake official'),
      { owner_id: ALICE, slug: 'clash', title: 'Own clash', body: 'a' },
      approvedRow(BOB, 'clash', 'Community clash'),
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

  it('returns a logged 500 when the database read fails', async () => {
    const db = seedDb();
    db.failNext('XX000');
    authenticatedAs(ALICE);
    expect((await listPrompts(request('/api/prompts'))).status).toBe(500);
  });
});

describe('POST /api/prompts', () => {
  const valid = { slug: 'my-prompt', title: 'Title', description: 'About', prompt: 'Body text' };

  it('creates a private prompt and returns it with status private', async () => {
    const db = seedDb();
    authenticatedAs(ALICE);
    const response = await createPrompt(request('/api/prompts', { method: 'POST', body: valid }));
    expect(response.status).toBe(201);
    const body: unknown = await response.json();
    expect(GetPromptResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      success: true,
      prompt: { slug: 'my-prompt', title: 'Title', description: 'About', source: 'own', status: 'private', rejectionReason: null, prompt: 'Body text' },
    });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].owner_id).toBe(ALICE);
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
    ['an unknown field', { ...valid, status: 'approved' }, undefined],
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
    const response = await createPrompt(request('/api/prompts', { method: 'POST', rawBody: '{nope' }));
    expect(response.status).toBe(400);
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

  it('returns 409 PROMPT_SLUG_TAKEN when the owner already has the slug', async () => {
    seedDb([{ owner_id: ALICE, slug: 'my-prompt', title: 'Old', body: 'a' }]);
    authenticatedAs(ALICE);
    const response = await createPrompt(request('/api/prompts', { method: 'POST', body: valid }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'PROMPT_SLUG_TAKEN' });
  });

  it('returns 403 to a persona-scoped key before touching the database', async () => {
    const db = seedDb();
    scopedKeyOf(ALICE);
    const response = await createPrompt(request('/api/prompts', { method: 'POST', body: valid }));
    expect(response.status).toBe(403);
    expect(db.queries).toEqual([]);
  });

  it('applies the write rate limit to the caller', async () => {
    authenticatedAs(ALICE);
    await createPrompt(request('/api/prompts', { method: 'POST', body: valid }));
    expect(applyRateLimit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: 'prompts-write' }), ALICE);
  });

  it('returns the rate limit response untouched when the caller is limited', async () => {
    const db = seedDb();
    authenticatedAs(ALICE);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({ success: false }, { status: 429 }) as never);
    expect((await createPrompt(request('/api/prompts', { method: 'POST', body: valid }))).status).toBe(429);
    expect(db.queries).toEqual([]);
  });
});

describe('GET /api/prompts/[slug]', () => {
  it('returns 401 without auth and never reads the slug', async () => {
    const params = vi.fn();
    requireSupabaseSession.mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 }),
    });
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
        status: null,
        rejectionReason: null,
        prompt: DAILY_NEWS_PROMPT,
      },
    });
    expect(GetPromptResponseSchema.safeParse(body).success).toBe(true);
    expect(db.queries).toEqual([]);
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

  it('returns the caller own prompt with its status, even while private', async () => {
    seedDb([{ owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'secret text' }]);
    authenticatedAs(ALICE);
    const response = await getPrompt(request('/api/prompts/mine'), slugContext('mine'));
    expect(await response.json()).toMatchObject({
      prompt: { slug: 'mine', source: 'own', status: 'private', prompt: 'secret text' },
    });
  });

  it('returns 404 for another owner private prompt, same as an unknown slug', async () => {
    seedDb([{ owner_id: BOB, slug: 'bobs', title: 'Bobs', body: 'secret text' }]);
    authenticatedAs(ALICE);
    const response = await getPrompt(request('/api/prompts/bobs'), slugContext('bobs'));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'PROMPT_NOT_FOUND' });
    expect(JSON.stringify(await getPrompt(request('/api/prompts/bobs'), slugContext('bobs')).then((r) => r.json()))).not.toContain('secret text');
  });

  it('returns another owner approved prompt as community with no status', async () => {
    seedDb([approvedRow(BOB, 'bobs-shared')]);
    authenticatedAs(ALICE);
    const response = await getPrompt(request('/api/prompts/bobs-shared'), slugContext('bobs-shared'));
    expect(await response.json()).toMatchObject({
      prompt: { slug: 'bobs-shared', source: 'community', status: null, rejectionReason: null, prompt: 'Community text' },
    });
  });

  it('returns 404 for a community prompt whose approved hash no longer matches the text', async () => {
    seedDb([{ ...approvedRow(BOB, 'bobs-shared'), approved_hash: 'f'.repeat(64) }]);
    authenticatedAs(ALICE);
    expect((await getPrompt(request('/api/prompts/bobs-shared'), slugContext('bobs-shared'))).status).toBe(404);
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
  it('edits the supplied fields of the caller prompt', async () => {
    const db = seedDb([{ owner_id: ALICE, slug: 'mine', title: 'Old', description: 'Keep', body: 'old body' }]);
    authenticatedAs(ALICE);
    const response = await patchPrompt(request('/api/prompts/mine', { method: 'PATCH', body: { title: 'New', prompt: 'new body' } }), slugContext('mine'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ prompt: { title: 'New', description: 'Keep', prompt: 'new body' } });
    expect(db.rows[0]).toMatchObject({ title: 'New', description: 'Keep', body: 'new body' });
  });

  it('answers pending when the edited prompt was approved, so the old approval cannot cover new text', async () => {
    const db = seedDb([approvedRow(ALICE, 'mine')]);
    authenticatedAs(ALICE);
    const response = await patchPrompt(request('/api/prompts/mine', { method: 'PATCH', body: { prompt: 'changed' } }), slugContext('mine'));
    expect(await response.json()).toMatchObject({ prompt: { status: 'pending' } });
    expect(db.rows[0]).toMatchObject({ status: 'pending', approved_hash: null });
  });

  it('returns 400 for an empty patch and for a field the caller may not set', async () => {
    const db = seedDb([{ owner_id: ALICE, slug: 'mine', title: 'Old', body: 'old body' }]);
    authenticatedAs(ALICE);
    expect((await patchPrompt(request('/api/prompts/mine', { method: 'PATCH', body: {} }), slugContext('mine'))).status).toBe(400);
    expect((await patchPrompt(request('/api/prompts/mine', { method: 'PATCH', body: { status: 'approved' } }), slugContext('mine'))).status).toBe(400);
    expect((await patchPrompt(request('/api/prompts/mine', { method: 'PATCH', body: { slug: 'renamed' } }), slugContext('mine'))).status).toBe(400);
    expect(db.queries).toEqual([]);
  });

  it('returns 404 and changes nothing for another owner prompt', async () => {
    const db = seedDb([{ owner_id: BOB, slug: 'bobs', title: 'Bobs', body: 'b' }]);
    authenticatedAs(ALICE);
    const response = await patchPrompt(request('/api/prompts/bobs', { method: 'PATCH', body: { title: 'Mine now' } }), slugContext('bobs'));
    expect(response.status).toBe(404);
    expect(db.rows[0].title).toBe('Bobs');
  });

  it('returns 403 to a persona-scoped key', async () => {
    const db = seedDb([{ owner_id: ALICE, slug: 'mine', title: 'Old', body: 'old' }]);
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

  it('returns 404 and keeps another owner prompt', async () => {
    const db = seedDb([{ owner_id: BOB, slug: 'bobs', title: 'Bobs', body: 'b' }]);
    authenticatedAs(ALICE);
    expect((await deletePrompt(request('/api/prompts/bobs', { method: 'DELETE' }), slugContext('bobs'))).status).toBe(404);
    expect(db.rows).toHaveLength(1);
  });

  it('returns 403 to a persona-scoped key and keeps the prompt', async () => {
    const db = seedDb([{ owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'a' }]);
    scopedKeyOf(ALICE);
    expect((await deletePrompt(request('/api/prompts/mine', { method: 'DELETE' }), slugContext('mine'))).status).toBe(403);
    expect(db.rows).toHaveLength(1);
  });
});
