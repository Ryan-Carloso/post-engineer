import { describe, expect, it, vi, beforeEach } from 'vitest';

// Persona scope through the real post-detail helpers: a persona-scoped API
// key must not read another persona's post through GET /api/posts/[id] (MCP
// get_post) or GET /api/schedule/slots/[slotId] (MCP get_slot). Out of
// scope is a 404 like an unknown id; persona-less posts stay visible, the
// same policy as GET /api/schedule/status and GET /api/metrics.

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
  engineAuthHeaders: (userId: string) => ({ 'x-user-id': userId }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(() => 'log-id'), warn: vi.fn(() => 'log-id'), info: vi.fn(() => 'log-id') },
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, applyRateLimit: vi.fn().mockResolvedValue(null) };
});
vi.mock('@/lib/engine-tasks', () => ({
  fetchEnginePublishResults: vi.fn(async () => ({})),
  fetchEngineTaskProgress: vi.fn(async () => ({ gone: false, progress: 50, stage: 'video' })),
}));
vi.mock('@/lib/schedule-slot-presentation', () => ({
  enrichSlot: vi.fn(async () => ({
    status: 'generating',
    progress: 42,
    stage: 'video',
    queuePosition: null,
    queueTotal: null,
    retryable: null,
  })),
}));
vi.mock('@/lib/api-error-reporting', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-error-reporting')>();
  return {
    ...actual,
    withApiErrorReporting: (_route: string, handler: unknown) => handler,
    resolveReportingUserId: vi.fn(),
  };
});

import { GET as getPost } from '../route';
import { GET as getSlot } from '../../../schedule/slots/[slotId]/route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { fetchEngineTaskProgress } from '@/lib/engine-tasks';
import { enrichSlot } from '@/lib/schedule-slot-presentation';

const USER_ID = 'user-1';
const SLOT_ID = '11111111-1111-4111-8111-111111111111';
const GENERATION_ID = 'gen-direct-1';
const PERSONA_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PERSONA_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const PGRST116 = { code: 'PGRST116', message: 'zero rows' };

interface Rows {
  generation: Record<string, unknown> | null;
  slot: Record<string, unknown> | null;
  schedulePersonaId: string | null;
}

function generationRow(personaId: string | null): Record<string, unknown> {
  return {
    id: 'vg-1',
    generation_id: GENERATION_ID,
    engine_task_id: 'task-1',
    persona_id: personaId,
    persona_name: 'Persona',
    video_subject: 'subject',
    status: 'running',
    error_code: null,
    tokens_refunded: false,
    created_at: '2026-10-17T10:00:00.000Z',
    completed_at: null,
  };
}

const SLOT_ROW = {
  id: SLOT_ID,
  schedule_id: 'sched-1',
  slot_at: '2026-10-18T10:00:00.000Z',
  status: 'generating',
  topic: 'topic',
  error: null,
  published_at: null,
  task_id: 'task-2',
  faceless: false,
};

function scheduleRow(personaId: string | null): Record<string, unknown> {
  return {
    id: 'sched-1',
    persona_id: personaId,
    providers: ['youtube'],
    youtube_account_ids: [],
    instagram_account_ids: [],
    linkedin_account_ids: [],
    bluesky_account_ids: [],
    timezone: 'UTC',
    post_language: 'en',
    post_voice_id: null,
    post_video_aspect: null,
    post_video_layout: null,
    post_niche: null,
    post_paragraph_number: null,
    post_face_quality: null,
    publish_mode: 'scheduled',
  };
}

function mockService(rows: Rows): void {
  const result = (table: string): { data: unknown; error: unknown } => {
    if (table === 'video_generations') {
      return rows.generation === null ? { data: null, error: PGRST116 } : { data: rows.generation, error: null };
    }
    if (table === 'scheduled_posts') {
      return rows.slot === null ? { data: null, error: PGRST116 } : { data: rows.slot, error: null };
    }
    if (table === 'schedules') return { data: scheduleRow(rows.schedulePersonaId), error: null };
    if (table === 'personas') return { data: { id: rows.schedulePersonaId, name: 'Persona' }, error: null };
    return { data: [], error: null };
  };
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      single: vi.fn(async () => result(table)),
      maybeSingle: vi.fn(async () => result(table)),
      order: vi.fn(async () => result(table)),
    });
    return chain;
  });
  vi.mocked(createSupabaseServiceClient).mockReturnValue({ from } as never);
}

function scopedKey(personaIds: string[]): void {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, isApiKey: true, personaIds },
    error: null,
  } as never);
}

function callGetPost(id: string): Promise<Response> {
  return getPost(new Request(`https://example.com/api/posts/${id}`), {
    params: Promise.resolve({ id }),
  });
}

function callGetSlot(slotId: string): Promise<Response> {
  return getSlot(new Request(`https://example.com/api/schedule/slots/${slotId}`), {
    params: Promise.resolve({ slotId }),
  });
}

describe('persona-scoped API keys on post detail reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/posts/[id] returns an in-scope generation', async () => {
    scopedKey([PERSONA_A]);
    mockService({ generation: generationRow(PERSONA_A), slot: null, schedulePersonaId: null });
    const response = await callGetPost(GENERATION_ID);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { kind: string }).kind).toBe('generation');
  });

  it('GET /api/posts/[id] returns 404 for another persona’s generation without calling the engine', async () => {
    scopedKey([PERSONA_A]);
    mockService({ generation: generationRow(PERSONA_B), slot: null, schedulePersonaId: null });
    const response = await callGetPost(GENERATION_ID);
    expect(response.status).toBe(404);
    expect(fetchEngineTaskProgress).not.toHaveBeenCalled();
  });

  it('GET /api/posts/[id] returns a persona-less generation to a scoped key', async () => {
    scopedKey([PERSONA_A]);
    mockService({ generation: generationRow(null), slot: null, schedulePersonaId: null });
    const response = await callGetPost(GENERATION_ID);
    expect(response.status).toBe(200);
  });

  it('GET /api/posts/[id] returns an in-scope slot', async () => {
    scopedKey([PERSONA_A]);
    mockService({ generation: null, slot: SLOT_ROW, schedulePersonaId: PERSONA_A });
    const response = await callGetPost(SLOT_ID);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { kind: string }).kind).toBe('slot');
  });

  it('GET /api/posts/[id] returns 404 for another persona’s slot without calling the engine', async () => {
    scopedKey([PERSONA_A]);
    mockService({ generation: null, slot: SLOT_ROW, schedulePersonaId: PERSONA_B });
    const response = await callGetPost(SLOT_ID);
    expect(response.status).toBe(404);
    expect(enrichSlot).not.toHaveBeenCalled();
  });

  it('GET /api/posts/[id] returns a persona-less slot to a key scoped to no persona', async () => {
    scopedKey([]);
    mockService({ generation: null, slot: SLOT_ROW, schedulePersonaId: null });
    const response = await callGetPost(SLOT_ID);
    expect(response.status).toBe(200);
  });

  it('GET /api/schedule/slots/[slotId] returns 404 for another persona’s slot', async () => {
    scopedKey([PERSONA_A]);
    mockService({ generation: null, slot: SLOT_ROW, schedulePersonaId: PERSONA_B });
    const response = await callGetSlot(SLOT_ID);
    expect(response.status).toBe(404);
    expect(enrichSlot).not.toHaveBeenCalled();
  });

  it('GET /api/schedule/slots/[slotId] returns an in-scope slot', async () => {
    scopedKey([PERSONA_A]);
    mockService({ generation: null, slot: SLOT_ROW, schedulePersonaId: PERSONA_A });
    const response = await callGetSlot(SLOT_ID);
    expect(response.status).toBe(200);
  });
});
