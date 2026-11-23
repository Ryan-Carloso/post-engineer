// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(() => 'log-id'), warn: vi.fn(() => 'log-id'), info: vi.fn(() => 'log-id') },
}));

import { GET as listGenerations } from '../video-generations/route';
import { GET as getGeneration } from '../video-generations/[generationId]/route';
import { logger } from '@/lib/logger';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

const USER_ID = 'user-1';
const PERSONA_A = '11111111-1111-4111-8111-111111111111';
const PERSONA_B = '22222222-2222-4222-8222-222222222222';
const INJECTED = '33333333-3333-4333-8333-333333333333),persona_id.eq.hack';

interface GenerationFixture {
  persona_id: string | null;
  video_subject: string;
  generation_id: string;
}

function row(partial: GenerationFixture): GenerationFixture & Record<string, unknown> {
  return {
    id: `row-${partial.generation_id}`,
    engine_task_id: `task-${partial.generation_id}`,
    persona_name: partial.persona_id === null ? null : 'Named',
    status: 'completed',
    error_code: null,
    tokens_refunded: false,
    created_at: '2026-09-23T12:00:00.000Z',
    completed_at: '2026-09-23T12:02:00.000Z',
    ...partial,
  };
}

const ALLOWED = row({ persona_id: PERSONA_A, video_subject: 'allowed-subject', generation_id: 'gen-a' });
const OTHER = row({ persona_id: PERSONA_B, video_subject: 'secret-other-persona', generation_id: 'gen-b' });
const VOICEOVER = row({ persona_id: null, video_subject: 'voiceover-subject', generation_id: 'gen-f' });

function personaVisible(personaId: string | null, filter: string | null, nullOnly: boolean): boolean {
  if (filter === null && !nullOnly) return true;
  if (nullOnly && filter === null) return personaId === null;
  if (filter === null) return false;
  const inMatch = /persona_id\.in\.\(([^)]*)\)/.exec(filter);
  const ids = inMatch !== null && inMatch[1] !== '' ? inMatch[1].split(',') : [];
  const allowsNull = filter.includes('persona_id.is.null');
  if (personaId === null) return allowsNull;
  return ids.includes(personaId);
}

function mockList(rows: Array<GenerationFixture & Record<string, unknown>>) {
  let filter: string | null = null;
  let nullOnly = false;
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    or: vi.fn((value: string) => {
      filter = value;
      return chain;
    }),
    is: vi.fn((column: string, value: unknown) => {
      if (column === 'persona_id' && value === null) nullOnly = true;
      return chain;
    }),
    order: vi.fn(),
    limit: vi.fn(async () => ({
      data: rows.filter((item) => personaVisible(item.persona_id, filter, nullOnly)),
      error: null,
    })),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  const from = vi.fn(() => chain);
  return { from, chain };
}

function mockDetail(item: (GenerationFixture & Record<string, unknown>) | null) {
  let filter: string | null = null;
  let nullOnly = false;
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    or: vi.fn((value: string) => {
      filter = value;
      return chain;
    }),
    is: vi.fn((column: string, value: unknown) => {
      if (column === 'persona_id' && value === null) nullOnly = true;
      return chain;
    }),
    single: vi.fn(async () => {
      if (item === null || !personaVisible(item.persona_id, filter, nullOnly)) {
        return { data: null, error: { code: 'PGRST116' } };
      }
      return { data: item, error: null };
    }),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  const from = vi.fn(() => chain);
  return { from, chain };
}

function authAs(
  personaIds: string[] | null,
  isApiKey = true,
  extra: Record<string, unknown> = {},
): void {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'pe_live_key', isApiKey, personaIds, ...extra },
    error: null,
  } as never);
}

describe('GET /api/persona/video-generations persona scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides another persona and keeps the allowed persona plus a persona-less generation', async () => {
    authAs([PERSONA_A]);
    const client = mockList([ALLOWED, OTHER, VOICEOVER]);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await listGenerations(new Request('https://x/api/persona/video-generations'));
    const body = (await response.json()) as { generations: Array<{ videoSubject: string | null }> };
    const subjects = body.generations.map((generation) => generation.videoSubject);

    expect(response.status).toBe(200);
    expect(subjects).not.toContain('secret-other-persona');
    expect(subjects).toEqual(['allowed-subject', 'voiceover-subject']);
    const filter = client.chain.or.mock.calls[0]?.[0] as string;
    expect(filter).toContain(PERSONA_A);
    expect(filter).toContain('persona_id.is.null');
    expect(filter).not.toContain(PERSONA_B);
  });

  it('returns every generation for an unscoped API key and does not add a persona filter', async () => {
    authAs(null);
    const client = mockList([ALLOWED, OTHER, VOICEOVER]);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await listGenerations(new Request('https://x/api/persona/video-generations'));
    const body = (await response.json()) as { generations: Array<{ videoSubject: string | null }> };

    expect(response.status).toBe(200);
    expect(body.generations.map((generation) => generation.videoSubject)).toEqual([
      'allowed-subject',
      'secret-other-persona',
      'voiceover-subject',
    ]);
    expect(client.chain.or).not.toHaveBeenCalled();
    expect(client.chain.is).not.toHaveBeenCalled();
  });

  it('shows only persona-less generations when the key scope is empty', async () => {
    authAs([]);
    const client = mockList([ALLOWED, OTHER, VOICEOVER]);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await listGenerations(new Request('https://x/api/persona/video-generations'));
    const body = (await response.json()) as { generations: Array<{ videoSubject: string | null }> };

    expect(body.generations.map((generation) => generation.videoSubject)).toEqual(['voiceover-subject']);
    expect(client.chain.is).toHaveBeenCalledWith('persona_id', null);
    expect(client.chain.or).not.toHaveBeenCalled();
  });

  it('drops a malformed persona id before building the filter', async () => {
    authAs(['not-a-uuid', INJECTED]);
    const client = mockList([ALLOWED, OTHER, VOICEOVER]);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await listGenerations(new Request('https://x/api/persona/video-generations'));
    const body = (await response.json()) as { generations: Array<{ videoSubject: string | null }> };
    const filter = client.chain.or.mock.calls.map((call) => String(call[0])).join(' ');

    expect(body.generations.map((generation) => generation.videoSubject)).toEqual(['voiceover-subject']);
    expect(filter).not.toContain('not-a-uuid');
    expect(filter).not.toContain('hack');
    expect(filter).not.toContain(PERSONA_B);
  });

  it('does not add a persona filter for an OAuth caller', async () => {
    authAs([PERSONA_A], false, { isOAuth: true });
    const client = mockList([ALLOWED, OTHER, VOICEOVER]);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await listGenerations(new Request('https://x/api/persona/video-generations'));
    const body = (await response.json()) as { generations: Array<{ videoSubject: string | null }> };

    expect(response.status).toBe(200);
    expect(body.generations.map((generation) => generation.videoSubject)).toEqual([
      'allowed-subject',
      'secret-other-persona',
      'voiceover-subject',
    ]);
    expect(client.chain.or).not.toHaveBeenCalled();
    expect(client.chain.is).not.toHaveBeenCalled();
  });

  it('logs the database error and answers 500 when a scoped list query fails', async () => {
    authAs([PERSONA_A]);
    const dbError = { code: 'XX000', message: 'connection reset' };
    const client = mockList([ALLOWED]);
    client.chain.limit.mockResolvedValueOnce({ data: null, error: dbError } as never);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await listGenerations(new Request('https://x/api/persona/video-generations'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Could not load generation history.' });
    expect(logger.error).toHaveBeenCalledWith('[api/persona/video-generations] list failed', dbError);
  });
});

describe('GET /api/persona/video-generations/[generationId] persona scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function read(item: (GenerationFixture & Record<string, unknown>) | null): Promise<Response> {
    const client = mockDetail(item);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    return getGeneration(new Request('https://x/api/persona/video-generations/gen-b'), {
      params: Promise.resolve({ generationId: 'gen-b' }),
    });
  }

  it('answers 404 for another persona and does not return the subject', async () => {
    authAs([PERSONA_A]);
    const response = await read(OTHER);
    const text = await response.text();

    expect(response.status, text).toBe(404);
    expect(text).not.toContain('secret-other-persona');
  });

  it('returns an allowed persona generation', async () => {
    authAs([PERSONA_A]);
    const response = await read(ALLOWED);
    const body = (await response.json()) as { generation: { videoSubject: string } };

    expect(response.status).toBe(200);
    expect(body.generation.videoSubject).toBe('allowed-subject');
  });

  it('returns a persona-less generation to a scoped key', async () => {
    authAs([PERSONA_A]);
    const response = await read(VOICEOVER);
    const body = (await response.json()) as { generation: { videoSubject: string } };

    expect(response.status).toBe(200);
    expect(body.generation.videoSubject).toBe('voiceover-subject');
  });

  it('returns another persona generation to an unscoped API key', async () => {
    authAs(null);
    const response = await read(OTHER);
    const body = (await response.json()) as { generation: { videoSubject: string } };

    expect(response.status).toBe(200);
    expect(body.generation.videoSubject).toBe('secret-other-persona');
  });

  it('filters with persona_id is null when every scoped id is not a UUID', async () => {
    authAs(['not-a-uuid', INJECTED]);
    const client = mockDetail(VOICEOVER);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await getGeneration(new Request('https://x/api/persona/video-generations/gen-f'), {
      params: Promise.resolve({ generationId: 'gen-f' }),
    });
    const body = (await response.json()) as { generation: { videoSubject: string } };

    expect(response.status).toBe(200);
    expect(body.generation.videoSubject).toBe('voiceover-subject');
    expect(client.chain.is).toHaveBeenCalledWith('persona_id', null);
    expect(client.chain.or).not.toHaveBeenCalled();
  });

  it('does not add a persona filter for an OAuth caller', async () => {
    authAs([PERSONA_A], false, { isOAuth: true });
    const client = mockDetail(OTHER);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await getGeneration(new Request('https://x/api/persona/video-generations/gen-b'), {
      params: Promise.resolve({ generationId: 'gen-b' }),
    });
    const body = (await response.json()) as { generation: { videoSubject: string } };

    expect(response.status).toBe(200);
    expect(body.generation.videoSubject).toBe('secret-other-persona');
    expect(client.chain.or).not.toHaveBeenCalled();
    expect(client.chain.is).not.toHaveBeenCalled();
  });
});
