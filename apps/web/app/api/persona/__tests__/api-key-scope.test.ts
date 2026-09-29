import { NextResponse } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

//---------------
// Persona scope per API key: a restricted key only accesses the personas
// chosen at creation. Auth and Supabase are mocked boundaries; the access
// control (403 + .in filter) is real.
//---------------

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(() => ({})),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/generation/video-generation', () => ({
  attachGenerationTask: vi.fn(),
  gateGeneration: vi.fn(),
  refundFailedGeneration: vi.fn(),
  startEngineVideoTask: vi.fn(),
  uploadEngineTempAsset: vi.fn(),
}));

import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { gateGeneration } from '@/lib/generation/video-generation';
import { GET as listPersonas } from '../list/route';
import { POST as createPersona, PATCH as patchPersona, DELETE as deletePersona } from '../route';
import { POST as videoJob } from '../video-job/route';

const USER_ID = 'user-1';
const ALLOWED_ID = '11111111-1111-4111-8111-111111111111';
const DENIED_ID = '22222222-2222-4222-8222-222222222222';

function mockScopedAuth(): void {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: {
      userId: USER_ID,
      accessToken: 'pe_live_scoped',
      isApiKey: true,
      keyId: 'key-1',
      personaIds: [ALLOWED_ID],
    },
    error: null,
  });
}

function mockFullAccessAuth(): void {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'pe_live_full', isApiKey: true, keyId: 'key-2', personaIds: null },
    error: null,
  });
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockPersonaDb(personaId: string): void {
  const single = vi.fn().mockResolvedValue({
    data: {
      id: personaId,
      name: 'Ana',
      photo_path: null,
      avatar_url: 'https://example.com/avatar.png',
      voice_id: 'alloy',
      voice_audio_path: null,
      language: 'en-US',
      video_aspect: '9:16',
      script_prompt: null,
      paragraph_number: 1,
      niche: 'General',
      face_mix_percent: 50,
      face_quality: 'very_good',
    },
    error: null,
  });
  const eqInner = vi.fn().mockReturnValue({
    single,
    // The image-library query chains .order().order() (created_at + id
    // tie-break) instead of a second .eq().
    order: vi.fn().mockReturnValue({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  });
  const eqOuter = vi.fn().mockReturnValue({
    eq: eqInner,
    // The image-library query chains .order() after two .eq() calls.
    order: vi.fn().mockReturnValue({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  });
  const select = vi.fn().mockReturnValue({ eq: eqOuter });
  vi.mocked(createSupabaseServiceClient).mockReturnValue({
    from: vi.fn().mockReturnValue({ select }),
    storage: {
      from: vi.fn().mockReturnValue({
        createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.test/x' } }),
      }),
    },
  } as never);
  vi.mocked(gateGeneration).mockResolvedValue({
    ok: false,
    response: NextResponse.json({ success: false, error: 'Insufficient tokens.' }, { status: 402 }),
  } as never);
}

describe('persona scope enforcement for scoped api keys', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks persona creation with a scoped key', async () => {
    mockScopedAuth();
    const formData = new FormData();
    formData.set('name', 'New');
    const request = new Request('http://localhost:3434/api/persona', {
      method: 'POST',
      body: formData,
    });
    const response = await createPersona(request);
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.success).toBe(false);
  });

  it('blocks video-job for personas outside the scope', async () => {
    mockScopedAuth();
    const response = await videoJob(jsonRequest('http://localhost:3434/api/persona/video-job', { personaId: DENIED_ID }));
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(String(data.error)).toMatch(/does not have access/i);
  });

  it('blocks faceless video-job with a scoped key', async () => {
    // A persona-scoped key names explicit personas; a faceless job uses none
    // of them, so it is rejected even with a valid voice and subject.
    mockScopedAuth();
    const response = await videoJob(jsonRequest('http://localhost:3434/api/persona/video-job', { video_subject: 'x', voice_id: 'calm' }));
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(String(data.error)).toMatch(/faceless/i);
  });

  it('lets video-job pass the scope check for allowed personas', async () => {
    mockScopedAuth();
    mockPersonaDb(ALLOWED_ID);
    const response = await videoJob(jsonRequest('http://localhost:3434/api/persona/video-job', { personaId: ALLOWED_ID }));
    // Past the 403 scope check and reached the token gate (mocked 402).
    expect(response.status).toBe(402);
  });

  it('blocks persona update for personas outside the scope', async () => {
    mockScopedAuth();
    const formData = new FormData();
    formData.set('name', 'Renamed');
    const request = new Request(`http://localhost:3434/api/persona?personaId=${DENIED_ID}`, {
      method: 'PATCH',
      body: formData,
    });
    const response = await patchPersona(request);
    expect(response.status).toBe(403);
  });

  it('blocks persona deletion for personas outside the scope', async () => {
    mockScopedAuth();
    const request = new Request(`http://localhost:3434/api/persona?personaId=${DENIED_ID}`, {
      method: 'DELETE',
    });
    const response = await deletePersona(request);
    expect(response.status).toBe(403);
  });

  it('unrestricted keys keep full access', async () => {
    mockFullAccessAuth();
    mockPersonaDb(DENIED_ID);
    const response = await videoJob(jsonRequest('http://localhost:3434/api/persona/video-job', { personaId: DENIED_ID }));
    expect(response.status).toBe(402);
  });

  it('lists only scoped personas for restricted keys', async () => {
    mockScopedAuth();
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const inFilter = vi.fn().mockReturnValue({ order });
    const eqFilter = vi.fn().mockReturnValue({ order, in: inFilter });
    const { createSupabaseServiceClient } = await import('@/lib/supabase/service');
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: eqFilter }),
      }),
      storage: { from: vi.fn() },
    } as never);

    const request = new Request('http://localhost:3434/api/persona/list');
    const response = await listPersonas(request);
    expect(response.status).toBe(200);
    expect(inFilter).toHaveBeenCalledWith('id', [ALLOWED_ID]);
  });

  it('lists all personas for unrestricted keys', async () => {
    mockFullAccessAuth();
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const inFilter = vi.fn().mockReturnValue({ order });
    const eqFilter = vi.fn().mockReturnValue({ order, in: inFilter });
    const { createSupabaseServiceClient } = await import('@/lib/supabase/service');
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: eqFilter }),
      }),
      storage: { from: vi.fn() },
    } as never);

    const request = new Request('http://localhost:3434/api/persona/list');
    const response = await listPersonas(request);
    expect(response.status).toBe(200);
    expect(inFilter).not.toHaveBeenCalled();
  });
});
