import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
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

const USER_ID = 'user-1';
const SLOT_ID = '11111111-1111-4111-8111-111111111111';
const PERSONA_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PERSONA_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const PGRST116 = { code: 'PGRST116', message: 'zero rows' };

interface Rows {
  slot: Record<string, unknown> | null;
  schedulePersonaId: string | null;
}

const SLOT_ROW = {
  id: SLOT_ID,
  schedule_id: 'sched-1',
  slot_at: '2026-10-18T10:00:00.000Z',
  status: 'ready',
  title: 'myth busting',
  error: null,
  published_at: null,
  publish_outcomes: null,
  prompt_version_id: null,
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
    publish_mode: 'scheduled',
  };
}

function mockService(rows: Rows): void {
  const result = (table: string): { data: unknown; error: unknown } => {
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

  it('GET /api/posts/[id] returns an in-scope slot', async () => {
    scopedKey([PERSONA_A]);
    mockService({ slot: SLOT_ROW, schedulePersonaId: PERSONA_A });
    const response = await callGetPost(SLOT_ID);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { slot: { id: string } }).slot.id).toBe(SLOT_ID);
  });

  it('GET /api/posts/[id] returns 404 for another persona’s slot', async () => {
    scopedKey([PERSONA_A]);
    mockService({ slot: SLOT_ROW, schedulePersonaId: PERSONA_B });
    const response = await callGetPost(SLOT_ID);
    expect(response.status).toBe(404);
  });

  it('GET /api/posts/[id] returns a persona-less slot to a key scoped to no persona', async () => {
    scopedKey([]);
    mockService({ slot: SLOT_ROW, schedulePersonaId: null });
    const response = await callGetPost(SLOT_ID);
    expect(response.status).toBe(200);
  });

  it('GET /api/schedule/slots/[slotId] returns 404 for another persona’s slot', async () => {
    scopedKey([PERSONA_A]);
    mockService({ slot: SLOT_ROW, schedulePersonaId: PERSONA_B });
    const response = await callGetSlot(SLOT_ID);
    expect(response.status).toBe(404);
  });

  it('GET /api/schedule/slots/[slotId] returns an in-scope slot', async () => {
    scopedKey([PERSONA_A]);
    mockService({ slot: SLOT_ROW, schedulePersonaId: PERSONA_A });
    const response = await callGetSlot(SLOT_ID);
    expect(response.status).toBe(200);
  });
});
