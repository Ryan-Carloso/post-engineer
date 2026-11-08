// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));
vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_LIMITS: { batchDiscount: { name: 'batch-discount', limit: 10, windowMs: 60_000 } },
}));
vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(() => 'warn-id'), error: vi.fn(() => 'error-id'), info: vi.fn(), debug: vi.fn() },
}));

import { NextResponse } from 'next/server';
import { POST } from '../route';
import { BATCH_DISCOUNT_REASON } from '../apply';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { applyRateLimit } from '@/lib/rate-limit';
import { trackApiEvent } from '@/lib/analytics';
import { logger } from '@/lib/logger';
import { deterministicUuid } from '@/lib/idempotency';
import { createFakeSupabase, slotRow, type FakeOptions, type Row } from './fake-supabase';

const USER_ID = 'user-1';
const BATCH_ID = deterministicUuid('batch-discount/v1', `${USER_ID}:launch-week`);

function scheduleRows(slots: Row[], personaId: string | null = null): Row[] {
  return slots.map((slot) => ({ id: slot.schedule_id, user_id: slot.user_id, persona_id: personaId }));
}

function setup(slots: Row[], extra: Partial<FakeOptions> = {}, schedules = scheduleRows(slots)) {
  const fake = createFakeSupabase({ tables: { scheduled_posts: slots, schedules }, ...extra });
  vi.mocked(createSupabaseServiceClient).mockReturnValue(fake.client as never);
  return fake;
}

function post(body: unknown): Promise<Response> {
  return POST(
    new Request('http://localhost/api/videos/batch-discount', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer pe_test' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

function sixFaces(price = 2): Row[] {
  return Array.from({ length: 6 }, (_, i) => slotRow(String(i + 1), { charged_tokens: price }));
}

function bodyFor(slots: Row[], batchKey = 'launch-week') {
  return { batchKey, scheduleIds: slots.map((slot) => slot.schedule_id) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'pe_test', isApiKey: true, personaIds: null },
    error: null,
  } as never);
});

describe('POST /api/videos/batch-discount', () => {
  it('makes the cheapest of 6 face videos free and records it on the slot', async () => {
    const slots = [...sixFaces(3).slice(0, 5), slotRow('6', { charged_tokens: 2 })];
    const fake = setup(slots);
    const res = await post(bodyFor(slots));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({
      success: true,
      batchId: BATCH_ID,
      videos: 6,
      faceVideos: 6,
      earnedFreeVideos: 1,
      discountTokens: 2,
      chargedTokens: 15,
      warnings: [],
    });
    expect(json.freeVideos).toEqual([{ scheduleId: slots[5]?.schedule_id, slotId: '6', discountTokens: 2 }]);
    // One credit, under the free video's own schedule charge, idempotent key.
    expect(fake.rpcCalls).toEqual([
      {
        name: 'refund_batch_tokens',
        params: {
          p_user_id: USER_ID,
          p_batch_generation_id: `batch:${slots[5]?.schedule_id}`,
          p_refund_key: `batch:${slots[5]?.schedule_id}:slot:6:discount`,
          p_amount: 2,
          p_reason: BATCH_DISCOUNT_REASON,
          p_engine_task_id: 'task-6',
        },
      },
    ]);
    expect(fake.tables.scheduled_posts?.find((row) => row.id === '6')).toMatchObject({
      charged_tokens: 0,
      discount_tokens: 2,
      batch_id: BATCH_ID,
    });
    expect(fake.tables.scheduled_posts?.every((row) => row.batch_id === BATCH_ID)).toBe(true);
    expect(trackApiEvent).toHaveBeenCalledWith('batch_discount_applied', expect.objectContaining({ freeVideos: 1, discountTokens: 2 }));
  });

  it('gives nothing below 6 face videos but still groups the batch', async () => {
    const slots = [...sixFaces().slice(0, 5), slotRow('6', { faceless: true, charged_tokens: 1 })];
    const fake = setup(slots);
    const res = await post(bodyFor(slots));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({ faceVideos: 5, earnedFreeVideos: 0, freeVideos: [], discountTokens: 0 });
    expect(fake.rpcCalls).toEqual([]);
    expect(trackApiEvent).not.toHaveBeenCalled();
    expect(fake.tables.scheduled_posts?.every((row) => row.batch_id === BATCH_ID)).toBe(true);
  });

  it('is idempotent: calling again with the same key credits nothing more', async () => {
    const slots = sixFaces();
    const fake = setup(slots);
    expect((await post(bodyFor(slots))).status).toBe(200);
    const res = await post(bodyFor(slots));
    expect(res.status).toBe(200);
    expect(fake.rpcCalls).toHaveLength(1);
    expect(((await res.json()) as { freeVideos: unknown[] }).freeVideos).toHaveLength(1);
  });

  it('adds the second free video when a retry grows the batch to 12', async () => {
    const first = sixFaces(3);
    const rest = Array.from({ length: 6 }, (_, i) => slotRow(String(i + 7), { charged_tokens: 3 }));
    const fake = setup([...first, ...rest]);
    await post(bodyFor(first));
    const res = await post(bodyFor([...first, ...rest]));
    const json = (await res.json()) as { freeVideos: unknown[]; discountTokens: number };
    expect(json.freeVideos).toHaveLength(2);
    expect(json.discountTokens).toBe(6);
    expect(fake.rpcCalls).toHaveLength(2);
  });

  it('rejects a video that already belongs to another batch (409)', async () => {
    const slots = sixFaces();
    slots[0] = slotRow('1', { batch_id: '11111111-1111-4111-8111-111111111111' });
    const fake = setup(slots);
    const res = await post(bodyFor(slots));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'BATCH_CONFLICT' });
    expect(fake.rpcCalls).toEqual([]);
    expect(fake.updates).toEqual([]);
  });

  it('rejects videos created more than 10 minutes apart (409)', async () => {
    const slots = sixFaces();
    slots[5] = slotRow('6', { created_at: '2026-11-08T10:10:00.001Z' });
    const fake = setup(slots);
    const res = await post(bodyFor(slots));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'BATCH_WINDOW_EXCEEDED' });
    expect(fake.updates).toEqual([]);
  });

  it('rejects a batch that would grow past 12 videos (400)', async () => {
    const members = Array.from({ length: 12 }, (_, i) => slotRow(String(i + 1), { batch_id: BATCH_ID }));
    const extra = slotRow('13');
    const fake = setup([...members, extra]);
    const res = await post(bodyFor([extra]));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'BATCH_TOO_LARGE' });
    expect(fake.updates).toEqual([]);
  });

  it('returns 404 for a schedule the caller does not own', async () => {
    const slots = sixFaces();
    const fake = setup(slots, {}, scheduleRows(slots).slice(1));
    const res = await post(bodyFor(slots));
    expect(res.status).toBe(404);
    expect(fake.rpcCalls).toEqual([]);
  });

  it('returns 404 for a schedule without a video', async () => {
    const slots = sixFaces();
    setup(slots.slice(1), {}, scheduleRows(slots));
    const res = await post(bodyFor(slots));
    expect(res.status).toBe(404);
  });

  it('returns 403 when a persona-scoped key reaches outside its personas', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, accessToken: 'pe_test', isApiKey: true, personaIds: ['persona-a'] },
      error: null,
    } as never);
    const slots = sixFaces();
    const fake = setup(slots, {}, scheduleRows(slots, 'persona-b'));
    const res = await post(bodyFor(slots));
    expect(res.status).toBe(403);
    expect(fake.updates).toEqual([]);
  });

  it('validates the body strictly before reading anything', async () => {
    const slots = sixFaces();
    const fake = setup(slots);
    for (const body of [
      'not json',
      { batchKey: 'has space', scheduleIds: [slots[0]?.schedule_id] },
      { batchKey: 'ok', scheduleIds: [] },
      { batchKey: 'ok', scheduleIds: ['not-a-uuid'] },
      { batchKey: 'ok', scheduleIds: [slots[0]?.schedule_id, slots[0]?.schedule_id] },
      { batchKey: 'ok', scheduleIds: [slots[0]?.schedule_id], extra: true },
      { batchKey: 'ok', scheduleIds: Array.from({ length: 13 }, (_, i) => slotRow(String(i + 1)).schedule_id) },
    ]) {
      const res = await post(body);
      expect(res.status).toBe(400);
    }
    expect(requireSupabaseSession).not.toHaveBeenCalled();
    expect(fake.rpcCalls).toEqual([]);
  });

  it('returns the auth error and the rate-limit response untouched', async () => {
    const slots = sixFaces();
    setup(slots);
    const denied = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    vi.mocked(requireSupabaseSession).mockResolvedValueOnce({ auth: null, error: denied } as never);
    expect((await post(bodyFor(slots))).status).toBe(401);
    vi.mocked(applyRateLimit).mockResolvedValueOnce(NextResponse.json({ error: 'slow down' }, { status: 429 }));
    expect((await post(bodyFor(slots))).status).toBe(429);
  });

  it('reports a failed credit as a warning and leaves the slot paid', async () => {
    const slots = sixFaces();
    const fake = setup(slots, { rpc: () => ({ data: { refunded: false }, error: null }) });
    const res = await post(bodyFor(slots));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { warnings: string[]; freeVideos: unknown[] };
    expect(json.warnings).toEqual(['BATCH_DISCOUNT_CREDIT_FAILED']);
    expect(json.freeVideos).toEqual([]);
    expect(fake.tables.scheduled_posts?.every((row) => row.discount_tokens === 0)).toBe(true);
    expect(logger.error).toHaveBeenCalledWith('[batch-discount] discount credit failed', { refunded: false }, expect.objectContaining({ userId: USER_ID }));
  });

  it('treats an already-applied credit as success (retry after a crash)', async () => {
    const slots = sixFaces();
    const fake = setup(slots, { rpc: () => ({ data: { refunded: false, already_refunded: true }, error: null }) });
    const json = (await (await post(bodyFor(slots))).json()) as { freeVideos: unknown[]; warnings: string[] };
    expect(json.freeVideos).toHaveLength(1);
    expect(json.warnings).toEqual([]);
    expect(fake.tables.scheduled_posts?.filter((row) => row.charged_tokens === 0)).toHaveLength(1);
  });

  it('answers 500 without crediting when the slots cannot be read', async () => {
    const slots = sixFaces();
    const fake = setup(slots, { selectError: { scheduled_posts: { message: 'down' } } });
    const res = await post(bodyFor(slots));
    expect(res.status).toBe(500);
    expect(fake.rpcCalls).toEqual([]);
  });
});
