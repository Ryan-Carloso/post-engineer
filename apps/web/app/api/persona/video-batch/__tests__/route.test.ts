// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

//---------------
// POST /api/persona/video-batch — one request, N persona videos (1..10),
// proxied to the engine batch endpoint. Billing stays engine-side: this
// route never gateGenerations (no double charge); history rows are recorded
// only after the engine accepts (202).
//---------------

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

// No-op the limiter here: a dedicated rate-limit suite owns the real
// behavior (see rate-limit.test.ts).
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, applyRateLimit: vi.fn(async () => null) };
});

vi.mock('@/lib/generation/video-generation', () => ({
  recordGenerationStart: vi.fn(),
  recordGenerationUpdate: vi.fn(),
  startEngineVideoBatch: vi.fn(),
  uploadEngineTempAsset: vi.fn(),
}));

vi.mock('@/lib/persona-images', () => ({
  IMAGE_BUCKET: 'personas',
  recordRecentImageId: vi.fn(),
  resolveVideoImage: vi.fn(),
}));

import { POST, parseTopics, parseWebhookUrl } from '../route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  recordGenerationStart,
  recordGenerationUpdate,
  startEngineVideoBatch,
  uploadEngineTempAsset,
} from '@/lib/generation/video-generation';
import { recordRecentImageId, resolveVideoImage } from '@/lib/persona-images';

const USER_ID = 'user-1';
const URL = 'http://localhost:3434/api/persona/video-batch';

const FULL_AUTH = {
  userId: USER_ID,
  accessToken: 'session-token',
  isApiKey: false,
  personaIds: null as string[] | null,
};

const BASE_PERSONA = {
  id: 'persona-1',
  name: 'Ana',
  photo_path: null,
  avatar_url: 'https://cdn.example/avatar.png',
  voice_id: 'voice-1',
  voice_audio_path: null,
  language: 'pt-BR',
  video_aspect: '9:16',
  script_prompt: null,
  paragraph_number: 3,
  niche: 'fitness',
  face_mix_percent: 80,
  face_quality: 'very_good',
  recent_image_ids: [],
};

interface SupabaseHarness {
  createSignedUrl: ReturnType<typeof vi.fn>;
}

function mockSupabase(
  persona: unknown,
  personaError: { code: string } | null = null,
  signedUrl: string | null = 'https://signed.example/x',
): SupabaseHarness {
  const createSignedUrl = vi.fn(async () =>
    signedUrl
      ? { data: { signedUrl }, error: null }
      : { data: null, error: { message: 'signing failed' } },
  );
  const single = vi.fn(async () => ({ data: persona, error: personaError }));
  const secondEq = { single };
  const firstEq = { eq: vi.fn(() => secondEq) };
  const selectResult = { eq: vi.fn(() => firstEq) };
  const fromResult = { select: vi.fn(() => selectResult) };
  vi.mocked(createSupabaseServiceClient).mockReturnValue({
    from: vi.fn(() => fromResult),
    storage: { from: vi.fn(() => ({ createSignedUrl })) },
  } as never);
  return { createSignedUrl };
}

function mockAuth(auth: typeof FULL_AUTH | null, error: NextResponse | null): void {
  vi.mocked(requireSupabaseSession).mockResolvedValue({ auth, error } as never);
}

function jsonRequest(body: unknown): Request {
  return new Request(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postJson(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await POST(jsonRequest(body));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function pngFile(name: string): File {
  // Real PNG magic bytes, like the create-with-images suite: the server
  // validates content, not just the declared MIME type.
  const bytes = new Uint8Array(8);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new File([bytes], name, { type: 'image/png' });
}

function multipartRequest(form: FormData): Request {
  return new Request(URL, { method: 'POST', body: form });
}

function debugForm(extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set('video_subject', 'morning routine');
  form.set('voiceId', 'voice-debug');
  form.set('personaMode', 'persona');
  form.set('name', 'Debug Ana');
  form.set('topics', JSON.stringify(['topic one', 'topic two']));
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth(FULL_AUTH, null);
  mockSupabase({ ...BASE_PERSONA });
  vi.mocked(startEngineVideoBatch).mockResolvedValue({ ok: true, taskIds: ['task-1', 'task-2'], body: null });
  vi.mocked(resolveVideoImage).mockResolvedValue({ ok: true, image: null });
  vi.mocked(uploadEngineTempAsset).mockResolvedValue('https://engine.example/temp/photo.png');
});

describe('parseTopics', () => {
  it('accepts 1..10 trimmed topics', () => {
    expect(parseTopics(['  one  ', 'two'])).toEqual({ ok: true, topics: ['one', 'two'] });
    expect(parseTopics(['solo'])).toEqual({ ok: true, topics: ['solo'] });
  });

  it('rejects a non-array', () => {
    const result = parseTopics('nope');
    expect(result.ok).toBe(false);
  });

  it('rejects an empty array', () => {
    expect(parseTopics([])).toEqual({ ok: false, error: 'Provide at least one video topic.' });
  });

  it('rejects blank topics', () => {
    const result = parseTopics(['ok', '   ']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Topics must not be empty.');
  });

  it('rejects non-string items', () => {
    const result = parseTopics(['ok', 42]);
    expect(result).toEqual({ ok: false, error: 'Each topic must be a string.' });
  });

  it('rejects more than 10 topics', () => {
    const result = parseTopics(Array.from({ length: 11 }, (_, i) => `topic ${i}`));
    expect(result).toEqual({ ok: false, error: 'A batch holds at most 10 videos.' });
  });

  it('rejects topics longer than 300 chars', () => {
    const result = parseTopics(['x'.repeat(301)]);
    expect(result.ok).toBe(false);
  });
});

describe('parseWebhookUrl', () => {
  it('treats absent values as no webhook', () => {
    expect(parseWebhookUrl(undefined)).toEqual({ ok: true });
    expect(parseWebhookUrl(null)).toEqual({ ok: true });
    expect(parseWebhookUrl('')).toEqual({ ok: true });
  });

  it('accepts http(s) URLs', () => {
    expect(parseWebhookUrl('https://hooks.example/done')).toEqual({
      ok: true,
      url: 'https://hooks.example/done',
    });
  });

  it('rejects non-URLs, non-strings, and non-http(s) schemes', () => {
    expect(parseWebhookUrl('not a url').ok).toBe(false);
    expect(parseWebhookUrl(42).ok).toBe(false);
    expect(parseWebhookUrl('ftp://hooks.example/x').ok).toBe(false);
  });
});

describe('POST /api/persona/video-batch auth and payload', () => {
  it('passes the auth error through', async () => {
    mockAuth(null, new NextResponse('auth', { status: 401 }) as NextResponse);
    const res = await POST(jsonRequest({ personaId: 'x', topics: ['a'] }));
    expect(res.status).toBe(401);
  });

  it('rejects invalid JSON', async () => {
    const res = await POST(new Request(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' }));
    expect(res.status).toBe(400);
  });

  it('rejects a missing topics array', async () => {
    const { status, json } = await postJson({ personaId: 'persona-1' });
    expect(status).toBe(400);
    expect(json.error).toBe('topics must be an array of 1 to 10 video topics.');
  });

  it('rejects conflicting image_id/imageId spellings', async () => {
    const { status, json } = await postJson({
      personaId: 'persona-1',
      topics: ['a'],
      image_id: 'img-a',
      imageId: 'img-b',
    });
    expect(status).toBe(400);
    expect(json.error).toBe('Provide either image_id or imageId, not both.');
  });

  it('rejects conflicting webhook_url/webhookUrl spellings', async () => {
    const { status, json } = await postJson({
      personaId: 'persona-1',
      topics: ['a'],
      webhook_url: 'https://a.example',
      webhookUrl: 'https://b.example',
    });
    expect(status).toBe(400);
    expect(json.error).toBe('Provide either webhook_url or webhookUrl, not both.');
  });

  it('rejects a malformed webhookUrl before touching the engine', async () => {
    const { status } = await postJson({ personaId: 'persona-1', topics: ['a'], webhookUrl: 'ftp://x' });
    expect(status).toBe(400);
    expect(startEngineVideoBatch).not.toHaveBeenCalled();
  });

  it('rejects a non-string personaId', async () => {
    const { status, json } = await postJson({ personaId: 42, topics: ['a'] });
    expect(status).toBe(400);
    expect(json.error).toBe('personaId is required.');
  });
});

describe('POST /api/persona/video-batch faceless', () => {
  it('requires a voice for faceless batches', async () => {
    const { status, json } = await postJson({ personaId: null, topics: ['a'] });
    expect(status).toBe(400);
    expect(json.error).toBe('No voice available: batch faceless generation requires voice_id.');
  });

  it('rejects conflicting voice_id/voiceId spellings', async () => {
    const { status, json } = await postJson({
      personaId: null,
      topics: ['a'],
      voice_id: 'v1',
      voiceId: 'v2',
    });
    expect(status).toBe(400);
    expect(json.error).toBe('Provide either voice_id or voiceId, not both.');
  });

  it('rejects faceless batches for persona-scoped API keys', async () => {
    mockAuth({ ...FULL_AUTH, isApiKey: true, personaIds: ['persona-9'] }, null);
    const { status, json } = await postJson({ personaId: null, topics: ['a'], voice_id: 'v1' });
    expect(status).toBe(403);
    expect(json.error).toContain('restricted to specific personas');
  });

  it('rejects image_id on faceless batches', async () => {
    const { status, json } = await postJson({
      personaId: null,
      topics: ['a'],
      voice_id: 'v1',
      image_id: 'img-1',
    });
    expect(status).toBe(400);
    expect(json.error).toBe('image_id requires a personaId: faceless videos have no image library.');
  });

  it('sends the faceless batch to the engine with face_mix_percent 0', async () => {
    const { status, json } = await postJson({
      topics: ['one', 'two'],
      voice_id: 'voice-house',
      webhookUrl: 'https://hooks.example/done',
    });
    expect(status).toBe(200);
    expect(json).toEqual({ success: true, taskIds: ['task-1', 'task-2'] });
    expect(startEngineVideoBatch).toHaveBeenCalledWith(USER_ID, {
      persona: { name: 'Faceless generation', voice_id: 'voice-house', language: 'pt-BR' },
      items: [{ topic: 'one' }, { topic: 'two' }],
      face_mix_percent: 0,
      face_quality: 'ok',
      webhook_url: 'https://hooks.example/done',
    });
    // One history row per video, each carrying its engine task id.
    expect(recordGenerationStart).toHaveBeenCalledTimes(2);
    expect(recordGenerationUpdate).toHaveBeenCalledTimes(2);
    expect(vi.mocked(recordGenerationUpdate).mock.calls[0]?.[0]).toMatchObject({
      status: 'running',
      engineTaskId: 'task-1',
    });
  });
});

describe('POST /api/persona/video-batch stored persona', () => {
  it('returns 404 when the persona does not exist', async () => {
    mockSupabase(null, { code: 'PGRST116' });
    const { status, json } = await postJson({ personaId: 'persona-1', topics: ['a'] });
    expect(status).toBe(404);
    expect(json.error).toBe('Persona not found.');
  });

  it('returns 500 on a real DB failure (not a bare 404)', async () => {
    mockSupabase(null, { code: 'XX000' });
    const { status, json } = await postJson({ personaId: 'persona-1', topics: ['a'] });
    expect(status).toBe(500);
    expect(json.error).toBe('Failed to load persona.');
  });

  it('rejects a scoped key without access to the persona', async () => {
    mockAuth({ ...FULL_AUTH, isApiKey: true, personaIds: ['other-persona'] }, null);
    const { status } = await postJson({ personaId: 'persona-1', topics: ['a'] });
    expect(status).toBe(403);
  });

  it('rejects stored-value overflows before billing', async () => {
    for (const [override, error] of [
      [{ niche: 'n'.repeat(301) }, 'persona niche must be at most 300 characters: update the persona.'],
      [{ language: 'l'.repeat(36) }, 'persona language must be at most 35 characters: update the persona.'],
      [{ video_aspect: '4:3' }, 'persona video_aspect must be one of 9:16, 16:9, 1:1: update the persona.'],
      [{ face_mix_percent: 150 }, 'persona face_mix_percent must be a number between 0 and 100: update the persona.'],
      [{ paragraph_number: 0 }, 'persona paragraph_number must be an integer between 1 and 10: update the persona.'],
    ] as const) {
      mockSupabase({ ...BASE_PERSONA, ...override });
      const { status, json } = await postJson({ personaId: 'persona-1', topics: ['a'] });
      expect(status).toBe(400);
      expect(json.error).toBe(error);
      expect(startEngineVideoBatch).not.toHaveBeenCalled();
    }
  });

  it('returns 400 when the persona has no voice at all', async () => {
    mockSupabase({ ...BASE_PERSONA, voice_id: null, voice_audio_path: null });
    const { status, json } = await postJson({ personaId: 'persona-1', topics: ['a'] });
    expect(status).toBe(400);
    expect(json.error).toBe('No voice available: the persona has no voice configured.');
  });

  it('returns 503 when the stored voice audio cannot be signed', async () => {
    mockSupabase({ ...BASE_PERSONA, voice_id: null, voice_audio_path: 'voice/clip.mp3' }, null, null);
    const { status, json } = await postJson({ personaId: 'persona-1', topics: ['a'] });
    expect(status).toBe(503);
    expect(json.error).toContain('Voice audio is configured');
  });

  it('prefers voice_audio_url over voice_id in the engine persona', async () => {
    vi.mocked(startEngineVideoBatch).mockResolvedValue({ ok: true, taskIds: ['task-1'], body: null });
    mockSupabase({ ...BASE_PERSONA, voice_audio_path: 'voice/clip.mp3' });
    const { status } = await postJson({ personaId: 'persona-1', topics: ['a'] });
    expect(status).toBe(200);
    const payload = vi.mocked(startEngineVideoBatch).mock.calls[0]?.[1] as Record<string, unknown>;
    const persona = payload.persona as Record<string, unknown>;
    expect(persona.voice_audio_url).toBe('https://signed.example/x');
    expect(persona.voice_id).toBeUndefined();
  });

  it('uses the library pick for the batch photo and records rotation after accept', async () => {
    vi.mocked(resolveVideoImage).mockResolvedValue({
      ok: true,
      image: { id: 'img-7', image_path: 'library/img7.png' } as never,
    });
    const { status } = await postJson({ personaId: 'persona-1', topics: ['a', 'b'] });
    expect(status).toBe(200);
    const payload = vi.mocked(startEngineVideoBatch).mock.calls[0]?.[1] as Record<string, unknown>;
    const persona = payload.persona as Record<string, unknown>;
    expect(persona.photo_url).toBe('https://signed.example/x');
    expect(recordRecentImageId).toHaveBeenCalledWith(
      expect.anything(),
      'persona-1',
      'img-7',
      USER_ID,
    );
  });

  it('never falls back to another face when the library pick cannot be signed', async () => {
    vi.mocked(resolveVideoImage).mockResolvedValue({
      ok: true,
      image: { id: 'img-7', image_path: 'library/img7.png' } as never,
    });
    mockSupabase({ ...BASE_PERSONA }, null, null);
    const { status, json } = await postJson({ personaId: 'persona-1', topics: ['a'] });
    expect(status).toBe(503);
    expect(json.error).toBe('The selected persona image could not be loaded. Please try again.');
    expect(startEngineVideoBatch).not.toHaveBeenCalled();
    expect(recordRecentImageId).not.toHaveBeenCalled();
  });

  it('passes the library selection error through', async () => {
    vi.mocked(resolveVideoImage).mockResolvedValue({ ok: false, error: 'Unknown image_id.', status: 404 });
    const { status, json } = await postJson({ personaId: 'persona-1', topics: ['a'], image_id: 'nope' });
    expect(status).toBe(404);
    expect(json.error).toBe('Unknown image_id.');
    expect(startEngineVideoBatch).not.toHaveBeenCalled();
  });

  it('does not record rotation history for a pinned image_id', async () => {
    vi.mocked(startEngineVideoBatch).mockResolvedValue({ ok: true, taskIds: ['task-1'], body: null });
    vi.mocked(resolveVideoImage).mockResolvedValue({
      ok: true,
      image: { id: 'img-7', image_path: 'library/img7.png' } as never,
    });
    const { status } = await postJson({ personaId: 'persona-1', topics: ['a'], image_id: 'img-7' });
    expect(status).toBe(200);
    expect(recordRecentImageId).not.toHaveBeenCalled();
  });

  it('maps engine INSUFFICIENT to 402 without recording history', async () => {
    vi.mocked(startEngineVideoBatch).mockResolvedValue({
      ok: false,
      upstreamStatus: 400,
      upstreamBody: { status: 400, message: 'INSUFFICIENT_TOKENS' },
      response: NextResponse.json({ success: false, error: 'x' }, { status: 400 }),
    });
    const { status, json } = await postJson({ personaId: 'persona-1', topics: ['a', 'b'] });
    expect(status).toBe(402);
    expect(json.code).toBe('INSUFFICIENT');
    expect(recordGenerationStart).not.toHaveBeenCalled();
    expect(recordRecentImageId).not.toHaveBeenCalled();
  });

  it('passes other engine errors through untouched', async () => {
    const upstream = NextResponse.json({ success: false, error: 'engine broke' }, { status: 503 });
    vi.mocked(startEngineVideoBatch).mockResolvedValue({
      ok: false,
      upstreamStatus: 503,
      upstreamBody: { message: 'engine broke' },
      response: upstream,
    });
    const res = await POST(jsonRequest({ personaId: 'persona-1', topics: ['a'] }));
    expect(res.status).toBe(503);
    expect(recordGenerationStart).not.toHaveBeenCalled();
  });

  it('returns 502 when the engine task id count mismatches the topics', async () => {
    vi.mocked(startEngineVideoBatch).mockResolvedValue({ ok: true, taskIds: ['only-one'], body: null });
    const { status, json } = await postJson({ personaId: 'persona-1', topics: ['a', 'b'] });
    expect(status).toBe(502);
    expect(json.error).toBe('Video service returned no task IDs.');
  });

  it('sends the stored-persona batch with topic items and per-video history', async () => {
    const { status, json } = await postJson({
      personaId: 'persona-1',
      topics: ['one', 'two'],
      webhook_url: 'https://hooks.example/done',
    });
    expect(status).toBe(200);
    expect(json).toEqual({ success: true, taskIds: ['task-1', 'task-2'] });
    const payload = vi.mocked(startEngineVideoBatch).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.items).toEqual([{ topic: 'one' }, { topic: 'two' }]);
    expect(payload.face_mix_percent).toBe(80);
    expect(payload.face_quality).toBe('very_good');
    expect(payload.webhook_url).toBe('https://hooks.example/done');
    const persona = payload.persona as Record<string, unknown>;
    expect(persona).toMatchObject({
      id: 'persona-1',
      name: 'Ana',
      language: 'pt-BR',
      niche: 'fitness',
      voice_id: 'voice-1',
      photo_url: 'https://cdn.example/avatar.png',
    });
    // History: one start + one running update per video, each with its task id.
    expect(recordGenerationStart).toHaveBeenCalledTimes(2);
    const starts = vi.mocked(recordGenerationStart).mock.calls.map((call) => call[0]);
    expect(starts[0]).toMatchObject({ userId: USER_ID, personaId: 'persona-1', personaName: 'Ana', videoSubject: 'one' });
    expect(starts[1]).toMatchObject({ videoSubject: 'two' });
    const updates = vi.mocked(recordGenerationUpdate).mock.calls.map((call) => call[0]);
    expect(updates).toEqual([
      expect.objectContaining({ status: 'running', engineTaskId: 'task-1' }),
      expect.objectContaining({ status: 'running', engineTaskId: 'task-2' }),
    ]);
    // No library pick: no rotation write.
    expect(recordRecentImageId).not.toHaveBeenCalled();
  });
});

describe('POST /api/persona/video-batch debug multipart', () => {
  it('rejects image_id on debug batches', async () => {
    const form = debugForm();
    form.set('image_id', 'img-1');
    const res = await POST(multipartRequest(form));
    expect(res.status).toBe(400);
    expect((await res.json() as Record<string, unknown>).error).toBe(
      'image_id requires a saved persona: debug videos have no image library.',
    );
  });

  it('rejects conflicting image_id/imageId form fields', async () => {
    const form = debugForm();
    form.set('image_id', 'img-a');
    form.set('imageId', 'img-b');
    const res = await POST(multipartRequest(form));
    expect(res.status).toBe(400);
    expect((await res.json() as Record<string, unknown>).error).toBe(
      'Provide either image_id or imageId, not both.',
    );
  });

  it('rejects conflicting webhook_url/webhookUrl form fields', async () => {
    const form = debugForm();
    form.set('webhook_url', 'https://a.example');
    form.set('webhookUrl', 'https://b.example');
    const res = await POST(multipartRequest(form));
    expect(res.status).toBe(400);
  });

  it('rejects malformed topics JSON', async () => {
    const form = debugForm();
    form.set('topics', 'not-json[');
    const res = await POST(multipartRequest(form));
    expect(res.status).toBe(400);
  });

  it('rejects a debug batch without a voice', async () => {
    const form = debugForm();
    form.delete('voiceId');
    const res = await POST(multipartRequest(form));
    expect(res.status).toBe(400);
    expect((await res.json() as Record<string, unknown>).error).toContain('no voice configured');
  });

  it('returns 502 when the debug photo upload fails', async () => {
    vi.mocked(uploadEngineTempAsset).mockResolvedValue(undefined);
    const form = debugForm();
    form.set('photo', pngFile('photo.png'));
    const res = await POST(multipartRequest(form));
    expect(res.status).toBe(502);
    expect(startEngineVideoBatch).not.toHaveBeenCalled();
  });

  it('sends the debug batch with the temp photo URL', async () => {
    const form = debugForm();
    form.set('photo', pngFile('photo.png'));
    const res = await POST(multipartRequest(form));
    expect(res.status).toBe(200);
    const payload = vi.mocked(startEngineVideoBatch).mock.calls[0]?.[1] as Record<string, unknown>;
    const persona = payload.persona as Record<string, unknown>;
    expect(persona.photo_url).toBe('https://engine.example/temp/photo.png');
    expect(persona.voice_id).toBe('voice-debug');
    expect(payload.items).toEqual([{ topic: 'topic one' }, { topic: 'topic two' }]);
    expect(recordGenerationStart).toHaveBeenCalledTimes(2);
  });

  it('uses the avatar URL when no photo is uploaded', async () => {
    const form = debugForm({ avatarUrl: 'https://cdn.example/debug-avatar.png' });
    const res = await POST(multipartRequest(form));
    expect(res.status).toBe(200);
    const payload = vi.mocked(startEngineVideoBatch).mock.calls[0]?.[1] as Record<string, unknown>;
    expect((payload.persona as Record<string, unknown>).photo_url).toBe('https://cdn.example/debug-avatar.png');
  });
});
