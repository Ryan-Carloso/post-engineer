// @vitest-environment node

import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { GET as listQueue } from '../route';
import { POST as review } from '../[id]/review/route';
import { ListPromptReviewQueueResponseSchema, ReviewPromptResponseSchema } from '@/lib/contracts/prompts';
import { createFakeUserPromptsDb, type FakeUserPromptsDb } from '@/lib/__tests__/support/fake-user-prompts-db';

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REVIEWER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function asUser(userId: string, extra: Record<string, unknown> = {}): void {
  requireSupabaseSession.mockResolvedValue({ auth: { userId, accessToken: 't', ...extra }, error: null });
}

function seedDb(seed: Parameters<typeof createFakeUserPromptsDb>[0]): FakeUserPromptsDb {
  const db = createFakeUserPromptsDb(seed);
  holder.db = db.client;
  return db;
}

function queue(): Promise<Response> {
  return listQueue(new Request('https://post-engineer.test/api/admin/prompts', { headers: { authorization: 'Bearer pe_test' } }));
}

function decide(id: string, body: unknown): Promise<Response> {
  return review(
    new Request(`https://post-engineer.test/api/admin/prompts/${id}/review`, {
      method: 'POST',
      headers: { authorization: 'Bearer pe_test', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  requireSupabaseSession.mockReset();
  applyRateLimit.mockResolvedValue(null);
  vi.stubEnv('PROMPT_REVIEWER_USER_IDS', REVIEWER);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/admin/prompts', () => {
  it('lists pending prompts with the text and hash a reviewer needs, and nothing else', async () => {
    seedDb([
      { owner_id: ALICE, slug: 'waiting', title: 'Waiting', description: 'D', body: 'text to read', status: 'pending' },
      { owner_id: BOB, slug: 'private-one', title: 'Private', body: 'not for the queue' },
    ]);
    asUser(REVIEWER);
    const response = await queue();
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(ListPromptReviewQueueResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      truncated: false,
      prompts: [{ slug: 'waiting', title: 'Waiting', description: 'D', prompt: 'text to read', authorId: ALICE, contentHash: expect.stringMatching(/^[0-9a-f]{64}$/) }],
    });
    expect(JSON.stringify(body)).not.toContain('not for the queue');
  });

  it('returns 403 PROMPT_REVIEWER_REQUIRED to a signed-in user who is not a reviewer, without reading', async () => {
    const db = seedDb([]);
    asUser(ALICE);
    const response = await queue();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'PROMPT_REVIEWER_REQUIRED' });
    expect(db.queries).toEqual([]);
  });

  it('returns 403 to a persona-scoped key even when its owner is a reviewer', async () => {
    const db = seedDb([]);
    asUser(REVIEWER, { isApiKey: true, personaIds: [] });
    expect((await queue()).status).toBe(403);
    expect(db.queries).toEqual([]);
  });

  it('lets an unscoped API key of a reviewer read the queue', async () => {
    seedDb([]);
    asUser(REVIEWER, { isApiKey: true, personaIds: null });
    expect((await queue()).status).toBe(200);
  });

  it('fails with a logged 500 when the reviewer list is not configured, instead of guessing', async () => {
    vi.stubEnv('PROMPT_REVIEWER_USER_IDS', undefined);
    const db = seedDb([]);
    asUser(REVIEWER);
    const response = await queue();
    expect(response.status).toBe(500);
    expect(db.queries).toEqual([]);
  });

  it('returns the 401 of the auth layer untouched', async () => {
    requireSupabaseSession.mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 }),
    });
    expect((await queue()).status).toBe(401);
  });
});

describe('POST /api/admin/prompts/[id]/review', () => {
  function pendingDb(): { db: FakeUserPromptsDb; id: string; hash: string } {
    const db = seedDb([{ owner_id: ALICE, slug: 'waiting', title: 'Waiting', description: 'D', body: 'text', status: 'pending' }]);
    return { db, id: db.rows[0].id, hash: db.rows[0].content_hash };
  }

  it('approves the exact text the reviewer read and records who approved', async () => {
    const { db, id, hash } = pendingDb();
    asUser(REVIEWER);
    const response = await decide(id, { decision: 'approve', contentHash: hash });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(ReviewPromptResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({ success: true, slug: 'waiting', status: 'approved' });
    expect(db.rows[0]).toMatchObject({ status: 'approved', approved_hash: hash, reviewed_by: REVIEWER });
  });

  it('rejects with a reason the owner can read', async () => {
    const { db, id, hash } = pendingDb();
    asUser(REVIEWER);
    const response = await decide(id, { decision: 'reject', contentHash: hash, reason: 'Too vague' });
    expect(await response.json()).toEqual({ success: true, slug: 'waiting', status: 'rejected' });
    expect(db.rows[0]).toMatchObject({ status: 'rejected', rejection_reason: 'Too vague' });
  });

  it('returns 400 for a rejection without a reason and changes nothing', async () => {
    const { db, id, hash } = pendingDb();
    asUser(REVIEWER);
    const response = await decide(id, { decision: 'reject', contentHash: hash });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ field: 'reason' });
    expect(db.rows[0].status).toBe('pending');
  });

  it.each([
    ['an unknown decision', { decision: 'maybe', contentHash: 'a'.repeat(64) }],
    ['a content hash that is not sha256 hex', { decision: 'approve', contentHash: 'nope' }],
    ['a missing content hash', { decision: 'approve' }],
    ['an extra field', { decision: 'approve', contentHash: 'a'.repeat(64), status: 'approved' }],
  ])('returns 400 for %s and queries nothing', async (_label, body) => {
    const { db, id } = pendingDb();
    asUser(REVIEWER);
    expect((await decide(id, body)).status).toBe(400);
    expect(db.queries).toEqual([]);
  });

  it('returns 409 PROMPT_REVIEW_STALE when the owner edited the text after the reviewer read it', async () => {
    const { db, id, hash } = pendingDb();
    db.rows[0] = { ...db.rows[0], body: 'swapped', content_hash: 'f'.repeat(64) };
    asUser(REVIEWER);
    const response = await decide(id, { decision: 'approve', contentHash: hash });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'PROMPT_REVIEW_STALE' });
    expect(db.rows[0].status).toBe('pending');
  });

  it('returns 404 for an unknown id and for an id that is not a uuid, the latter without querying', async () => {
    const { db, hash } = pendingDb();
    asUser(REVIEWER);
    expect((await decide('dddddddd-dddd-4ddd-8ddd-dddddddddddd', { decision: 'approve', contentHash: hash })).status).toBe(404);
    db.queries.length = 0;
    expect((await decide('not-a-uuid', { decision: 'approve', contentHash: hash })).status).toBe(404);
    expect(db.queries).toEqual([]);
  });

  it('returns 409 PROMPT_SLUG_TAKEN when another approved prompt already owns the slug', async () => {
    const db = seedDb([
      { owner_id: BOB, slug: 'waiting', title: 'Other', body: 'x', status: 'approved', approved_hash: 'x', reviewed_by: REVIEWER, reviewed_at: new Date().toISOString() },
      { owner_id: ALICE, slug: 'waiting', title: 'Waiting', body: 'text', status: 'pending' },
    ]);
    asUser(REVIEWER);
    const response = await decide(db.rows[1].id, { decision: 'approve', contentHash: db.rows[1].content_hash });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'PROMPT_SLUG_TAKEN' });
    expect(db.rows[1].status).toBe('pending');
  });

  it('returns 403 to a user who is not a reviewer and leaves the prompt pending', async () => {
    const { db, id, hash } = pendingDb();
    asUser(ALICE);
    expect((await decide(id, { decision: 'approve', contentHash: hash })).status).toBe(403);
    expect(db.rows[0].status).toBe('pending');
    expect(db.queries).toEqual([]);
  });

  it('returns 403 to the prompt owner who is not a reviewer, so nobody approves their own text', async () => {
    const { db, id, hash } = pendingDb();
    asUser(ALICE);
    expect((await decide(id, { decision: 'approve', contentHash: hash })).status).toBe(403);
    expect(db.rows[0].status).toBe('pending');
  });
});
