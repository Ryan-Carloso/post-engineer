// @vitest-environment node

import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireSupabaseSession = vi.hoisted(() => vi.fn());
const holder = vi.hoisted(() => ({ db: null as unknown }));
const applyRateLimit = vi.hoisted(() => vi.fn(async () => null));
const loggerError = vi.hoisted(() => vi.fn());

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
vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  return { ...actual, logger: { ...actual.logger, error: loggerError } };
});

import { GET as listVersions } from '../[slug]/versions/route';
import { GET as getVersion } from '../[slug]/versions/[version]/route';
import { POST as restoreVersion } from '../[slug]/versions/[version]/restore/route';
import { POST as createPrompt } from '../route';
import { DELETE as deletePrompt, PATCH as patchPrompt } from '../[slug]/route';
import { RATE_LIMITS } from '@/lib/rate-limit';
import {
  GetPromptVersionResponseSchema,
  ListPromptVersionsResponseSchema,
  PROMPT_VERSION_PREVIEW_LENGTH,
  RestorePromptVersionResponseSchema,
} from '@/lib/contracts/prompts';
import { createFakeUserPromptsDb, type FakeUserPromptsDb } from '@/lib/__tests__/support/fake-user-prompts-db';

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SYSTEM = '00000000-0000-4000-8000-0000000000e1';

function authenticatedAs(userId: string, extra: Record<string, unknown> = {}): void {
  requireSupabaseSession.mockResolvedValue({ auth: { userId, accessToken: 't', ...extra }, error: null });
}

function scopedKeyOf(userId: string): void {
  authenticatedAs(userId, { isApiKey: true, personaIds: [] });
}

function signedOut(): void {
  requireSupabaseSession.mockResolvedValue({
    auth: null,
    error: NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 }),
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

function versionContext(slug: string, version: string): { params: Promise<{ slug: string; version: string }> } {
  return { params: Promise.resolve({ slug, version }) };
}

function seedDb(seed: Parameters<typeof createFakeUserPromptsDb>[0] = []): FakeUserPromptsDb {
  const db = createFakeUserPromptsDb(seed);
  holder.db = db.client;
  return db;
}

async function writeVersions(slug: string, bodies: string[]): Promise<void> {
  for (const body of bodies) {
    const response = await patchPrompt(request(`/api/prompts/${slug}`, { method: 'PATCH', body: { prompt: body } }), slugContext(slug));
    expect(response.status).toBe(200);
  }
}

function listCall(slug: string, query = ''): Promise<Response> {
  return listVersions(request(`/api/prompts/${slug}/versions${query}`), slugContext(slug));
}

function getCall(slug: string, version: string): Promise<Response> {
  return getVersion(request(`/api/prompts/${slug}/versions/${version}`), versionContext(slug, version));
}

function restoreCall(slug: string, version: string, body: unknown = { expectedCurrentVersion: 3 }, credentials = true): Promise<Response> {
  return restoreVersion(
    request(`/api/prompts/${slug}/versions/${version}/restore`, { method: 'POST', body, credentials }),
    versionContext(slug, version),
  );
}

const ALICE_PROMPT = { owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'v1 text' };

beforeEach(() => {
  requireSupabaseSession.mockReset();
  applyRateLimit.mockClear();
  applyRateLimit.mockResolvedValue(null);
  loggerError.mockReset();
  seedDb();
});

describe('GET /api/prompts/[slug]/versions', () => {
  it('lists the owner versions newest first with the current one marked', async () => {
    seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    await writeVersions('mine', ['v2 text', 'v3 text']);
    const response = await listCall('mine');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(ListPromptVersionsResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ currentVersion: 3, truncated: false, nextCursor: null });
    expect(body.versions.map((entry: { version: number; current: boolean; preview: string; title: string }) => [entry.version, entry.current, entry.preview, entry.title])).toEqual([
      [3, true, 'v3 text', 'Mine'],
      [2, false, 'v2 text', 'Mine'],
      [1, false, 'v1 text', 'Mine'],
    ]);
  });

  it('pages 25 versions with limit and before', async () => {
    seedDb([{ ...ALICE_PROMPT, body: 'body 1' }]);
    authenticatedAs(ALICE);
    await writeVersions('mine', Array.from({ length: 24 }, (_, index) => `body ${index + 2}`));
    const first = await (await listCall('mine', '?limit=20')).json();
    expect(first.versions).toHaveLength(20);
    expect(first).toMatchObject({ truncated: true, nextCursor: 6, currentVersion: 25 });
    const second = await (await listCall('mine', '?limit=20&before=6')).json();
    expect(second.versions.map((entry: { version: number }) => entry.version)).toEqual([5, 4, 3, 2, 1]);
    expect(second).toMatchObject({ truncated: false, nextCursor: null });
  });

  it('uses the default limit of 20 when none is given', async () => {
    seedDb([{ ...ALICE_PROMPT, body: 'body 1' }]);
    authenticatedAs(ALICE);
    await writeVersions('mine', Array.from({ length: 24 }, (_, index) => `body ${index + 2}`));
    const body = await (await listCall('mine')).json();
    expect(body.versions).toHaveLength(20);
    expect(body.truncated).toBe(true);
  });

  it('cuts the preview at the preview length and never returns the full body', async () => {
    const long = 'z'.repeat(20000);
    seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    await writeVersions('mine', [long]);
    const response = await listCall('mine');
    const text = await response.text();
    expect(text).not.toContain(long);
    const newest = JSON.parse(text).versions[0];
    expect(newest.preview).toHaveLength(PROMPT_VERSION_PREVIEW_LENGTH);
    expect(newest).toMatchObject({ previewTruncated: true, bodyLength: 20000 });
  });

  it.each([
    ['limit 0', '?limit=0'],
    ['limit 51', '?limit=51'],
    ['limit not a number', '?limit=abc'],
    ['before 1', '?before=1'],
    ['before above the version limit', '?before=1000000000'],
    ['before above the int4 range', '?before=9999999999'],
    ['before beyond the safe integer range', '?before=99999999999999999999'],
    ['an unknown parameter', '?cursor=3'],
  ])('returns 400 for %s without reading versions', async (_label, query) => {
    const db = seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    const response = await listCall('mine', query);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(db.queries).toEqual([]);
  });

  it('returns 404 to another user reading a public prompt, so a community viewer never sees its history', async () => {
    seedDb([{ owner_id: ALICE, slug: 'shared', title: 'Shared', body: 'secret v1', visibility: 'public' }]);
    authenticatedAs(ALICE);
    await writeVersions('shared', ['secret v2']);
    authenticatedAs(BOB);
    const response = await listCall('shared');
    expect(response.status).toBe(404);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ code: 'PROMPT_NOT_FOUND' });
    expect(text).not.toContain('secret');
  });

  it('returns 404 for a private prompt of another user and for an unknown slug', async () => {
    seedDb([{ owner_id: BOB, slug: 'bobs', title: 'Bobs', body: 'b' }]);
    authenticatedAs(ALICE);
    expect((await listCall('bobs')).status).toBe(404);
    expect((await listCall('nothing')).status).toBe(404);
  });

  it('returns 404 for an official prompt owned by the system account', async () => {
    seedDb([{ owner_id: SYSTEM, slug: 'daily-news', title: 'Daily', body: 'official', visibility: 'public', verified: true }]);
    authenticatedAs(ALICE);
    expect((await listCall('daily-news')).status).toBe(404);
  });

  it('returns 401 to an anonymous caller before touching the database', async () => {
    const db = seedDb([{ ...ALICE_PROMPT, visibility: 'public' }]);
    signedOut();
    const response = await listVersions(request('/api/prompts/mine/versions', { credentials: false }), slugContext('mine'));
    expect(response.status).toBe(401);
    expect(db.queries).toEqual([]);
  });

  it('returns 403 to a persona-scoped key before touching the database', async () => {
    const db = seedDb([ALICE_PROMPT]);
    scopedKeyOf(ALICE);
    const response = await listCall('mine');
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'PERSONA_SCOPE_DENIED' });
    expect(db.queries).toEqual([]);
  });

  it('returns 404 for a slug that is not a valid slug without touching the database', async () => {
    const db = seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    expect((await listCall('Bad%20Slug')).status).toBe(404);
    expect(db.queries).toEqual([]);
  });

  it('returns 400 for a malformed percent-encoded slug', async () => {
    seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    expect((await listCall('%E0%A4%A')).status).toBe(400);
  });

  it('applies the prompts read rate limit to the caller', async () => {
    seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    await listCall('mine');
    expect(applyRateLimit).toHaveBeenCalledWith(expect.any(Request), RATE_LIMITS.promptsRead, ALICE);
  });

  it('returns 500 and logs when the store fails', async () => {
    const db = seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    db.failNext('XX000');
    const response = await listCall('mine');
    expect(response.status).toBe(500);
    expect(loggerError).toHaveBeenCalled();
  });
});

describe('GET /api/prompts/[slug]/versions/[version]', () => {
  it('returns the full body of one old version', async () => {
    seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    await writeVersions('mine', ['v2 text']);
    const response = await getCall('mine', '1');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(GetPromptVersionResponseSchema.safeParse(body).success).toBe(true);
    expect(body.version).toMatchObject({ version: 1, body: 'v1 text', title: 'Mine', current: false });
  });

  it('marks the current version', async () => {
    seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    const body = await (await getCall('mine', '1')).json();
    expect(body.version.current).toBe(true);
  });

  it.each(['0', 'abc', '1e3', '01', '-1', '1234567890'])('returns 400 VALIDATION_FAILED for version %s without reading', async (version) => {
    const db = seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    const response = await getCall('mine', version);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(db.queries).toEqual([]);
  });

  it('returns 404 PROMPT_VERSION_NOT_FOUND for a version that does not exist', async () => {
    seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    const response = await getCall('mine', '9');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'PROMPT_VERSION_NOT_FOUND' });
  });

  it('returns 404 to a community viewer of a public prompt', async () => {
    seedDb([{ owner_id: ALICE, slug: 'shared', title: 'Shared', body: 'secret', visibility: 'public' }]);
    authenticatedAs(BOB);
    const response = await getCall('shared', '1');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'PROMPT_NOT_FOUND' });
  });

  it('returns 404 for an official prompt, 401 anonymous and 403 scoped', async () => {
    const db = seedDb([
      { owner_id: SYSTEM, slug: 'daily-news', title: 'Daily', body: 'official', visibility: 'public', verified: true },
      ALICE_PROMPT,
    ]);
    authenticatedAs(ALICE);
    expect((await getCall('daily-news', '1')).status).toBe(404);
    signedOut();
    expect((await getVersion(request('/api/prompts/mine/versions/1', { credentials: false }), versionContext('mine', '1'))).status).toBe(401);
    scopedKeyOf(ALICE);
    db.queries.length = 0;
    expect((await getCall('mine', '1')).status).toBe(403);
    expect(db.queries).toEqual([]);
  });
});

describe('POST /api/prompts/[slug]/versions/[version]/restore', () => {
  it('writes an old text as a new version, keeping the current title', async () => {
    const db = seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    await writeVersions('mine', ['v2 text', 'v3 text']);
    await patchPrompt(request('/api/prompts/mine', { method: 'PATCH', body: { title: 'New title' } }), slugContext('mine'));
    const response = await restoreCall('mine', '1');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(RestorePromptVersionResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ restored: true, prompt: { slug: 'mine', title: 'New title', body: 'v1 text', version: 4 } });
    expect(db.versions.map((entry) => [entry.version, entry.body])).toEqual([[1, 'v1 text'], [2, 'v2 text'], [3, 'v3 text'], [4, 'v1 text']]);
    expect(db.versions[3]?.title).toBe('New title');
  });

  it('applies the prompts write rate limit to the caller', async () => {
    seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    await restoreCall('mine', '1', { expectedCurrentVersion: 1 });
    expect(applyRateLimit).toHaveBeenCalledWith(expect.any(Request), RATE_LIMITS.promptsWrite, ALICE);
  });

  it('is a no-op for the current version: restored false, no write, same updated_at', async () => {
    const db = seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    await writeVersions('mine', ['v2 text', 'v3 text']);
    const updatedAt = db.rows[0].updated_at;
    const versionsBefore = db.versions.length;
    db.queries.length = 0;
    const response = await restoreCall('mine', '3');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ restored: false, prompt: { version: 3, body: 'v3 text' } });
    expect(db.versions).toHaveLength(versionsBefore);
    expect(db.queries.some((query) => query.startsWith('update'))).toBe(false);
    expect(db.rows[0].updated_at).toBe(updatedAt);
  });

  it('is a no-op for an old version whose text equals the current text', async () => {
    const db = seedDb([{ ...ALICE_PROMPT, body: 'a' }]);
    authenticatedAs(ALICE);
    await writeVersions('mine', ['b', 'a']);
    const updatedAt = db.rows[0].updated_at;
    db.queries.length = 0;
    const response = await restoreCall('mine', '1');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ restored: false, prompt: { version: 3, body: 'a' } });
    expect(db.versions).toHaveLength(3);
    expect(db.queries.some((query) => query.startsWith('update'))).toBe(false);
    expect(db.rows[0].updated_at).toBe(updatedAt);
  });

  it('returns 409 PROMPT_VERSION_CONFLICT for a stale expectedCurrentVersion and writes nothing', async () => {
    const db = seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    await writeVersions('mine', ['v2 text', 'v3 text']);
    db.queries.length = 0;
    const response = await restoreCall('mine', '1', { expectedCurrentVersion: 2 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'PROMPT_VERSION_CONFLICT' });
    expect(db.versions).toHaveLength(3);
    expect(db.queries.some((query) => query.startsWith('update'))).toBe(false);
  });

  it('returns 409 and creates no extra version when the prompt is written between the read and the update', async () => {
    const db = seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    await writeVersions('mine', ['v2 text']);
    db.beforeNextUpdate(() => {
      void db.client.from('user_prompts').update({ title: 'Edited elsewhere' }).eq('slug', 'mine').then(() => undefined);
    });
    const response = await restoreCall('mine', '1', { expectedCurrentVersion: 2 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'PROMPT_VERSION_CONFLICT' });
    expect(db.versions).toHaveLength(2);
    expect(db.rows[0].body).toBe('v2 text');
  });

  it('returns 404 PROMPT_VERSION_NOT_FOUND for an unknown version', async () => {
    seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    const response = await restoreCall('mine', '9', { expectedCurrentVersion: 1 });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'PROMPT_VERSION_NOT_FOUND' });
  });

  it.each(['0', 'abc', '1e3'])('returns 400 for the version segment %s', async (version) => {
    const db = seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    expect((await restoreCall('mine', version, { expectedCurrentVersion: 1 })).status).toBe(400);
    expect(db.queries).toEqual([]);
  });

  it.each([
    ['a missing expectedCurrentVersion', {}],
    ['a string expectedCurrentVersion', { expectedCurrentVersion: '1' }],
    ['a zero expectedCurrentVersion', { expectedCurrentVersion: 0 }],
    ['an extra key', { expectedCurrentVersion: 1, prompt: 'hijack' }],
  ])('returns 400 for %s without touching the database', async (_label, body) => {
    const db = seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    expect((await restoreCall('mine', '1', body)).status).toBe(400);
    expect(db.queries).toEqual([]);
  });

  it('returns 400 for a body that is not JSON', async () => {
    const db = seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    const response = await restoreVersion(
      request('/api/prompts/mine/versions/1/restore', { method: 'POST', rawBody: '{nope' }),
      versionContext('mine', '1'),
    );
    expect(response.status).toBe(400);
    expect(db.queries).toEqual([]);
  });

  it('returns 404 to a community viewer of a public prompt and never writes', async () => {
    const db = seedDb([{ owner_id: ALICE, slug: 'shared', title: 'Shared', body: 'one', visibility: 'public' }]);
    authenticatedAs(ALICE);
    await writeVersions('shared', ['two']);
    authenticatedAs(BOB);
    db.queries.length = 0;
    const response = await restoreCall('shared', '1', { expectedCurrentVersion: 2 });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'PROMPT_NOT_FOUND' });
    expect(db.rows[0].body).toBe('two');
    expect(db.queries.some((query) => query.startsWith('update'))).toBe(false);
  });

  it('returns 401 anonymous, 403 scoped and 404 for an official prompt', async () => {
    const db = seedDb([
      ALICE_PROMPT,
      { owner_id: SYSTEM, slug: 'daily-news', title: 'Daily', body: 'official', visibility: 'public', verified: true },
    ]);
    signedOut();
    expect((await restoreCall('mine', '1', { expectedCurrentVersion: 1 }, false)).status).toBe(401);
    scopedKeyOf(ALICE);
    expect((await restoreCall('mine', '1', { expectedCurrentVersion: 1 })).status).toBe(403);
    expect(db.queries).toEqual([]);
    authenticatedAs(ALICE);
    expect((await restoreCall('daily-news', '1', { expectedCurrentVersion: 1 })).status).toBe(404);
  });

  it('returns 500 and logs when the store fails', async () => {
    const db = seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    db.failNext('XX000');
    expect((await restoreCall('mine', '1', { expectedCurrentVersion: 1 })).status).toBe(500);
    expect(loggerError).toHaveBeenCalled();
  });
});

describe('history of a deleted prompt', () => {
  it('does not leak the old versions into a recreated prompt with the same slug', async () => {
    const db = seedDb([ALICE_PROMPT]);
    authenticatedAs(ALICE);
    await writeVersions('mine', ['v2 text']);
    expect((await deletePrompt(request('/api/prompts/mine', { method: 'DELETE' }), slugContext('mine'))).status).toBe(200);
    const created = await createPrompt(
      request('/api/prompts', { method: 'POST', body: { slug: 'mine', title: 'Reborn', prompt: 'fresh text' } }),
    );
    expect(created.status).toBe(201);
    const body = await (await listCall('mine')).json();
    expect(body.versions.map((entry: { version: number; preview: string }) => [entry.version, entry.preview])).toEqual([[1, 'fresh text']]);
    const restored = await restoreCall('mine', '2', { expectedCurrentVersion: 1 });
    expect(restored.status).toBe(404);
    expect(await restored.json()).toMatchObject({ code: 'PROMPT_VERSION_NOT_FOUND' });
    expect(db.versions.filter((entry) => entry.prompt_id === null)).toHaveLength(2);
  });
});
