// @vitest-environment node

import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireSupabaseSession = vi.hoisted(() => vi.fn());
const holder = vi.hoisted(() => ({ db: null as unknown }));
const applyRateLimit = vi.hoisted(() => vi.fn(async () => null));
const afterCallbacks = vi.hoisted(() => [] as Array<() => unknown>);
const notifyReviewers = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (callback: () => unknown) => {
    afterCallbacks.push(callback);
  },
}));
vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession }));
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  applyRateLimit,
}));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: () => holder.db }));
vi.mock('@/lib/prompt-review-mail', () => ({ notifyReviewersOfPendingPrompt: notifyReviewers }));
vi.mock('@/lib/api-error-reporting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-error-reporting')>()),
  withApiErrorReporting: (_route: string, handler: unknown) => handler,
  resolveReportingUserId: vi.fn(),
}));

import { POST } from '../route';
import { GetPromptResponseSchema } from '@/lib/contracts/prompts';
import { contentHashOf, createFakeUserPromptsDb, type FakeUserPromptsDb } from '@/lib/__tests__/support/fake-user-prompts-db';

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function asUser(userId: string, extra: Record<string, unknown> = {}): void {
  requireSupabaseSession.mockResolvedValue({ auth: { userId, accessToken: 't', ...extra }, error: null });
}

function call(slug: string, body: unknown): Promise<Response> {
  return POST(
    new Request(`https://post-engineer.test/api/prompts/${slug}/visibility`, {
      method: 'POST',
      headers: { authorization: 'Bearer pe_test', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) },
  );
}

function seedDb(seed: Parameters<typeof createFakeUserPromptsDb>[0]): FakeUserPromptsDb {
  const db = createFakeUserPromptsDb(seed);
  holder.db = db.client;
  return db;
}

beforeEach(() => {
  requireSupabaseSession.mockReset();
  applyRateLimit.mockResolvedValue(null);
  notifyReviewers.mockClear();
  afterCallbacks.length = 0;
});

describe('POST /api/prompts/[slug]/visibility', () => {
  it('moves a private prompt to pending and returns it', async () => {
    const db = seedDb([{ owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'a' }]);
    asUser(ALICE);
    const response = await call('mine', { visibility: 'public' });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(GetPromptResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ prompt: { slug: 'mine', source: 'own', status: 'pending' } });
    expect(db.rows[0].status).toBe('pending');
  });

  it('tells the reviewers after the response, with the slug and title only', async () => {
    seedDb([{ owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'secret text' }]);
    asUser(ALICE);
    await call('mine', { visibility: 'public' });
    expect(notifyReviewers).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();
    expect(notifyReviewers).toHaveBeenCalledWith({ slug: 'mine', title: 'Mine' });
  });

  it('withdraws an approved prompt back to private without telling the reviewers', async () => {
    const hash = contentHashOf('Mine', '', 'a');
    const db = seedDb([
      { owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'a', status: 'approved', approved_hash: hash, reviewed_by: BOB, reviewed_at: new Date().toISOString() },
    ]);
    asUser(ALICE);
    const response = await call('mine', { visibility: 'private' });
    expect(await response.json()).toMatchObject({ prompt: { status: 'private' } });
    expect(db.rows[0]).toMatchObject({ status: 'private', approved_hash: null });
    expect(afterCallbacks).toHaveLength(0);
  });

  it('returns 409 PROMPT_STATE_CONFLICT with the current status when publication is already approved', async () => {
    const hash = contentHashOf('Mine', '', 'a');
    seedDb([
      { owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'a', status: 'approved', approved_hash: hash, reviewed_by: BOB, reviewed_at: new Date().toISOString() },
    ]);
    asUser(ALICE);
    const response = await call('mine', { visibility: 'public' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'PROMPT_STATE_CONFLICT', status: 'approved' });
    expect(afterCallbacks).toHaveLength(0);
  });

  it('does not tell the reviewers again when the prompt was already pending', async () => {
    seedDb([{ owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'a', status: 'pending' }]);
    asUser(ALICE);
    expect((await call('mine', { visibility: 'public' })).status).toBe(200);
    expect(afterCallbacks).toHaveLength(0);
  });

  it('returns 404 and leaves another owner prompt untouched', async () => {
    const db = seedDb([{ owner_id: BOB, slug: 'bobs', title: 'Bobs', body: 'b' }]);
    asUser(ALICE);
    expect((await call('bobs', { visibility: 'public' })).status).toBe(404);
    expect(db.rows[0].status).toBe('private');
  });

  it('returns 400 for an unknown visibility and for extra fields without querying', async () => {
    const db = seedDb([{ owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'a' }]);
    asUser(ALICE);
    expect((await call('mine', { visibility: 'approved' })).status).toBe(400);
    expect((await call('mine', { visibility: 'public', status: 'approved' })).status).toBe(400);
    expect(db.queries).toEqual([]);
  });

  it('returns 403 to a persona-scoped key', async () => {
    const db = seedDb([{ owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'a' }]);
    asUser(ALICE, { isApiKey: true, personaIds: [] });
    expect((await call('mine', { visibility: 'public' })).status).toBe(403);
    expect(db.queries).toEqual([]);
  });

  it('returns the 401 of the auth layer untouched', async () => {
    const db = seedDb([]);
    requireSupabaseSession.mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 }),
    });
    expect((await call('mine', { visibility: 'public' })).status).toBe(401);
    expect(db.queries).toEqual([]);
  });
});
