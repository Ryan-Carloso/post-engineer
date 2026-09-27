import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

//---------------
// Tests for POST /api/persona/video-job — proxy to money-print.
// Auth = Supabase session only (no API keys). Supabase (persona lookup
// + signed URLs) and global fetch (HTTP to money-print) are mocked
// boundaries; the payload assembly is real.
//---------------

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@/lib/billing/token-check', () => ({
  checkAndDeductTokens: vi.fn().mockResolvedValue({ ok: true, cost: 1 }),
  refundTokens: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/rate-limit', async (importOriginal) => {
  // Rate limiting is covered by the dedicated
  // app/api/persona/video-job/__tests__/rate-limit.test.ts suite; these
  // payload-behavior tests bypass it so every case reaches the handler.
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return {
    ...actual,
    applyRateLimit: vi.fn().mockResolvedValue(null),
  };
});

vi.mock('node:dns/promises', () => {
  const lookup = vi.fn();
  // named imports of a mocked builtin resolve via `default` in CJS interop —
  // expose the same fn in both places.
  return { lookup, default: { lookup } };
});

import { POST } from '../video-job/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { checkAndDeductTokens } from '@/lib/billing/token-check';
import * as videoGeneration from '@/lib/generation/video-generation';
import * as personaSchema from '@/lib/persona-schema';
import { lookup } from 'node:dns/promises';

const lookupMock = vi.mocked(lookup);

// mockDns — resolves the audio_url host to the given IPs (typed helper:
// the { all: true } overload of lookup confuses a direct mockResolvedValue).
function mockDns(...ips: string[]): void {
  lookupMock.mockResolvedValue(ips.map((ip) => ({ address: ip, family: 4 })) as never);
}

const USER_ID = 'user-uuid-1';
const ACCESS_TOKEN = 'supabase-access-token-abc';
const API_SECRET = 'engine-shared-secret';

const PERSONA = {
  id: 'p-1',
  user_id: USER_ID,
  name: 'Ana',
  photo_path: `${USER_ID}/foto.png`,
  avatar_url: null,
  voice_id: 'calm',
  voice_audio_path: null,
  // The video-job route requires a video_subject: it is defaulted from the
  // niche when the request omits it, so the shared fixture carries one.
  niche: 'fitness',
};

type AuthResult = Promise<{ data: { user: { id: string } | null }; error: null }>;
type SessionResult = Promise<{
  data: { session: { access_token: string } | null };
  error: null;
}>;

function mockSupabase(persona: Record<string, unknown> | null, opts?: { noSession?: boolean; noToken?: boolean }) {
  const getUser = vi.fn<() => AuthResult>(async () =>
    opts?.noSession
      ? { data: { user: null }, error: null }
      : { data: { user: { id: USER_ID } }, error: null },
  );
  const getSession = vi.fn<() => SessionResult>(async () =>
    opts?.noToken
      ? { data: { session: null }, error: null }
      : { data: { session: { access_token: ACCESS_TOKEN } }, error: null },
  );
  const client = {
    auth: {
      getUser,
      getSession,
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: persona ? { ...persona } : null,
              error: persona ? null : { message: 'not found' },
            })),
          })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      })),
    })),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(async (path: string) => ({
          data: { signedUrl: `https://supabase.test/signed/${path}` },
          error: null,
        })),
      })),
    },
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
  return client;
}

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/persona/video-job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body as Record<string, unknown>),
  });
}

const fetchMock = vi.fn<typeof fetch>();

describe('POST /api/persona/video-job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('MONEYPRINT_API_URL', 'http://moneyprint.internal:8080');
    vi.stubEnv('MONEYPRINT_API_SECRET', API_SECRET);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  //---------------
  // Auth: Supabase session only. API key headers are no longer accepted.
  //---------------

  it('returns 401 without a session', async () => {
    mockSupabase(PERSONA, { noSession: true });

    const res = await POST(jsonRequest({ personaId: 'p-1' }));

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 401 when there is a session but no access token', async () => {
    mockSupabase(PERSONA, { noToken: true });

    const res = await POST(jsonRequest({ personaId: 'p-1' }));

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 for a faceless request without any voice source', async () => {
    // Omitting personaId selects faceless mode; without a persona there is
    // no stored voice, so audio_url or voice_id is mandatory.
    mockSupabase(PERSONA);

    const res = await POST(jsonRequest({ video_subject: 'x' }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.error).toContain('audio_url or voice_id');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 when personaId is an empty string', async () => {
    mockSupabase(PERSONA);

    const res = await POST(jsonRequest({ personaId: '', video_subject: 'x' }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.error).toBe('personaId is required.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a faceless request without personaId (audio_url voice)', async () => {
    mockSupabase(PERSONA);
    mockAudioHead({ kind: 'ok', contentType: 'audio/mpeg', contentLength: '12345' });

    const res = await POST(
      jsonRequest({ video_subject: 'viagem', audio_url: 'https://cdn.test/narracao.mp3' }),
    );
    const body = (await res.json()) as { success: boolean; taskId?: string };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.taskId).toBe('t-x');

    const forwarded = JSON.parse(
      (fetchMock.mock.calls[1]?.[1]?.body ?? '{}') as string,
    ) as {
      persona: { name: string; photo_url?: string; voice_id?: string; voice_audio_url?: string };
      face_mix_percent: number;
      video_subject: string;
    };
    expect(forwarded.persona.name).toBe('Faceless generation');
    expect(forwarded.persona.voice_audio_url).toBe('https://cdn.test/narracao.mp3');
    expect(forwarded.persona.voice_id).toBeUndefined();
    expect(forwarded.persona.photo_url).toBeUndefined();
    expect(forwarded.face_mix_percent).toBe(0);
    expect(forwarded.video_subject).toBe('viagem');
  });

  it('accepts a faceless request with voice_id', async () => {
    mockSupabase(PERSONA);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 200, data: { task_id: 't-2' } }), { status: 200 }),
    );

    const res = await POST(
      jsonRequest({ video_subject: 'x', voice_id: 'calm' }),
    );
    const body = (await res.json()) as { success: boolean; taskId?: string };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    const forwarded = JSON.parse(
      (fetchMock.mock.calls[0]?.[1]?.body ?? '{}') as string,
    ) as {
      persona: { name: string; voice_id?: string; voice_audio_url?: string };
      face_mix_percent: number;
    };
    expect(forwarded.persona.name).toBe('Faceless generation');
    expect(forwarded.persona.voice_id).toBe('calm');
    expect(forwarded.persona.voice_audio_url).toBeUndefined();
    expect(forwarded.face_mix_percent).toBe(0);
  });

  it('drops voice_id when a faceless request carries both voice sources (engine requires exactly one)', async () => {
    // Regression: the engine rejects the job when both voice_id and
    // voice_audio_url are set. audio_url must win, matching the persona
    // flow's precedence.
    mockSupabase(PERSONA);
    mockAudioHead({ kind: 'ok', contentType: 'audio/mpeg', contentLength: '12345' });

    const res = await POST(
      jsonRequest({
        video_subject: 'x',
        voice_id: 'calm',
        audio_url: 'https://cdn.test/narracao.mp3',
      }),
    );
    const body = (await res.json()) as { success: boolean; taskId?: string };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    const forwarded = JSON.parse(
      (fetchMock.mock.calls[1]?.[1]?.body ?? '{}') as string,
    ) as {
      persona: { voice_id?: string; voice_audio_url?: string };
    };
    expect(forwarded.persona.voice_audio_url).toBe('https://cdn.test/narracao.mp3');
    expect(forwarded.persona.voice_id).toBeUndefined();
  });

  it('returns 400 for a faceless request without video_subject', async () => {
    // No persona niche to default the subject from: the request must carry it.
    mockSupabase(PERSONA);
    mockAudioHead({ kind: 'ok', contentType: 'audio/mpeg', contentLength: '12345' });

    const res = await POST(
      jsonRequest({ audio_url: 'https://cdn.test/narracao.mp3' }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.error).toContain('video_subject is required for faceless generation');
  });

  it('returns 400 when faceless voice_id is present but not a non-empty string', async () => {
    mockSupabase(PERSONA);

    for (const bad of [123, true, '   ']) {
      const res = await POST(jsonRequest({ video_subject: 'x', voice_id: bad }));
      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('returns 400 with invalid JSON', async () => {
    mockSupabase(PERSONA);

    const res = await POST(new Request('http://localhost/api/persona/video-job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    }));

    expect(res.status).toBe(400);
  });

  it('returns 500 when MONEYPRINT_API_URL is not defined', async () => {
    mockSupabase(PERSONA);
    vi.stubEnv('MONEYPRINT_API_URL', '');

    const res = await POST(jsonRequest({ personaId: 'p-1', video_subject: 'x' }));

    expect(res.status).toBe(500);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.error).toContain('MONEYPRINT_API_URL');
  });

  it('returns 404 when the persona does not exist or is not the user\'s', async () => {
    mockSupabase(null);

    const res = await POST(jsonRequest({ personaId: 'nope' }));

    expect(res.status).toBe(404);
  });

  //---------------
  // Persona-sourced values: the request guards only cover request values, but
  // a legacy persona row can carry an over-cap niche, an invalid video_aspect
  // or an over-long script_prompt straight into the engine (opaque 502).
  // Validate the stored values with the same caps and fail fast with an
  // actionable 400 before the token gate.
  //---------------

  it('returns 400 when the persona niche exceeds 300 characters', async () => {
    // Review round 10: the niche is the video_subject default — a legacy row
    // with a >300-char niche would forward an over-cap subject.
    mockSupabase({ ...PERSONA, niche: 'x'.repeat(301) });

    const res = await POST(jsonRequest({ personaId: 'p-1' }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('niche');
    expect(checkAndDeductTokens).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the persona language exceeds 35 characters', async () => {
    mockSupabase({ ...PERSONA, language: 'y'.repeat(36) });

    const res = await POST(jsonRequest({ personaId: 'p-1', video_subject: 'x' }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('language');
    expect(checkAndDeductTokens).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the persona video_aspect is not engine-valid', async () => {
    mockSupabase({ ...PERSONA, video_aspect: '16x9' });

    const res = await POST(jsonRequest({ personaId: 'p-1', video_subject: 'x' }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('video_aspect');
    expect(checkAndDeductTokens).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the persona script_prompt exceeds 2000 characters', async () => {
    mockSupabase({ ...PERSONA, script_prompt: 'z'.repeat(2001) });

    const res = await POST(jsonRequest({ personaId: 'p-1', video_subject: 'x' }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('script_prompt');
    expect(checkAndDeductTokens).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the persona paragraph_number is not an integer between 1 and 10', async () => {
    mockSupabase({ ...PERSONA, paragraph_number: 99 });

    const res = await POST(jsonRequest({ personaId: 'p-1', video_subject: 'x' }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('paragraph_number');
    expect(checkAndDeductTokens).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the persona face_mix_percent is above 100', async () => {
    // Review round 12: face_mix_percent was the one stored value left
    // unvalidated — buildJobPayload forwards any numeric value verbatim and
    // the billing gate charges it unchecked, so a corrupt/legacy row with
    // 150 reproduces the opaque-502 class this PR eliminates.
    mockSupabase({ ...PERSONA, face_mix_percent: 150 });

    const res = await POST(jsonRequest({ personaId: 'p-1', video_subject: 'x' }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('face_mix_percent');
    expect(checkAndDeductTokens).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the persona face_mix_percent is negative', async () => {
    mockSupabase({ ...PERSONA, face_mix_percent: -5 });

    const res = await POST(jsonRequest({ personaId: 'p-1', video_subject: 'x' }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('face_mix_percent');
    expect(checkAndDeductTokens).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only persona niche as absent instead of 400ing', async () => {
    // Review round 12: whitespace equals absent everywhere — a whitespace-only
    // niche is not a >300-char subject, it is no default at all.
    mockSupabase({ ...PERSONA, niche: ' '.repeat(301) });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 200, data: { task_id: 't-ws' } }), { status: 200 }),
    );

    const res = await POST(jsonRequest({ personaId: 'p-1', video_subject: 'x' }));

    expect(res.status).toBe(200);
  });

  it('treats a whitespace-only 301-char video_subject as absent (defaults from niche)', async () => {
    // Review round 12: the caps must exempt whitespace-only strings, matching
    // the payload assembly's absent semantics — a 301-char whitespace subject
    // is not a >300-char subject, it is no subject at all.
    mockSupabase(PERSONA);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 200, data: { task_id: 't-ws' } }), { status: 200 }),
    );

    const res = await POST(
      jsonRequest({ personaId: 'p-1', video_subject: ' '.repeat(301) }),
    );

    expect(res.status).toBe(200);
    const forwarded = JSON.parse(
      (fetchMock.mock.calls[0]?.[1]?.body ?? '{}') as string,
    ) as Record<string, unknown>;
    expect(forwarded.video_subject).toBe('fitness');
  });

  it('treats a whitespace-only 2001-char video_script_prompt as absent', async () => {
    mockSupabase(PERSONA);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 200, data: { task_id: 't-ws' } }), { status: 200 }),
    );

    const res = await POST(
      jsonRequest({ personaId: 'p-1', video_subject: 'x', video_script_prompt: ' '.repeat(2001) }),
    );

    expect(res.status).toBe(200);
    const forwarded = JSON.parse(
      (fetchMock.mock.calls[0]?.[1]?.body ?? '{}') as string,
    ) as Record<string, unknown>;
    // The whitespace request value is ignored; the payload falls back to the
    // niche-derived default prompt instead of forwarding the blob.
    expect(forwarded.video_script_prompt).toBe('The content niche is: fitness.');
  });

  it('treats a whitespace-only 36-char video_language as absent', async () => {
    mockSupabase(PERSONA);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 200, data: { task_id: 't-ws' } }), { status: 200 }),
    );

    const res = await POST(
      jsonRequest({ personaId: 'p-1', video_subject: 'x', video_language: ' '.repeat(36) }),
    );

    expect(res.status).toBe(200);
    const forwarded = JSON.parse(
      (fetchMock.mock.calls[0]?.[1]?.body ?? '{}') as string,
    ) as Record<string, unknown>;
    expect(forwarded).not.toHaveProperty('video_language');
  });

  //---------------
  // Forwarding to the engine: shared secret + x-user-id.
  //---------------

  it('forwards the job with the inline persona (photo + voice resolved)', async () => {
    mockSupabase(PERSONA);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 200, data: { task_id: 't-1' } }), { status: 200 }),
    );

    const res = await POST(
      jsonRequest({ personaId: 'p-1', video_subject: 'viagem', video_duration: 30 }),
    );
    const body = (await res.json()) as { success: boolean; taskId?: string };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.taskId).toBe('t-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://moneyprint.internal:8080/api/v1/videos',
      expect.objectContaining({ method: 'POST' }),
    );
    const forwarded = JSON.parse(
      (fetchMock.mock.calls[0]?.[1]?.body ?? '{}') as string,
    ) as {
      persona: { name: string; photo_url?: string; voice_id?: string };
      video_subject: string;
    };
    expect(forwarded.persona.name).toBe('Ana');
    expect(forwarded.persona.photo_url).toBe('https://supabase.test/signed/user-uuid-1/foto.png');
    expect(forwarded.persona.voice_id).toBe('calm');
    expect(forwarded.video_subject).toBe('viagem');

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers as HeadersInit);
    expect(headers.get('authorization')).toBe(`Bearer ${API_SECRET}`);
    expect(headers.get('x-api-key')).toBeNull();
    expect(headers.get('x-user-id')).toBe(USER_ID);
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('drops unknown request fields instead of forwarding them verbatim', async () => {
    // Review round 7: buildJobPayload spread the whole request body, so any
    // unknown or mistyped engine field (video_duration, voice_volume, ...)
    // traveled to the engine and surfaced as the opaque 502. Only known
    // engine-facing keys are forwarded now — the rest are dropped so the
    // failure class closes at once instead of growing one guard per review
    // round. (The warn aggregation is asserted by the round-8 test below.)
    mockSupabase(PERSONA);

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 200, data: { task_id: 't-allow' } }), { status: 200 }),
    );

    const res = await POST(
      jsonRequest({ personaId: 'p-1', video_subject: 'x', video_duration: 30, voice_volume: 2 }),
    );

    expect(res.status).toBe(200);
    const forwarded = JSON.parse(
      (fetchMock.mock.calls[0]?.[1]?.body ?? '{}') as string,
    ) as Record<string, unknown>;
    expect(forwarded.video_subject).toBe('x');
    expect(forwarded).not.toHaveProperty('video_duration');
    expect(forwarded).not.toHaveProperty('voice_volume');
  });

  it('uses voice_audio_url when the voice is a user sample', async () => {
    mockSupabase({
      ...PERSONA,
      voice_id: null,
      voice_audio_path: `${USER_ID}/voz.mp3`,
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 200, data: { task_id: 't-2' } }), { status: 200 }),
    );

    await POST(jsonRequest({ personaId: 'p-1' }));

    const forwarded = JSON.parse(
      (fetchMock.mock.calls[0]?.[1]?.body ?? '{}') as string,
    ) as { persona: { voice_audio_url?: string; voice_id?: string } };
    expect(forwarded.persona.voice_audio_url).toBe(
      'https://supabase.test/signed/user-uuid-1/voz.mp3',
    );
    expect(forwarded.persona.voice_id).toBeUndefined();
  });

  //---------------
  // Custom per-video audio (audio_url): overrides the persona's voice_audio_url;
  // it does not leak as a loose field in the engine payload.
  //---------------

  it('uses the request audio_url as voice_audio_url (persona override)', async () => {
    mockSupabase({
      ...PERSONA,
      voice_id: null,
      voice_audio_path: `${USER_ID}/voz.mp3`,
    });
    mockAudioHead({ kind: 'ok', contentType: 'audio/mpeg', contentLength: '12345' });

    await POST(jsonRequest({ personaId: 'p-1', audio_url: 'https://cdn.test/narracao.mp3' }));

    const forwarded = JSON.parse(
      (fetchMock.mock.calls[1]?.[1]?.body ?? '{}') as string,
    ) as { persona: { voice_audio_url?: string }; audio_url?: string; audioUrl?: string };
    expect(forwarded.persona.voice_audio_url).toBe('https://cdn.test/narracao.mp3');
    expect(forwarded.audio_url).toBeUndefined();
    expect(forwarded.audioUrl).toBeUndefined();
  });

  it('omits voice_id when audio_url overrides a persona voice (engine requires exactly one)', async () => {
    // Regression: the engine rejects the job with 400 when both voice_id and
    // voice_audio_url are set ("exactly one of voice_id or voice_audio_url is
    // required"), which the web used to surface as 502 "Video service rejected
    // the job." Unlike the test above, the persona here keeps its own voice_id.
    mockSupabase(PERSONA);
    mockAudioHead({ kind: 'ok', contentType: 'audio/mpeg', contentLength: '12345' });

    await POST(jsonRequest({ personaId: 'p-1', audio_url: 'https://cdn.test/narracao.mp3' }));

    const forwarded = JSON.parse(
      (fetchMock.mock.calls[1]?.[1]?.body ?? '{}') as string,
    ) as { persona: { voice_id?: string; voice_audio_url?: string } };
    expect(forwarded.persona.voice_audio_url).toBe('https://cdn.test/narracao.mp3');
    expect(forwarded.persona.voice_id).toBeUndefined();
  });

  it('accepts audioUrl (camelCase) as an alias of audio_url', async () => {
    mockSupabase(PERSONA);
    mockAudioHead({ kind: 'ok', contentType: 'audio/mpeg', contentLength: '12345' });

    await POST(jsonRequest({ personaId: 'p-1', audioUrl: 'https://cdn.test/narracao.mp3' }));

    const forwarded = JSON.parse(
      (fetchMock.mock.calls[1]?.[1]?.body ?? '{}') as string,
    ) as { persona: { voice_audio_url?: string } };
    expect(forwarded.persona.voice_audio_url).toBe('https://cdn.test/narracao.mp3');
  });

  it('returns 400 when audio_url is not a valid http(s) URL', async () => {
    mockSupabase(PERSONA);

    for (const bad of ['nota-url', 'ftp://cdn.test/a.mp3', 123, '']) {
      const res = await POST(jsonRequest({ personaId: 'p-1', audio_url: bad }));
      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('returns 400 when video_subject is present but not a string', async () => {
    // The engine requires video_subject as a string; a non-string would travel
    // to the engine and come back as the opaque 502 "Video service rejected
    // the job", so reject it here with an actionable client error instead.
    // null is exempt: clients serialize absent fields as null and it is
    // treated as absent (defaulted from the niche) downstream.
    mockSupabase(PERSONA);

    for (const bad of [123, true, { text: 'x' }, ['x']]) {
      const res = await POST(jsonRequest({ personaId: 'p-1', video_subject: bad }));
      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('returns 400 when video_language, video_aspect or video_script_prompt are present but not strings', async () => {
    // Review round 5: only video_subject was type-guarded. A non-string
    // video_script_prompt (or video_language / video_aspect) sailed through
    // applyPersonaPreferences verbatim and came back as the same opaque 502 —
    // reject with an actionable client error instead. null is exempt (absent).
    mockSupabase(PERSONA);

    for (const field of ['video_language', 'video_aspect', 'video_script_prompt'] as const) {
      for (const bad of [123, true, { text: 'x' }, ['x']]) {
        const res = await POST(jsonRequest({ personaId: 'p-1', [field]: bad }));
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error?: string };
        expect(body.error).toContain(field);
        expect(fetchMock).not.toHaveBeenCalled();
      }
    }
  });

  it('returns 400 when paragraph_number is present but not a number', async () => {
    // Same opaque-502 class as the string fields above: paragraph_number must
    // be numeric for the engine. null is exempt (treated as absent).
    mockSupabase(PERSONA);

    for (const bad of ['3', true, { n: 3 }, [3]]) {
      const res = await POST(jsonRequest({ personaId: 'p-1', paragraph_number: bad }));
      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('returns 400 when video_quality is present but not a string', async () => {
    // Review round 6: the type-guard loop missed video_quality, which
    // buildJobPayload forwards verbatim — a non-string would surface as the
    // same opaque 502. null is exempt (treated as absent).
    mockSupabase(PERSONA);

    for (const bad of [123, true, { q: 'hd' }, ['hd']]) {
      const res = await POST(jsonRequest({ personaId: 'p-1', video_quality: bad }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toContain('video_quality');
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('ignores a non-numeric request-level face_mix_percent — the persona value wins', async () => {
    // Review round 9: request-level face_mix_percent is dead — the engine has
    // no such field (extra="ignore" drops it) and the payload assembly
    // unconditionally overwrites it with the persona's value, so it was
    // removed from the allowlist. A non-numeric value is now dropped with a
    // warn instead of 400ing, and the persona's value reaches the engine.
    mockSupabase({ ...PERSONA, face_mix_percent: 100, face_quality: 'ok' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // Fresh Response per call: a Response body can only be consumed once.
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ status: 200, data: { task_id: 't-mix' } }), { status: 200 }),
        ),
      );

      for (const bad of ['60', true, { n: 60 }, [60]]) {
        const res = await POST(
          jsonRequest({ personaId: 'p-1', video_subject: 'x', face_mix_percent: bad }),
        );
        expect(res.status).toBe(200);
      }
      const forwarded = JSON.parse(
        (fetchMock.mock.calls[0]?.[1]?.body ?? '{}') as string,
      ) as Record<string, unknown>;
      expect(forwarded.face_mix_percent).toBe(100);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('face_mix_percent'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('returns 400 when video_aspect is not one of the engine-valid aspects', async () => {
    // Review round 8: type/range checks are not enough — the engine declares
    // video_aspect as an enum (Optional[VideoAspect]) and rejects unknown
    // values with 422, surfacing as the opaque 502. Mirror the debug flow's
    // VALID_VIDEO_ASPECTS. null (and '' — treated as absent downstream by the
    // persona-preference fallback) is exempt.
    mockSupabase(PERSONA);

    for (const bad of ['21:9', 'portrait', '16x9']) {
      const res = await POST(jsonRequest({ personaId: 'p-1', video_aspect: bad }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toContain('video_aspect');
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('returns 400 when video_quality is not one of the engine-valid qualities', async () => {
    // Review round 8: the engine declares video_quality as a non-Optional
    // LipSyncQuality enum ('ok' / 'very-good'); anything else 422s into the
    // opaque 502. '' is exempt — the payload assembly drops it as absent.
    mockSupabase(PERSONA);

    for (const bad of ['ultra', 'HD', 'very_good']) {
      const res = await POST(jsonRequest({ personaId: 'p-1', video_quality: bad }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toContain('video_quality');
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('returns 400 when video_script_prompt exceeds 2000 characters', async () => {
    // Review round 8: the engine caps video_script_prompt at max_length=2000
    // and the debug form flow mirrors it — the JSON flow must too, or an
    // unbounded string 422s into the opaque 502.
    mockSupabase(PERSONA);

    const res = await POST(
      jsonRequest({ personaId: 'p-1', video_script_prompt: 'x'.repeat(2001) }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('video_script_prompt');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 when video_subject exceeds 300 characters', async () => {
    // Review round 8: video_subject is unbounded end-to-end — a multi-megabyte
    // subject would be forwarded and fed into LLM prompts. Cap it like the
    // persona niche (300), which is also the subject's default source.
    mockSupabase(PERSONA);

    const res = await POST(
      jsonRequest({ personaId: 'p-1', video_subject: 'x'.repeat(301) }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('video_subject');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 when video_language exceeds 35 characters', async () => {
    // Review round 9: video_language was an unbounded string end-to-end. Cap
    // it at the BCP 47 max tag length (35) in both flows — the DB column is
    // text (no DB cap to mirror), so the cap is enforced at the API boundary.
    mockSupabase(PERSONA);

    const res = await POST(
      jsonRequest({ personaId: 'p-1', video_language: 'x'.repeat(36) }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('video_language');
    expect(fetchMock).not.toHaveBeenCalled();

    // Boundary value is accepted.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 200, data: { task_id: 't-lang' } }), { status: 200 }),
    );
    const ok = await POST(
      jsonRequest({ personaId: 'p-1', video_language: 'y'.repeat(35), video_subject: 'x' }),
    );
    expect(ok.status).toBe(200);
  });

  it('returns 400 when paragraph_number is not an integer between 1 and 10', async () => {
    // Review round 7: the type guard alone still let 3.5 / -1 / 999 through
    // to the engine (its schema is int, 1..10), surfacing as the same opaque
    // 502. Range-check here, mirroring the debug flow's zod schema.
    // null is exempt (treated as absent).
    mockSupabase(PERSONA);

    for (const bad of [3.5, 0, -1, 11, 999]) {
      const res = await POST(jsonRequest({ personaId: 'p-1', paragraph_number: bad }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toContain('paragraph_number');
      expect(fetchMock).not.toHaveBeenCalled();
    }

    // Boundary values are accepted and forwarded.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 200, data: { task_id: 't-range' } }), { status: 200 }),
    );
    const ok = await POST(jsonRequest({ personaId: 'p-1', paragraph_number: 10, video_subject: 'x' }));
    expect(ok.status).toBe(200);
    const forwarded = JSON.parse(
      (fetchMock.mock.calls[0]?.[1]?.body ?? '{}') as string,
    ) as Record<string, unknown>;
    expect(forwarded.paragraph_number).toBe(10);
  });

  it('ignores an out-of-range request-level face_mix_percent — the persona value wins', async () => {
    // Review round 9: same dead-field class as above — the request value is
    // dropped with a warn and the persona's mix is the only one the engine
    // (and the token gate) ever sees.
    mockSupabase({ ...PERSONA, face_mix_percent: 0 });

    // Fresh Response per call: a Response body can only be consumed once.
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: 200, data: { task_id: 't-mix' } }), { status: 200 }),
      ),
    );

    for (const bad of [-1, 101, 150, 62.5]) {
      const res = await POST(
        jsonRequest({ personaId: 'p-1', video_subject: 'x', face_mix_percent: bad }),
      );
      expect(res.status).toBe(200);
    }
    const forwarded = JSON.parse(
      (fetchMock.mock.calls[0]?.[1]?.body ?? '{}') as string,
    ) as Record<string, unknown>;
    expect(forwarded.face_mix_percent).toBe(0);
  });

  it('charges the very-good rate when the request overrides video_quality above the persona tier', async () => {
    // Review round 10: the token gate charged the persona's face_quality while
    // the engine ran the request's video_quality — a very-good override was
    // billed at the ok rate. The charge now follows the payload actually sent.
    mockSupabase({ ...PERSONA, face_mix_percent: 100, face_quality: 'ok' });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 200, data: { task_id: 't-bill' } }), { status: 200 }),
    );

    const res = await POST(
      jsonRequest({ personaId: 'p-1', video_subject: 'x', video_quality: 'very-good' }),
    );

    expect(res.status).toBe(200);
    expect(checkAndDeductTokens).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.any(String),
      100,
      'very_good',
    );
  });

  it('charges the persona rate when the request does not override video_quality', async () => {
    // No override: the payload quality is derived from the persona, so the
    // persona rate still applies.
    mockSupabase({ ...PERSONA, face_mix_percent: 100, face_quality: 'ok' });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 200, data: { task_id: 't-bill' } }), { status: 200 }),
    );

    const res = await POST(jsonRequest({ personaId: 'p-1', video_subject: 'x' }));

    expect(res.status).toBe(200);
    expect(checkAndDeductTokens).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.any(String),
      100,
      'ok',
    );
  });

  it('charges the cheaper rate when the request downgrades video_quality below the persona tier', async () => {
    // Review round 11: the charge follows the payload in both directions —
    // a request video_quality: 'ok' on a very_good persona bills the ok rate.
    mockSupabase({ ...PERSONA, face_mix_percent: 100, face_quality: 'very_good' });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 200, data: { task_id: 't-bill' } }), { status: 200 }),
    );

    const res = await POST(
      jsonRequest({ personaId: 'p-1', video_subject: 'x', video_quality: 'ok' }),
    );

    expect(res.status).toBe(200);
    expect(checkAndDeductTokens).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.any(String),
      100,
      'ok',
    );
  });

  it('treats a whitespace-only video_quality as absent instead of 400ing', async () => {
    // Review round 11: buildJobPayload treats whitespace as absent
    // (hasNonEmptyString/trim), so the route enum check must match — a
    // whitespace-only value is ignored, letting the persona-derived quality
    // apply, not rejected.
    mockSupabase({ ...PERSONA, face_mix_percent: 100, face_quality: 'ok' });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 200, data: { task_id: 't-ws' } }), { status: 200 }),
    );

    const res = await POST(
      jsonRequest({ personaId: 'p-1', video_subject: 'x', video_quality: '  ' }),
    );

    expect(res.status).toBe(200);
    const forwarded = JSON.parse(
      (fetchMock.mock.calls[0]?.[1]?.body ?? '{}') as string,
    ) as Record<string, unknown>;
    expect(forwarded.video_quality).toBe('ok');
  });

  it('treats a whitespace-only video_aspect as absent instead of 400ing', async () => {
    // Same absent semantics for the other enum-like field.
    mockSupabase(PERSONA);

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 200, data: { task_id: 't-ws' } }), { status: 200 }),
    );

    const res = await POST(
      jsonRequest({ personaId: 'p-1', video_subject: 'x', video_aspect: '  ' }),
    );

    expect(res.status).toBe(200);
    const forwarded = JSON.parse(
      (fetchMock.mock.calls[0]?.[1]?.body ?? '{}') as string,
    ) as Record<string, unknown>;
    expect(forwarded).not.toHaveProperty('video_aspect');
  });

  it('returns 400 when the persona has no voice and no custom audio_url is provided', async () => {
    // The engine requires exactly one of voice_id / voice_audio_url. When the
    // user neither picked a house voice nor provided a custom audio, fail fast
    // with an actionable 400 instead of the opaque 502 — and before the token
    // gate, so nothing is charged.
    mockSupabase({ ...PERSONA, voice_id: null, voice_audio_path: null });

    const res = await POST(jsonRequest({ personaId: 'p-1' }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/voice/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 503 when the persona has voice audio but signing its URL fails', async () => {
    // Review follow-up: signedUrl() swallows storage errors, so a persona with
    // voice_audio_path whose signed URL cannot be created must not get the
    // misleading "no voice configured" 400 — report what actually happened.
    const client = mockSupabase({
      ...PERSONA,
      voice_id: null,
      voice_audio_path: `${USER_ID}/voz.mp3`,
    });
    vi.mocked(client.storage.from).mockReturnValue({
      createSignedUrl: vi.fn(async () => ({ data: null, error: { message: 'storage down' } })),
    } as never);

    const res = await POST(jsonRequest({ personaId: 'p-1', video_subject: 'x' }));

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/could not be loaded/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs the resolved-error shape when storage signing fails without throwing', async () => {
    // Review round 10: signedUrl() only logged the thrown-error path, but the
    // common supabase-js failure shape resolves { data: null, error } — the
    // error was destructured away with zero server-side trace. Log it.
    const client = mockSupabase({
      ...PERSONA,
      voice_id: null,
      voice_audio_path: `${USER_ID}/voz.mp3`,
    });
    vi.mocked(client.storage.from).mockReturnValue({
      createSignedUrl: vi.fn(async () => ({ data: null, error: { message: 'storage down' } })),
    } as never);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await POST(jsonRequest({ personaId: 'p-1', video_subject: 'x' }));

      expect(res.status).toBe(503);
      expect(warnSpy).toHaveBeenCalledWith(
        '[video-job] failed to sign storage URL',
        expect.objectContaining({ message: 'storage down' }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('returns 503 when signing the voice URL throws instead of resolving an error', async () => {
    // Review round 5: the 503 classification only covered the resolved-error
    // shape of createSignedUrl. A rejection (network blip) propagated as a
    // generic 500 — map it to the same actionable 503.
    // Review round 6: the swallowed error must also be logged so storage
    // incidents stay diagnosable.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const client = mockSupabase({
        ...PERSONA,
        voice_id: null,
        voice_audio_path: `${USER_ID}/voz.mp3`,
      });
      vi.mocked(client.storage.from).mockReturnValue({
        createSignedUrl: vi.fn(async () => {
          throw new Error('network blip');
        }),
      } as never);

      const res = await POST(jsonRequest({ personaId: 'p-1', video_subject: 'x' }));

      expect(res.status).toBe(503);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/could not be loaded/i);
      expect(warnSpy).toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('returns 503 when the persona photo signing fails and a face is required', async () => {
    // Review round 7: signedUrl() swallows storage errors for the photo too —
    // a face-requiring persona (face_mix_percent > 0) whose photo_path cannot
    // be signed would forward photo_url: undefined and opaque-502 at the
    // engine. Classify it like the voice path: actionable 503 before the
    // token gate.
    const client = mockSupabase({
      ...PERSONA,
      face_mix_percent: 60,
      photo_path: `${USER_ID}/foto.png`,
      avatar_url: null,
    });
    vi.mocked(client.storage.from).mockReturnValue({
      createSignedUrl: vi.fn(async () => ({ data: null, error: { message: 'storage down' } })),
    } as never);

    const res = await POST(jsonRequest({ personaId: 'p-1', video_subject: 'x' }));

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/photo/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 503 when photo signing fails for a legacy persona with null face_mix_percent', async () => {
    // Review round 11: the photo 503 guard only fired on (faceMix ?? 0) > 0,
    // so a legacy persona (face_mix_percent: null — face-requiring by the
    // historical default the mix field was added on top of) whose photo_path
    // cannot be signed forwarded photo_url: undefined and opaque-502'd at
    // the engine. Classify it like the voice path.
    const client = mockSupabase({
      ...PERSONA,
      face_mix_percent: null,
      photo_path: `${USER_ID}/foto.png`,
      avatar_url: null,
    });
    vi.mocked(client.storage.from).mockReturnValue({
      createSignedUrl: vi.fn(async () => ({ data: null, error: { message: 'storage down' } })),
    } as never);

    const res = await POST(jsonRequest({ personaId: 'p-1', video_subject: 'x' }));

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/photo/i);
    expect(checkAndDeductTokens).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not 503 when photo signing fails for a faceless persona', async () => {
    // Review round 7: for faceless personas (face_mix_percent 0) a missing
    // photo is legitimate — the job proceeds instead of failing.
    const client = mockSupabase({
      ...PERSONA,
      face_mix_percent: 0,
      photo_path: `${USER_ID}/foto.png`,
      avatar_url: null,
    });
    vi.mocked(client.storage.from).mockReturnValue({
      createSignedUrl: vi.fn(async () => ({ data: null, error: { message: 'storage down' } })),
    } as never);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 200, data: { task_id: 't-faceless' } }), { status: 200 }),
    );

    const res = await POST(jsonRequest({ personaId: 'p-1', video_subject: 'x' }));

    expect(res.status).toBe(200);
  });

  it('uses avatar_url without signing when it is set, even if photo signing fails', async () => {
    // The avatar URL needs no signing: a photo_path signing failure must not
    // 503 a persona that already has a usable avatar.
    const client = mockSupabase({
      ...PERSONA,
      face_mix_percent: 60,
      photo_path: `${USER_ID}/foto.png`,
      avatar_url: 'https://cdn.test/avatar.png',
    });
    vi.mocked(client.storage.from).mockReturnValue({
      createSignedUrl: vi.fn(async () => ({ data: null, error: { message: 'storage down' } })),
    } as never);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 200, data: { task_id: 't-avatar' } }), { status: 200 }),
    );

    const res = await POST(jsonRequest({ personaId: 'p-1', video_subject: 'x' }));

    expect(res.status).toBe(200);
    const forwarded = JSON.parse(
      (fetchMock.mock.calls[0]?.[1]?.body ?? '{}') as string,
    ) as { persona: { photo_url?: string } };
    expect(forwarded.persona.photo_url).toBe('https://cdn.test/avatar.png');
  });

  //---------------
  // audio_url validation: audio files only (content-type audio/*)
  // within the size limit — verified via HEAD before charging
  // tokens. Fail closed: any verification problem rejects.
  //---------------

  type HeadBehavior =
    | { kind: 'ok'; contentType: string; contentLength: string }
    | { kind: 'status'; status: number }
    | { kind: 'throws' };

  function mockAudioHead(behavior: HeadBehavior): void {
    // Public DNS by default: the SSRF tests override when needed.
    mockDns('93.184.216.34');
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        if (behavior.kind === 'throws') throw new Error('network down');
        if (behavior.kind === 'status') {
          return new Response(null, { status: behavior.status });
        }
        return new Response(null, {
          status: 200,
          headers: {
            'content-type': behavior.contentType,
            'content-length': behavior.contentLength,
          },
        });
      }
      return new Response(JSON.stringify({ status: 200, data: { task_id: 't-x' } }), { status: 200 });
    });
  }

  it('returns 400 when audio_url points to non-audio content', async () => {
    mockSupabase(PERSONA);
    mockAudioHead({ kind: 'ok', contentType: 'text/html; charset=utf-8', contentLength: '1234' });

    const res = await POST(jsonRequest({ personaId: 'p-1', audio_url: 'https://cdn.test/narracao.mp3' }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.error).toMatch(/audio file/i);
    // engine was never called: only the verification HEAD happened
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when audio_url exceeds the max size', async () => {
    mockSupabase(PERSONA);
    mockAudioHead({ kind: 'ok', contentType: 'audio/mpeg', contentLength: String(21 * 1024 * 1024) });

    const res = await POST(jsonRequest({ personaId: 'p-1', audio_url: 'https://cdn.test/grande.mp3' }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.error).toMatch(/tamanho|MB/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when the audio_url HEAD fails (fail closed)', async () => {
    mockSupabase(PERSONA);
    mockAudioHead({ kind: 'throws' });

    const res = await POST(jsonRequest({ personaId: 'p-1', audio_url: 'https://cdn.test/narracao.mp3' }));

    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('redacts query-string credentials when logging an unreachable audio_url', async () => {
    // audio_url is commonly a pre-signed URL (?X-Amz-Signature=..., ?token=...);
    // the query string must never land in server logs.
    mockSupabase(PERSONA);
    mockAudioHead({ kind: 'throws' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const signedUrl = 'https://cdn.test/narracao.mp3?X-Amz-Signature=secret123&token=abc';
      const res = await POST(jsonRequest({ personaId: 'p-1', audio_url: signedUrl }));

      expect(res.status).toBe(400);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logged = warnSpy.mock.calls
        .flatMap((args) => args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))))
        .join(' ');
      expect(logged).not.toContain('secret123');
      expect(logged).not.toContain('X-Amz-Signature');
      expect(logged).not.toContain('token=abc');
      // The origin + path stay, so the log remains useful for debugging.
      expect(logged).toContain('https://cdn.test/narracao.mp3');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('returns 400 when the audio_url HEAD returns an HTTP error', async () => {
    mockSupabase(PERSONA);
    mockAudioHead({ kind: 'status', status: 404 });

    const res = await POST(jsonRequest({ personaId: 'p-1', audio_url: 'https://cdn.test/narracao.mp3' }));

    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts audio_url when HEAD confirms a small audio file', async () => {
    mockSupabase(PERSONA);
    mockAudioHead({ kind: 'ok', contentType: 'audio/mpeg', contentLength: '12345' });

    const res = await POST(jsonRequest({ personaId: 'p-1', audio_url: 'https://cdn.test/narracao.mp3' }));
    const body = (await res.json()) as { success: boolean; taskId?: string };

    expect(res.status).toBe(200);
    expect(body.taskId).toBe('t-x');
    // verification HEAD + POST to the engine
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const forwarded = JSON.parse(
      (fetchMock.mock.calls[1]?.[1]?.body ?? '{}') as string,
    ) as { persona: { voice_audio_url?: string } };
    expect(forwarded.persona.voice_audio_url).toBe('https://cdn.test/narracao.mp3');
  });

  //---------------
  // SSRF: audio_url must point to a public address. Private IPs,
  // loopback, link-local (169.254.169.254 = cloud metadata) and redirects
  // to those destinations are rejected with 400 before any fetch.
  //---------------

  it('returns 400 when audio_url is a private literal IP', async () => {
    mockSupabase(PERSONA);

    for (const url of [
      'http://127.0.0.1/voz.mp3',
      'http://10.0.0.5/voz.mp3',
      'http://192.168.1.10/voz.mp3',
      'http://169.254.169.254/latest/meta-data/',
    ]) {
      const res = await POST(jsonRequest({ personaId: 'p-1', audio_url: url }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { success: boolean; error: string };
      expect(body.error).toMatch(/public|private/i);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the audio_url host resolves to a private IP', async () => {
    mockSupabase(PERSONA);
    mockDns('10.0.0.5');

    const res = await POST(jsonRequest({ personaId: 'p-1', audio_url: 'https://cdn.test/voz.mp3' }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.error).toMatch(/public|private/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the audio_url DNS fails (fail closed)', async () => {
    mockSupabase(PERSONA);
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'));

    const res = await POST(jsonRequest({ personaId: 'p-1', audio_url: 'https://cdn.test/voz.mp3' }));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 when audio_url redirects to a private address', async () => {
    mockSupabase(PERSONA);
    mockDns('93.184.216.34');
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/voz.mp3' },
        });
      }
      return new Response(JSON.stringify({ status: 200, data: { task_id: 't-x' } }), { status: 200 });
    });

    const res = await POST(jsonRequest({ personaId: 'p-1', audio_url: 'https://cdn.test/voz.mp3' }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.error).toMatch(/private|internal|redirect/i);
    // only the initial HEAD happened; the redirect target was never fetched
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows redirect to a public address and accepts the audio_url', async () => {
    mockSupabase(PERSONA);
    mockDns('93.184.216.34');
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'HEAD') {
        if (url === 'https://cdn.test/voz.mp3') {
          return new Response(null, {
            status: 302,
            headers: { location: 'https://arquivos.test/voz.mp3' },
          });
        }
        return new Response(null, {
          status: 200,
          headers: { 'content-type': 'audio/mpeg', 'content-length': '12345' },
        });
      }
      return new Response(JSON.stringify({ status: 200, data: { task_id: 't-x' } }), { status: 200 });
    });

    const res = await POST(jsonRequest({ personaId: 'p-1', audio_url: 'https://cdn.test/voz.mp3' }));
    const body = (await res.json()) as { success: boolean; taskId?: string };

    expect(res.status).toBe(200);
    expect(body.taskId).toBe('t-x');
  });

  it('returns 502 when money-print is unavailable', async () => {
    mockSupabase(PERSONA);
    fetchMock.mockRejectedValue(new Error('connection refused'));

    const res = await POST(jsonRequest({ personaId: 'p-1' }));

    expect(res.status).toBe(502);
  });

  it('returns 502 when money-print rejects the job', async () => {
    mockSupabase(PERSONA);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: 'bad' }), { status: 422 }),
    );

    const res = await POST(jsonRequest({ personaId: 'p-1' }));

    expect(res.status).toBe(502);
  });

  //---------------
  // Content preferences — injected as payload defaults;
  // explicit request wins over the persona; null persona uses the house default.
  //---------------

  const PERSONA_COM_PREFERENCIAS = {
    ...PERSONA,
    language: 'pt',
    video_aspect: '16:9',
    script_prompt: 'Storytelling com hook forte.',
    paragraph_number: 3,
  };

  async function forwardJob(request: Request): Promise<Record<string, unknown>> {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 200, data: { task_id: 't-x' } }), { status: 200 }),
    );
    await POST(request);
    return JSON.parse((fetchMock.mock.calls[0]?.[1]?.body ?? '{}') as string) as Record<string, unknown>;
  }

  it('injects the persona preferences into the job payload', async () => {
    mockSupabase(PERSONA_COM_PREFERENCIAS);

    const forwarded = await forwardJob(jsonRequest({ personaId: 'p-1', video_subject: 'x' }));

    expect(forwarded.video_language).toBe('pt');
    expect(forwarded.video_aspect).toBe('16:9');
    expect(forwarded.video_script_prompt).toBe('Storytelling com hook forte.');
    expect(forwarded.paragraph_number).toBe(3);
  });

  it('explicit request wins over the persona', async () => {
    mockSupabase(PERSONA_COM_PREFERENCIAS);

    const forwarded = await forwardJob(
      jsonRequest({ personaId: 'p-1', video_language: 'en', paragraph_number: 5 }),
    );

    expect(forwarded.video_language).toBe('en');
    expect(forwarded.paragraph_number).toBe(5);
    expect(forwarded.video_aspect).toBe('16:9');
    expect(forwarded.video_script_prompt).toBe('Storytelling com hook forte.');
  });

  it('persona without preferences injects nothing: money-print house default', async () => {
    // Niche is nulled out on purpose: otherwise the niche→subject/script
    // defaults (a separate mechanism) would inject fields here.
    mockSupabase({ ...PERSONA, niche: null });

    const forwarded = await forwardJob(jsonRequest({ personaId: 'p-1', video_subject: 'x' }));

    expect(forwarded.video_language).toBeUndefined();
    expect(forwarded.video_aspect).toBeUndefined();
    expect(forwarded.video_script_prompt).toBeUndefined();
    expect(forwarded.paragraph_number).toBeUndefined();
  });

  it('defaults video_subject from the persona niche when the request omits it (engine requires it)', async () => {
    // Regression: the engine's TaskVideoRequest requires video_subject, but the
    // web never sent it unless the caller provided one — the engine rejected the
    // job with 400, surfaced as 502 "Video service rejected the job."
    mockSupabase({ ...PERSONA_COM_PREFERENCIAS, niche: 'weight loss' });

    const forwarded = await forwardJob(jsonRequest({ personaId: 'p-1' }));

    expect(forwarded.video_subject).toBe('weight loss');
  });

  it('keeps an explicit video_subject instead of defaulting from the niche', async () => {
    mockSupabase({ ...PERSONA_COM_PREFERENCIAS, niche: 'weight loss' });

    const forwarded = await forwardJob(jsonRequest({ personaId: 'p-1', video_subject: 'viagem' }));

    expect(forwarded.video_subject).toBe('viagem');
  });

  it('treats video_subject: null as absent and defaults from the persona niche', async () => {
    // Review follow-up: clients commonly serialize absent fields as null.
    // null must not bypass the niche default — forwarded verbatim, the engine
    // rejects it and the caller sees the same opaque 502 this PR eliminates.
    mockSupabase({ ...PERSONA_COM_PREFERENCIAS, niche: 'weight loss' });

    const forwarded = await forwardJob(jsonRequest({ personaId: 'p-1', video_subject: null }));

    expect(forwarded.video_subject).toBe('weight loss');
  });

  it('treats video_script_prompt: null as absent and injects the niche default', async () => {
    // Review follow-up: hasNonEmptyString changed null handling for the script
    // prompt too (previously null blocked the niche injection). Lock the
    // behavior in with a regression test.
    mockSupabase({ ...PERSONA, niche: 'weight loss' });

    const forwarded = await forwardJob(jsonRequest({ personaId: 'p-1', video_script_prompt: null }));

    expect(forwarded.video_script_prompt).toBe('The content niche is: weight loss.');
  });

  it('treats null preference fields as absent and falls back to the persona preference', async () => {
    // Review follow-up: applyPersonaPreferences treated null as "explicitly
    // present", suppressing the persona preference (and leaving null in the
    // payload for the niche default to paper over). null must behave like an
    // absent field.
    mockSupabase({ ...PERSONA_COM_PREFERENCIAS });

    const forwarded = await forwardJob(jsonRequest({ personaId: 'p-1', video_script_prompt: null }));

    expect(forwarded.video_script_prompt).toBe('Storytelling com hook forte.');
  });

  it('drops null preference fields instead of forwarding them verbatim', async () => {
    // Review follow-up: with no persona preference either, a null request
    // field must not travel to the engine as a bare null.
    mockSupabase({ ...PERSONA, niche: null });

    const forwarded = await forwardJob(
      jsonRequest({ personaId: 'p-1', video_subject: 'x', video_language: null }),
    );

    expect('video_language' in forwarded).toBe(false);
  });

  it('returns 400 when neither the request nor the persona yields a video_subject', async () => {
    // Review follow-up: a persona without a niche and no subject in the request
    // would forward no video_subject at all → engine 400 → the exact opaque
    // 502 this PR eliminates. Fail fast with an actionable 400 instead, before
    // the token gate so nothing is charged.
    mockSupabase({ ...PERSONA, niche: null });

    for (const body of [{ personaId: 'p-1' }, { personaId: 'p-1', video_subject: '' }, { personaId: 'p-1', video_subject: '   ' }]) {
      const res = await POST(jsonRequest(body));

      expect(res.status).toBe(400);
      const resBody = (await res.json()) as { error?: string };
      expect(resBody.error).toMatch(/video_subject/i);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  //---------------
  // lipsync: false — normal video (no InfiniteTalk intro on GPU).
  //---------------

  it('forwards lipsync_enabled=false when the request asks lipsync: false', async () => {
    mockSupabase(PERSONA);

    const forwarded = await forwardJob(jsonRequest({ personaId: 'p-1', lipsync: false }));

    expect(forwarded.lipsync_enabled).toBe(false);
    expect(forwarded.persona).toBeDefined();
  });

  it('does not forward lipsync_enabled by default (house default = lip-sync)', async () => {
    mockSupabase(PERSONA);

    const forwarded = await forwardJob(jsonRequest({ personaId: 'p-1' }));

    expect(forwarded.lipsync_enabled).toBeUndefined();
  });

  it('explicit request lipsync: true wins and is forwarded', async () => {
    mockSupabase(PERSONA);

    const forwarded = await forwardJob(jsonRequest({ personaId: 'p-1', lipsync: true }));

    expect(forwarded.lipsync_enabled).toBe(true);
  });

  //---------------
  // The persona niche guides the script when nothing else defines it.
  //---------------

  it('injects the persona niche into video_script_prompt when no script is defined', async () => {
    mockSupabase({ ...PERSONA, niche: 'finanças pessoais' });

    const forwarded = await forwardJob(jsonRequest({ personaId: 'p-1' }));

    expect(forwarded.video_script_prompt).toBe('The content niche is: finanças pessoais.');
  });

  it('persona scriptPrompt wins over the niche', async () => {
    mockSupabase({ ...PERSONA_COM_PREFERENCIAS, niche: 'finanças pessoais' });

    const forwarded = await forwardJob(jsonRequest({ personaId: 'p-1' }));

    expect(forwarded.video_script_prompt).toBe('Storytelling com hook forte.');
  });

  it('explicit video_script_prompt in the request wins over the niche', async () => {
    mockSupabase({ ...PERSONA, niche: 'finanças pessoais' });

    const forwarded = await forwardJob(
      jsonRequest({ personaId: 'p-1', video_script_prompt: 'Estilo documentário.' }),
    );

    expect(forwarded.video_script_prompt).toBe('Estilo documentário.');
  });

  it('MCP contract scriptPrompt is translated to video_script_prompt', async () => {
    mockSupabase(PERSONA_COM_PREFERENCIAS);

    const forwarded = await forwardJob(
      jsonRequest({ personaId: 'p-1', scriptPrompt: 'Override enviado pelo MCP.' }),
    );

    expect(forwarded.video_script_prompt).toBe('Override enviado pelo MCP.');
    expect(forwarded.scriptPrompt).toBeUndefined();
  });

  //---------------
  // Faceless/face mix + quality — forwarded to money-print.
  // video_quality uses the engine value ('very-good', not 'very_good').
  //---------------

  it('hybrid persona: injects face_mix_percent and converted video_quality', async () => {
    mockSupabase({ ...PERSONA, face_mix_percent: 100, face_quality: 'very_good' });

    const forwarded = await forwardJob(jsonRequest({ personaId: 'p-1' }));

    expect(forwarded.face_mix_percent).toBe(100);
    expect(forwarded.video_quality).toBe('very-good');
    expect(forwarded.lipsync_enabled).toBe(true);
  });

  it('face-ok persona forwards video_quality ok', async () => {
    mockSupabase({ ...PERSONA, face_mix_percent: 100, face_quality: 'ok' });

    const forwarded = await forwardJob(jsonRequest({ personaId: 'p-1' }));

    expect(forwarded.video_quality).toBe('ok');
    expect(forwarded.lipsync_enabled).toBe(true);
  });

  it('100% faceless persona (mix 0) turns off lipsync and omits video_quality', async () => {
    mockSupabase({ ...PERSONA, face_mix_percent: 0 });

    const forwarded = await forwardJob(jsonRequest({ personaId: 'p-1' }));

    expect(forwarded.face_mix_percent).toBe(0);
    expect(forwarded.lipsync_enabled).toBe(false);
    expect(forwarded.video_quality).toBeUndefined();
  });

  it('legacy persona (no face_mix_percent) injects nothing new', async () => {
    mockSupabase(PERSONA);

    const forwarded = await forwardJob(jsonRequest({ personaId: 'p-1' }));

    expect(forwarded.face_mix_percent).toBeUndefined();
    expect(forwarded.video_quality).toBeUndefined();
    expect(forwarded.lipsync_enabled).toBeUndefined();
  });

  it('explicit video_quality in the request wins over the persona', async () => {
    mockSupabase({ ...PERSONA, face_mix_percent: 100, face_quality: 'ok' });

    const forwarded = await forwardJob(
      jsonRequest({ personaId: 'p-1', video_quality: 'very-good' }),
    );

    expect(forwarded.video_quality).toBe('very-good');
  });

  it('does not forward video_quality: null for a legacy persona', async () => {
    // Review round 8 (MAJOR): video_quality is not a persona-preference
    // field, so applyPersonaPreferences never stripped its null marker, and
    // the face-mix repair only runs for numeric face mixes. A legacy persona
    // (face_mix_percent: null) receiving video_quality: null forwarded it
    // verbatim; the engine declares video_quality non-Optional and rejected
    // it with 422 — the exact opaque 502 this PR eliminates. The final null
    // pass in buildJobPayload drops it.
    mockSupabase(PERSONA);

    const forwarded = await forwardJob(
      jsonRequest({ personaId: 'p-1', video_quality: null }),
    );

    expect(forwarded).not.toHaveProperty('video_quality');
  });

  it('drops an empty video_quality for a legacy persona instead of forwarding it', async () => {
    // Review round 8: an empty video_quality can never be engine-valid
    // (non-Optional enum), so it is dropped as absent rather than forwarded
    // verbatim. null/'' are exempt from the route-level value check for this
    // reason.
    mockSupabase(PERSONA);

    const forwarded = await forwardJob(
      jsonRequest({ personaId: 'p-1', video_quality: '' }),
    );

    expect(forwarded).not.toHaveProperty('video_quality');
  });

  it('aggregates dropped unknown fields into a single capped warn', async () => {
    // Review round 8: one warn per unknown key is a cheap log-flooding
    // vector — the drops are reported in a single capped line instead.
    mockSupabase(PERSONA);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ status: 200, data: { task_id: 't-allow' } }), { status: 200 }),
      );

      const res = await POST(
        jsonRequest({ personaId: 'p-1', video_subject: 'x', video_duration: 30, voice_volume: 2 }),
      );

      expect(res.status).toBe(200);
      const forwarded = JSON.parse(
        (fetchMock.mock.calls[0]?.[1]?.body ?? '{}') as string,
      ) as Record<string, unknown>;
      expect(forwarded.video_subject).toBe('x');
      expect(forwarded).not.toHaveProperty('video_duration');
      expect(forwarded).not.toHaveProperty('voice_volume');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        '[video-job] dropping 2 unknown request field(s): "video_duration", "voice_volume"',
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('quotes dropped keys in the warn so key names cannot forge log lines', async () => {
    // Review round 10: key names were interpolated raw into the warn message,
    // and JSON object keys may contain newlines — an authenticated caller
    // could forge log lines. Keys are JSON-quoted now.
    mockSupabase(PERSONA);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ status: 200, data: { task_id: 't-allow' } }), { status: 200 }),
      );

      const res = await POST(
        jsonRequest({ personaId: 'p-1', video_subject: 'x', 'evil\nkey': 1 }),
      );

      expect(res.status).toBe(200);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = String(warnSpy.mock.calls[0]?.[0]);
      expect(message).toContain('"evil\\nkey"');
      expect(message).not.toContain('evil\nkey');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('explicit request lipsync wins over the mix: lipsync false over mix > 0', async () => {
    mockSupabase({ ...PERSONA, face_mix_percent: 100, face_quality: 'ok' });

    const forwarded = await forwardJob(jsonRequest({ personaId: 'p-1', lipsync: false }));

    expect(forwarded.lipsync_enabled).toBe(false);
  });

  //---------------
  // DEBUG branch (multipart + debugMode): inline FACELESS job, without creating
  // a persona/schedule.
  //---------------

  function multipartDebugRequest(values: Record<string, string>): Request {
    const formData = new FormData();
    for (const [key, value] of Object.entries(values)) formData.append(key, value);
    return new Request('http://localhost/api/persona/video-job', {
      method: 'POST',
      body: formData,
    });
  }

  it('debug: generates an inline faceless job and reports tokensSpent', async () => {
    mockSupabase(PERSONA);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 200, data: { task_id: 'debug-t-1' } }), { status: 200 }),
    );

    const res = await POST(multipartDebugRequest({
      debugMode: '1',
      personaMode: 'faceless',
      video_subject: 'finanças',
      niche: 'finanças',
      scriptPrompt: 'Narre como um documentário.',
      voiceId: 'pt-BR-FranciscaNeural',
      faceMixPercent: '0',
      faceQuality: 'ok',
    }));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.taskId).toBe('debug-t-1');
    expect(body.tokensSpent).toBe(1);

    const forwarded = JSON.parse(
      (fetchMock.mock.calls[0]?.[1]?.body ?? '{}') as string,
    ) as Record<string, unknown>;
    expect(forwarded.video_subject).toBe('finanças');
    expect(forwarded.video_script_prompt).toBe('Narre como um documentário.');
    // Same shape as the normal flow: voice goes inline in the persona.
    expect((forwarded.persona as Record<string, unknown>).voice_id).toBe('pt-BR-FranciscaNeural');
    expect(forwarded.face_mix_percent).toBe(0);
    expect(forwarded.lipsync_enabled).toBe(false);
    expect(forwarded.video_quality).toBeUndefined();
    // structural guarantee of "does not publish"
    for (const forbidden of ['platform_ids', 'publish', 'platforms', 'auto_upload']) {
      expect(Object.keys(forwarded)).not.toContain(forbidden);
    }
  });

  it('debug: charges tokens for mix/quality', async () => {
    mockSupabase(PERSONA);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 200, data: { task_id: 'debug-t-2' } }), { status: 200 }),
    );

    await POST(multipartDebugRequest({
      debugMode: '1',
      personaMode: 'persona',
      video_subject: 'história do egito',
      scriptPrompt: 'Narre como um documentário.',
      niche: 'história',
      voiceId: 'pt-BR-FranciscaNeural',
      faceMixPercent: '60',
      faceQuality: 'very_good',
    }));

    expect(checkAndDeductTokens).toHaveBeenCalledWith(expect.anything(), USER_ID, expect.any(String), 60, 'very_good');
  });

  it('debug: returns 402 without calling the engine when the balance is insufficient', async () => {
    mockSupabase(PERSONA);
    vi.mocked(checkAndDeductTokens).mockResolvedValueOnce({
      ok: false,
      error: 'Insufficient tokens. Required: 0.5, available: 0. Please upgrade your plan.',
      statusCode: 402,
      freeExhausted: false,
    });

    const res = await POST(multipartDebugRequest({ debugMode: '1', video_subject: 'Teste', voiceId: 'v-1' }));

    expect(res.status).toBe(402);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('debug: returns 400 without video_subject', async () => {
    mockSupabase(PERSONA);

    const res = await POST(multipartDebugRequest({ debugMode: '1', niche: '' }));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('debug: returns 400 when video_subject exceeds 300 characters', async () => {
    // Review round 9: the JSON flow caps video_subject at 300 but the debug
    // flow's zod schema had no max — the same multi-megabyte-subject-into-
    // LLM-prompts scenario stayed open on the multipart branch. The shared
    // schema caps it now, mirroring the JSON flow's 400.
    mockSupabase(PERSONA);

    const res = await POST(
      multipartDebugRequest({ debugMode: '1', video_subject: 'x'.repeat(301), voiceId: 'v-1' }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('video_subject');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('debug: returns 400 when language exceeds 35 characters', async () => {
    // Review round 9: same unbounded-string class as video_subject — the
    // shared schema caps language at the BCP 47 max tag length (35) in both
    // flows (it also backs persona creation).
    mockSupabase(PERSONA);

    const res = await POST(
      multipartDebugRequest({
        debugMode: '1',
        video_subject: 'x',
        voiceId: 'v-1',
        language: 'y'.repeat(36),
      }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('language');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('debug: returns 400 when the scriptPrompt fallback yields a subject over 300 characters', async () => {
    // Review round 10: the subject falls back to niche || scriptPrompt, and
    // scriptPrompt is capped at 2000 — a debug request with only a long
    // prompt produced a subject that bypassed the 300 cap enforced on the
    // direct field and the JSON flow. Reject it the same way.
    mockSupabase(PERSONA);

    const res = await POST(
      multipartDebugRequest({
        debugMode: '1',
        voiceId: 'v-1',
        scriptPrompt: 'z'.repeat(500),
      }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('video_subject');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('debug: returns 400 without calling the engine when no voice is configured', async () => {
    // Review round 6: the debug flow promised "same validation" but skipped
    // the voice guard — a debug job without a voice surfaced as the opaque
    // 502. Fail fast with an actionable 400 before the token gate.
    mockSupabase(PERSONA);

    const res = await POST(multipartDebugRequest({
      debugMode: '1',
      personaMode: 'faceless',
      video_subject: 'finanças',
      niche: 'finanças',
    }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/voice/i);
    expect(checkAndDeductTokens).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('debug: returns 400 before uploading the photo when no voice is configured', async () => {
    // Review round 7: the voice guard ran after the engine photo upload, so
    // a doomed voice-less debug job consumed an upstream upload per attempt.
    // Fail fast with the 400 before the upload.
    // (The jsdom multipart parser cannot handle file parts, so the parsed
    // form — photo included, voice omitted — is stubbed at the
    // parsePersonaForm seam instead of going through a real file upload.)
    mockSupabase(PERSONA);
    const uploadSpy = vi
      .spyOn(videoGeneration, 'uploadEngineTempAsset')
      .mockResolvedValue('https://engine.test/temp/face.png');
    const parseSpy = vi.spyOn(personaSchema, 'parsePersonaForm').mockReturnValue({
      ok: true,
      value: {
        values: {
          personaMode: 'persona',
          name: null,
          avatarUrl: null,
          voiceId: null,
          language: null,
          videoAspect: null,
          scriptPrompt: null,
          paragraphNumber: null,
          niche: null,
          faceMixPercent: null,
          faceQuality: null,
          videoSubject: 'retratos',
        },
        photo: { name: 'face.png' } as File,
        photoExtension: 'png',
      },
    });
    try {
      const res = await POST(multipartDebugRequest({ debugMode: '1' }));

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/voice/i);
      expect(uploadSpy).not.toHaveBeenCalled();
      expect(checkAndDeductTokens).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      uploadSpy.mockRestore();
      parseSpy.mockRestore();
    }
  });

  describe('generation history recording', () => {
    it('records the generation start and the running state on success', async () => {
      mockSupabase(PERSONA);
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ status: 200, data: { task_id: 't-1' } }), { status: 200 }),
      );
      const startSpy = vi.spyOn(videoGeneration, 'recordGenerationStart').mockResolvedValue(undefined);
      const updateSpy = vi.spyOn(videoGeneration, 'recordGenerationUpdate').mockResolvedValue(undefined);
      try {
        const res = await POST(
          jsonRequest({ personaId: 'p-1', video_subject: 'viagem', video_duration: 30 }),
        );
        expect(res.status).toBe(200);

        expect(startSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: USER_ID,
            generationId: expect.any(String),
            personaId: 'p-1',
            personaName: 'Ana',
            videoSubject: 'viagem',
          }),
        );
        expect(updateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            generationId: expect.any(String),
            status: 'running',
            engineTaskId: 't-1',
          }),
        );
      } finally {
        startSpy.mockRestore();
        updateSpy.mockRestore();
      }
    });

    it('records a failed generation with the rejection category when the engine rejects the job', async () => {
      mockSupabase(PERSONA);
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ status: 400, message: 'bad' }), { status: 400 }),
      );
      const startSpy = vi.spyOn(videoGeneration, 'recordGenerationStart').mockResolvedValue(undefined);
      const updateSpy = vi.spyOn(videoGeneration, 'recordGenerationUpdate').mockResolvedValue(undefined);
      try {
        const res = await POST(
          jsonRequest({ personaId: 'p-1', video_subject: 'viagem', video_duration: 30 }),
        );
        expect(res.status).toBe(502);

        expect(startSpy).toHaveBeenCalledWith(
          expect.objectContaining({ userId: USER_ID, generationId: expect.any(String) }),
        );
        expect(updateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            generationId: expect.any(String),
            status: 'failed',
            errorCode: 'engine_rejected',
            errorMessage: 'Video service rejected the job.',
            tokensRefunded: true,
          }),
        );
      } finally {
        startSpy.mockRestore();
        updateSpy.mockRestore();
      }
    });
  });
});
