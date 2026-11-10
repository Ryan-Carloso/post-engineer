// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

import {
  checkPreChargePreflights,
  checkSegmentMediaAspect,
  SEGMENT_MEDIA_ASPECT_TIMEOUT_MS,
} from '../aspect-preflight';
import { checkFullLipsyncNarration } from '../full-lipsync-preflight';
import type { PersonaPrep } from '../persona-prep';
import type { ValidatedOptions } from '../options-validation';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../full-lipsync-preflight', () => ({
  checkFullLipsyncNarration: vi.fn(),
}));

function engineBody(code: string, width?: number, height?: number): Response {
  return new Response(
    JSON.stringify({ status: 200, body: { code, width: width ?? null, height: height ?? null } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function stubFetch(responses: Array<Response | Error>): Array<{ url: string; init: RequestInit }> {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let index = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (response instanceof Error) throw response;
      // A Response body reads once: clone it so the same stubbed answer
      // can serve every sequential check.
      return response.clone();
    }),
  );
  return calls;
}

const SEGMENTS = [
  { kind: 'hook', text: 'Welcome to Porto.', media: [{ mediaId: 'aabbccddeeff00112233445566778899.jpg' }] },
  { kind: 'body', text: 'Where the river meets the sea.', media: [{ url: 'https://e.com/body.jpg' }] },
  { kind: 'cta', text: 'Visit Porto soon.', media: [{ mediaId: '00112233445566778899aabbccddeeff.jpg' }] },
];

const INPUT = {
  userId: 'user-1',
  segments: SEGMENTS,
  videoAspect: '9:16' as const,
  hasFace: false,
};

const PREP: PersonaPrep = {
  personaName: 'Porto Guide',
  faceless: false,
  faceQuality: 'ok',
  avatarUrl: null,
  photoPath: null,
  niche: null,
  ctaText: null,
  language: 'en',
  videoAspect: '9:16',
  videoLayout: null,
  paragraphNumber: null,
  photoRequired: false,
};

const OPTIONS: ValidatedOptions = {
  faceless: false,
  facelessMaterial: 'broll',
};

describe('checkSegmentMediaAspect', () => {
  beforeEach(() => {
    vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'engine-secret');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('pins the per-check timeout at 30s', () => {
    expect(SEGMENT_MEDIA_ASPECT_TIMEOUT_MS).toBe(30_000);
  });

  it('passes when there is no segment media and never calls the engine', async () => {
    const calls = stubFetch([engineBody('ok')]);
    const result = await checkSegmentMediaAspect({ ...INPUT, segments: [] });
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('passes text-only segments without an engine URL and never calls the engine', async () => {
    // The route runs this preflight for every segmented request, and
    // text-only segments never touch the engine — the env gate must not
    // 502 them (the route tests run without engine env vars).
    vi.stubEnv('MONEYPRINT_API_URL', undefined);
    vi.stubEnv('MONEYPRINT_API_SECRET', undefined);
    const calls = stubFetch([engineBody('ok')]);
    const result = await checkSegmentMediaAspect({
      ...INPUT,
      segments: [
        { kind: 'hook', text: 'Welcome to Porto.' },
        { kind: 'body', text: 'Where the river meets the sea.' },
        { kind: 'cta', text: 'Visit Porto soon.' },
      ],
    });
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('passes when every full-frame photo fits and sends media ids and urls', async () => {
    const calls = stubFetch([engineBody('ok', 1080, 1920)]);
    const result = await checkSegmentMediaAspect(INPUT);
    expect(result).toBeNull();
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe('https://engine.test/api/v1/media/check');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      media_id: 'aabbccddeeff00112233445566778899.jpg',
      video_aspect: '9:16',
    });
    expect(JSON.parse(calls[1].init.body as string)).toEqual({
      url: 'https://e.com/body.jpg',
      video_aspect: '9:16',
    });
    expect(calls[0].init.headers).toMatchObject({ 'x-user-id': 'user-1' });
  });

  it('rejects the first mismatched photo with a 400 naming segment, image and both ratios', async () => {
    stubFetch([engineBody('ok'), engineBody('wrong_aspect', 1920, 1080)]);
    const result = await checkSegmentMediaAspect(INPUT);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
    const payload = (await (result as NextResponse).json()) as { error?: string };
    expect(payload.error).toContain('Segment 1 image 0');
    expect(payload.error).toContain('1920x1080 (16:9)');
    expect(payload.error).toContain('9:16 (1080x1920)');
  });

  it('lets a non-wrong_aspect code through: the task already handles it', async () => {
    const calls = stubFetch([engineBody('media_expired'), engineBody('ok')]);
    const result = await checkSegmentMediaAspect(INPUT);
    expect(result).toBeNull();
    expect(calls).toHaveLength(3);
  });

  it('skips hook photos when the face shows, and checks the rest', async () => {
    const calls = stubFetch([engineBody('ok')]);
    const result = await checkSegmentMediaAspect({ ...INPUT, hasFace: true });
    expect(result).toBeNull();
    // Hook (segment 0) is a panel over the face: only body + CTA are checked.
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      url: 'https://e.com/body.jpg',
      video_aspect: '9:16',
    });
  });

  it('checks nothing when the face fills the whole video', async () => {
    const calls = stubFetch([engineBody('ok')]);
    const result = await checkSegmentMediaAspect({
      ...INPUT,
      hasFace: true,
      fullLipsync: true,
    });
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('fails closed with a 502 when the engine answers with an error', async () => {
    stubFetch([new Response('boom', { status: 500 })]);
    const result = await checkSegmentMediaAspect(INPUT);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(502);
  });

  it('fails closed with a 502 when the engine is unreachable', async () => {
    stubFetch([new Error('fetch failed')]);
    const result = await checkSegmentMediaAspect(INPUT);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(502);
  });

  it('fails closed with a 502 when the engine returns no code', async () => {
    stubFetch([
      new Response(JSON.stringify({ status: 200, body: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ]);
    const result = await checkSegmentMediaAspect(INPUT);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(502);
  });
});

describe('checkPreChargePreflights', () => {
  const COMBINED = {
    userId: 'user-1',
    script: 'Welcome to Porto. Where the river meets the sea. Visit Porto soon.',
    prep: PREP,
    options: OPTIONS,
    segments: SEGMENTS,
  };

  beforeEach(() => {
    vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'engine-secret');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('returns the narration failure first and never checks aspect', async () => {
    const calls = stubFetch([engineBody('ok')]);
    const failure = NextResponse.json({ success: false, error: 'Too long.' }, { status: 400 });
    vi.mocked(checkFullLipsyncNarration).mockResolvedValue(failure);
    const result = await checkPreChargePreflights({
      ...COMBINED,
      options: { ...OPTIONS, fullLipsync: true },
    });
    expect(result).toBe(failure);
    expect(checkFullLipsyncNarration).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it('checks nothing after a fitting narration: full lip-sync fills the frame', async () => {
    const calls = stubFetch([engineBody('ok', 1080, 1920)]);
    vi.mocked(checkFullLipsyncNarration).mockResolvedValue(45);
    const result = await checkPreChargePreflights({
      ...COMBINED,
      options: { ...OPTIONS, fullLipsync: true },
    });
    expect(result).toBeNull();
    expect(checkFullLipsyncNarration).toHaveBeenCalledTimes(1);
    // A full lip-sync face fills the whole video, so no photo is gated.
    expect(calls).toHaveLength(0);
  });

  it('skips the narration check when full lip-sync is off', async () => {
    const calls = stubFetch([engineBody('ok', 1080, 1920)]);
    vi.mocked(checkFullLipsyncNarration).mockResolvedValue(45);
    const result = await checkPreChargePreflights(COMBINED);
    expect(result).toBeNull();
    expect(checkFullLipsyncNarration).not.toHaveBeenCalled();
    expect(calls).toHaveLength(3);
  });

  it('returns null with no engine calls for text-only segments and no lip-sync', async () => {
    const calls = stubFetch([engineBody('ok')]);
    vi.mocked(checkFullLipsyncNarration).mockResolvedValue(45);
    const result = await checkPreChargePreflights({
      ...COMBINED,
      segments: [
        { kind: 'hook', text: 'Welcome to Porto.' },
        { kind: 'body', text: 'Where the river meets the sea.' },
        { kind: 'cta', text: 'Visit Porto soon.' },
      ],
    });
    expect(result).toBeNull();
    expect(checkFullLipsyncNarration).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});
