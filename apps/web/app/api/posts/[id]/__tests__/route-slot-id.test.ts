import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(() => 'log-id'), warn: vi.fn(() => 'log-id'), info: vi.fn(() => 'log-id') },
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

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

vi.mock('@/lib/engine-tasks', () => ({
  fetchEnginePublishResults: vi.fn(async () => ({})),
  fetchEngineTaskProgress: vi.fn(async () => ({ gone: false, progress: 67, stage: 'audio' })),
}));

vi.mock('@/lib/publish-links', () => ({
  resolvePublishLinks: vi.fn(() => []),
}));

import { GET } from '../route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const USER_ID = 'user-1';
const SLOT_ID = '11111111-1111-4111-8111-111111111111';
const SCHEDULE_ID = '22222222-2222-4222-8222-222222222222';
const PERSONA_ID = '33333333-3333-4333-8333-333333333333';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UUID_COLUMNS: Record<string, readonly string[]> = {
  scheduled_posts: ['id'],
  schedules: ['id'],
  personas: ['id'],
  scheduled_post_progress_history: ['post_id'],
};

const SLOT_ROW = {
  id: SLOT_ID,
  schedule_id: SCHEDULE_ID,
  slot_at: '2026-10-18T10:00:00.000Z',
  status: 'generating',
  title: 'myth busting',
  error: null,
  published_at: null,
  task_id: 'task-1',
  voiceover: false,
};

const SCHEDULE_ROW = {
  id: SCHEDULE_ID,
  persona_id: PERSONA_ID,
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

interface DbCall {
  table: string;
  op: string;
  args: unknown[];
}

interface DbRows {
  generation?: Record<string, unknown> | null;
  slot?: boolean;
  slotRow?: Record<string, unknown>;
  promptVersion?: { data: unknown; error: unknown };
}

function mockDb(rows: DbRows) {
  const calls: DbCall[] = [];
  const from = vi.fn((table: string) => {
    const filters: Array<[string, unknown]> = [];
    const api: Record<string, unknown> = {};
    const record = (op: string, args: unknown[]): void => {
      calls.push({ table, op, args });
    };
    api.select = (...args: unknown[]) => {
      record('select', args);
      return api;
    };
    api.eq = (column: string, value: unknown) => {
      record('eq', [column, value]);
      filters.push([column, value]);
      return api;
    };
    api.order = (...args: unknown[]) => {
      record('order', args);
      return Promise.resolve({ data: [], error: null });
    };
    const finish = () => {
      const uuidColumns = UUID_COLUMNS[table] ?? [];
      const invalidUuid = filters.some(
        ([column, value]) =>
          uuidColumns.includes(column) && (typeof value !== 'string' || !UUID_PATTERN.test(value)),
      );
      if (invalidUuid) {
        return {
          data: null,
          error: { code: '22P02', message: 'invalid input syntax for type uuid' },
        };
      }
      if (table === 'video_generations') {
        return rows.generation
          ? { data: rows.generation, error: null }
          : { data: null, error: { code: 'PGRST116', message: 'zero rows' } };
      }
      if (table === 'scheduled_posts') {
        return rows.slot === true
          ? { data: rows.slotRow ?? SLOT_ROW, error: null }
          : { data: null, error: { code: 'PGRST116', message: 'zero rows' } };
      }
      if (table === 'prompt_versions') return rows.promptVersion ?? { data: null, error: null };
      if (table === 'schedules') return { data: SCHEDULE_ROW, error: null };
      if (table === 'personas') return { data: { id: PERSONA_ID, name: 'Viva Leve' }, error: null };
      return { data: [], error: null };
    };
    api.single = async () => finish();
    api.maybeSingle = async () => finish();
    return api;
  });
  return { from, calls };
}

function install(rows: DbRows) {
  const client = mockDb(rows);
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, isApiKey: true, isOAuth: false },
    error: null,
  } as never);
  vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
  return client;
}

function installCookieSession(session: DbRows, service: DbRows) {
  const sessionClient = mockDb(session);
  const serviceClient = mockDb(service);
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, isApiKey: false, isOAuth: false },
    error: null,
  } as never);
  vi.mocked(createSupabaseServerClient).mockResolvedValue(sessionClient as never);
  vi.mocked(createSupabaseServiceClient).mockReturnValue(serviceClient as never);
  return { sessionClient, serviceClient };
}

function get(id: string) {
  return GET(new Request(`https://example.com/api/posts/${encodeURIComponent(id)}`), {
    params: Promise.resolve({ id }),
  });
}

function slotIdFilters(calls: DbCall[]): unknown[] {
  return calls
    .filter((call) => call.table === 'scheduled_posts' && call.op === 'eq' && call.args[0] === 'id')
    .map((call) => call.args[1]);
}

const BATCH_KEY = `batch:${SCHEDULE_ID}:slot:${SLOT_ID}`;

describe('GET /api/posts/[id] slot id normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves a batch key to the slot uuid and never filters uuid columns with the composite', async () => {
    const client = install({ slot: true });
    const response = await get(BATCH_KEY);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { kind: string; slot: { id: string } };
    expect(body.kind).toBe('slot');
    expect(body.slot.id).toBe(SLOT_ID);
    expect(slotIdFilters(client.calls)).toEqual([SLOT_ID]);
  });

  it('resolves a percent-encoded batch key', async () => {
    const client = install({ slot: true });
    const response = await get(encodeURIComponent(BATCH_KEY));
    expect(response.status).toBe(200);
    expect(slotIdFilters(client.calls)).toEqual([SLOT_ID]);
  });

  it('resolves a double-encoded batch key', async () => {
    const client = install({ slot: true });
    const response = await get(encodeURIComponent(encodeURIComponent(BATCH_KEY)));
    expect(response.status).toBe(200);
    expect(slotIdFilters(client.calls)).toEqual([SLOT_ID]);
  });

  it('404s garbage without querying scheduled_posts', async () => {
    const client = install({ slot: true });
    const response = await get('not-a-uuid');
    expect(response.status).toBe(404);
    expect(client.calls.filter((call) => call.table === 'scheduled_posts')).toEqual([]);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Post not found.');
  });

  it('404s a malformed batch key without querying scheduled_posts', async () => {
    const client = install({ slot: true });
    const response = await get(`batch:${SCHEDULE_ID}:slot:nope`);
    expect(response.status).toBe(404);
    expect(client.calls.filter((call) => call.table === 'scheduled_posts')).toEqual([]);
  });

  it('returns the prompt facts on the slot fallback for a cookie-session caller', async () => {
    const versionId = '7b0e6c1e-0000-4000-8000-000000000001';
    const slotRow = { ...SLOT_ROW, prompt_version_id: versionId };
    const { sessionClient, serviceClient } = installCookieSession(
      {
        slot: true,
        slotRow,
        promptVersion: { data: null, error: { code: '42501', message: 'permission denied for table prompt_versions' } },
      },
      {
        promptVersion: {
          data: { slug: 'community-hook', title: 'Community hook', version: 2, source: 'user', owner_id: 'other-user' },
          error: null,
        },
      },
    );
    const response = await get(SLOT_ID);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { kind: string; generation: { prompt: unknown } };
    expect(body.kind).toBe('slot');
    expect(body.generation.prompt).toEqual({ slug: 'community-hook', title: 'Community hook', version: 2, source: 'user' });
    expect(sessionClient.calls.filter((call) => call.table === 'prompt_versions')).toEqual([]);
    expect(serviceClient.calls.filter((call) => call.table === 'prompt_versions' && call.op === 'eq')).toEqual([
      { table: 'prompt_versions', op: 'eq', args: ['id', versionId] },
    ]);
  });

  it('looks up a plain slot uuid after the generation miss', async () => {
    const client = install({ slot: true });
    const response = await get(SLOT_ID);
    expect(response.status).toBe(200);
    expect(slotIdFilters(client.calls)).toEqual([SLOT_ID]);
  });

  it('returns a direct generation and does not query scheduled_posts', async () => {
    const client = install({
      generation: {
        id: 'vg-1',
        generation_id: 'gen-direct-1',
        engine_task_id: 'task-1',
        persona_name: 'Viva Leve',
        video_subject: 'myth busting',
        status: 'running',
        error_code: null,
        tokens_refunded: false,
        created_at: '2026-10-17T10:00:00.000Z',
        completed_at: null,
      },
    });
    const response = await get('gen-direct-1');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { kind: string; generation: { progress: number } };
    expect(body.kind).toBe('generation');
    expect(body.generation.progress).toBe(67);
    expect(client.calls.filter((call) => call.table === 'scheduled_posts')).toEqual([]);
  });

  it('prefers a generation row when the id is itself a batch key', async () => {
    const client = install({
      slot: true,
      generation: {
        id: 'vg-batch',
        generation_id: BATCH_KEY,
        engine_task_id: null,
        persona_name: 'Viva Leve',
        video_subject: 'myth busting',
        status: 'completed',
        error_code: null,
        tokens_refunded: false,
        created_at: '2026-10-17T10:00:00.000Z',
        completed_at: '2026-10-17T10:02:00.000Z',
      },
    });
    const response = await get(BATCH_KEY);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { kind: string };
    expect(body.kind).toBe('generation');
    expect(client.calls.filter((call) => call.table === 'scheduled_posts')).toEqual([]);
  });
});
