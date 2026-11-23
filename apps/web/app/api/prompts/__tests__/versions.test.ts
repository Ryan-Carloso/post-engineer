// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireSupabaseSession = vi.hoisted(() => vi.fn());
const holder = vi.hoisted(() => ({ db: null as unknown }));
const loggerError = vi.hoisted(() => vi.fn());

vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession }));
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  applyRateLimit: vi.fn(async () => null),
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

import { GET as getPrompt, PATCH as patchPrompt } from '../[slug]/route';
import { createFakeUserPromptsDb, type FakeUserPromptsDb } from '@/lib/__tests__/support/fake-user-prompts-db';

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function authenticatedAs(userId: string): void {
  requireSupabaseSession.mockResolvedValue({ auth: { userId, accessToken: 't' }, error: null });
}

function request(path: string, body?: unknown): Request {
  return new Request(`https://post-engineer.test${path}`, {
    method: body === undefined ? 'GET' : 'PATCH',
    headers: { authorization: 'Bearer pe_test', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
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

async function promptOf(response: Response): Promise<{ versionId: string; version: number }> {
  const body = (await response.json()) as { prompt: { versionId: string; version: number } };
  return body.prompt;
}

beforeEach(() => {
  requireSupabaseSession.mockReset();
  loggerError.mockReset();
});

describe('prompt versions over the prompt routes', () => {
  it('returns the next version after the text changes and keeps the old one', async () => {
    const db = seedDb([{ owner_id: ALICE, slug: 'mine', title: 'T', body: 'first' }]);
    authenticatedAs(ALICE);
    const before = await promptOf(await getPrompt(request('/api/prompts/mine'), slugContext('mine')));
    const after = await promptOf(await patchPrompt(request('/api/prompts/mine', { prompt: 'second' }), slugContext('mine')));
    expect(before.version).toBe(1);
    expect(after.version).toBe(2);
    expect(after.versionId).not.toBe(before.versionId);
    expect(db.versions.map((entry) => [entry.version, entry.body])).toEqual([[1, 'first'], [2, 'second']]);
  });

  it('keeps the same version when only the title or the visibility changes', async () => {
    const db = seedDb([{ owner_id: ALICE, slug: 'mine', title: 'T', body: 'first' }]);
    authenticatedAs(ALICE);
    const renamed = await promptOf(await patchPrompt(request('/api/prompts/mine', { title: 'Renamed', visibility: 'public' }), slugContext('mine')));
    expect(renamed).toMatchObject({ versionId: db.versions[0]?.id, version: 1 });
    expect(db.versions).toHaveLength(1);
  });

  it('serves a community prompt with the version its owner last saved', async () => {
    const db = seedDb([{ owner_id: BOB, slug: 'shared', title: 'S', body: 'community', visibility: 'public' }]);
    authenticatedAs(ALICE);
    const shared = await promptOf(await getPrompt(request('/api/prompts/shared'), slugContext('shared')));
    expect(shared).toEqual(expect.objectContaining({ versionId: db.versions[0]?.id, version: 1 }));
  });
});
