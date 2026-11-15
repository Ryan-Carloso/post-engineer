// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

import {
  checkFirstPhotoFace,
  checkPreChargePreflights,
  checkSegmentMediaAspect,
  MEDIA_CHECK_TIMEOUT_MS,
} from '../aspect-preflight';
import { checkFullLipsyncNarration } from '../full-lipsync-preflight';
import { logger } from '@/lib/logger';
import type { PersonaPrep } from '../persona-prep';
import type { ValidatedOptions } from '../options-validation';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../full-lipsync-preflight', () => ({
  checkFullLipsyncNarration: vi.fn(),
}));

function engineBody(code: string, width?: number, height?: number, hasFace?: boolean): Response {
  return new Response(
    JSON.stringify({
      status: 200,
      body: { code, width: width ?? null, height: height ?? null, has_face: hasFace ?? null },
    }),
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
  { kind: 'content', text: 'Where the river meets the sea.', media: [{ url: 'https://e.com/body.jpg' }] },
  { kind: 'content', text: 'Visit Porto soon.', media: [{ mediaId: '00112233445566778899aabbccddeeff.jpg' }] },
];

const INPUT = {
  userId: 'user-1',
  segments: SEGMENTS,
  videoAspect: '9:16' as const,
  hasFace: false,
  videoType: 'hook_lipsync' as const,
  avatarUrl: null as string | null,
  libraryPhotoUrl: null as string | null,
  photoPathUrl: null as string | null,
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
  videoType: 'hook_lipsync',
};

describe('checkSegmentMediaAspect', () => {
  beforeEach(() => {
    vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'engine-secret');
    vi.mocked(logger.error).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('pins the per-check timeout at 30s', () => {
    expect(MEDIA_CHECK_TIMEOUT_MS).toBe(30_000);
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
        { kind: 'content', text: 'Where the river meets the sea.' },
        { kind: 'content', text: 'Visit Porto soon.' },
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
    // Hook (segment 0) is a panel over the face: only content takes are checked.
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
      videoType: 'full_lipsync',
    });
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('posts exact JSON to the media/check URL, stripping trailing slashes from the engine URL', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test//');
    const calls = stubFetch([engineBody('ok', 1080, 1920)]);
    const result = await checkSegmentMediaAspect(INPUT);
    expect(result).toBeNull();
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe('https://engine.test/api/v1/media/check');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-user-id': 'user-1',
    });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      media_id: 'aabbccddeeff00112233445566778899.jpg',
      video_aspect: '9:16',
    });
  });

  it('fails closed with a 502 when only the engine URL is missing, never calling the engine', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', undefined);
    const calls = stubFetch([engineBody('ok')]);
    const result = await checkSegmentMediaAspect(INPUT);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(502);
    const payload = (await (result as NextResponse).json()) as { error?: string; code?: string };
    expect(payload.error).toBe('Video service is unavailable.');
    expect(payload.code).toBe('INTERNAL_ERROR');
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      '[segment-media-aspect] engine URL or secret is not defined',
    );
    expect(calls).toHaveLength(0);
  });

  it('fails closed with a 502 when only the engine secret is missing, never calling the engine', async () => {
    vi.stubEnv('MONEYPRINT_API_SECRET', undefined);
    const calls = stubFetch([engineBody('ok')]);
    const result = await checkSegmentMediaAspect(INPUT);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(502);
    const payload = (await (result as NextResponse).json()) as { error?: string; code?: string };
    expect(payload.error).toBe('Video service is unavailable.');
    expect(payload.code).toBe('INTERNAL_ERROR');
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      '[segment-media-aspect] engine URL or secret is not defined',
    );
    expect(calls).toHaveLength(0);
  });

  it('aborts the engine call after the 30s timeout and fails closed', async () => {
    vi.useFakeTimers();
    try {
      const calls: Array<{ url: string; init: RequestInit }> = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init: RequestInit) => {
          calls.push({ url, init });
          await new Promise<never>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          });
        }),
      );
      const resultPromise = checkSegmentMediaAspect(INPUT);
      await vi.advanceTimersByTimeAsync(MEDIA_CHECK_TIMEOUT_MS);
      const result = await resultPromise;
      expect(result).toBeInstanceOf(NextResponse);
      expect((result as NextResponse).status).toBe(502);
      const payload = (await (result as NextResponse).json()) as { error?: string };
      expect(payload.error).toBe('Video service is unavailable.');
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        '[segment-media-aspect] engine unreachable',
        expect.anything(),
      );
      expect(calls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed with a 502 when the engine answers with an error', async () => {
    stubFetch([new Response('boom', { status: 500 })]);
    const result = await checkSegmentMediaAspect(INPUT);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(502);
    const payload = (await (result as NextResponse).json()) as { error?: string; code?: string };
    expect(payload.error).toBe('Video service is unavailable.');
    expect(payload.code).toBe('INTERNAL_ERROR');
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      '[segment-media-aspect] engine check failed',
      undefined,
      { status: 500 },
    );
  });

  it('fails closed with a 502 when the engine is unreachable', async () => {
    stubFetch([new Error('fetch failed')]);
    const result = await checkSegmentMediaAspect(INPUT);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(502);
    const payload = (await (result as NextResponse).json()) as { error?: string; code?: string };
    expect(payload.error).toBe('Video service is unavailable.');
    expect(payload.code).toBe('INTERNAL_ERROR');
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      '[segment-media-aspect] engine unreachable',
      expect.any(Error),
    );
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
    const payload = (await (result as NextResponse).json()) as { error?: string; code?: string };
    expect(payload.error).toBe('Video service is unavailable.');
    expect(payload.code).toBe('INTERNAL_ERROR');
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      '[segment-media-aspect] engine check returned no code',
    );
  });

  it('fails closed with a 502 when the engine answers non-JSON', async () => {
    stubFetch([new Response('not json', { status: 200 })]);
    const result = await checkSegmentMediaAspect(INPUT);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(502);
    const payload = (await (result as NextResponse).json()) as { error?: string; code?: string };
    expect(payload.error).toBe('Video service is unavailable.');
    expect(payload.code).toBe('INTERNAL_ERROR');
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      '[segment-media-aspect] engine check returned no code',
    );
  });
});

describe('checkFirstPhotoFace', () => {
  beforeEach(() => {
    vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'engine-secret');
    vi.mocked(logger.error).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('passes faceless videos without an engine call: no face shows', async () => {
    const calls = stubFetch([engineBody('ok', 1080, 1920, true)]);
    const result = await checkFirstPhotoFace({ ...INPUT, videoType: 'faceless' });
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('passes when there is no first photo and never calls the engine', async () => {
    const calls = stubFetch([engineBody('ok', 1080, 1920, true)]);
    const result = await checkFirstPhotoFace({ ...INPUT, segments: [] });
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('checks the persona avatar when no segment carries a photo', async () => {
    const calls = stubFetch([engineBody('ok', 1080, 1920, true)]);
    const result = await checkFirstPhotoFace({
      ...INPUT,
      segments: [],
      avatarUrl: 'https://e.com/avatar.jpg',
    });
    expect(result).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://engine.test/api/v1/media/check');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      url: 'https://e.com/avatar.jpg',
      video_aspect: '9:16',
    });
  });

  it('rejects a faceless persona avatar with a 400 naming the persona photo', async () => {
    stubFetch([engineBody('ok', 1080, 1920, false)]);
    const result = await checkFirstPhotoFace({
      ...INPUT,
      segments: [],
      avatarUrl: 'https://e.com/avatar.jpg',
    });
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
    const payload = (await (result as NextResponse).json()) as {
      error?: string;
      code?: string;
      field?: string;
    };
    expect(payload.error).toContain('The persona photo has no detectable face');
    expect(payload.code).toBe('VALIDATION_FAILED');
    expect(payload.field).toBe('personaId');
  });

  it('passes a data-URI avatar without an engine call: media/check cannot fetch it', async () => {
    const calls = stubFetch([engineBody('ok', 1080, 1920, true)]);
    const result = await checkFirstPhotoFace({
      ...INPUT,
      segments: [],
      avatarUrl: 'data:image/png;base64,iVBORw0KGgo=',
    });
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('passes a relative-asset avatar without an engine call: media/check needs an absolute URL', async () => {
    const calls = stubFetch([engineBody('ok', 1080, 1920, true)]);
    const result = await checkFirstPhotoFace({
      ...INPUT,
      segments: [],
      avatarUrl: '/caracter-samples/file-1.png',
    });
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('fails closed with a 502 when the avatar check cannot reach the engine', async () => {
    stubFetch([new Error('fetch failed')]);
    const result = await checkFirstPhotoFace({
      ...INPUT,
      segments: [],
      avatarUrl: 'https://e.com/avatar.jpg',
    });
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(502);
  });

  it('passes when the first photo has a face and sends the media id', async () => {
    const calls = stubFetch([engineBody('ok', 1080, 1920, true)]);
    const result = await checkFirstPhotoFace(INPUT);
    expect(result).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://engine.test/api/v1/media/check');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      media_id: 'aabbccddeeff00112233445566778899.jpg',
      video_aspect: '9:16',
    });
  });

  it('passes when has_face is missing: an older engine is not a failure', async () => {
    const calls = stubFetch([
      new Response(JSON.stringify({ status: 200, body: { code: 'ok' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ]);
    const result = await checkFirstPhotoFace(INPUT);
    expect(result).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('rejects a faceless first photo with a 400 naming segment and image', async () => {
    stubFetch([engineBody('ok', 1080, 1920, false)]);
    const result = await checkFirstPhotoFace(INPUT);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
    const payload = (await (result as NextResponse).json()) as {
      error?: string;
      code?: string;
      field?: string;
    };
    expect(payload.error).toContain('Segment 0 image 0');
    expect(payload.error).toContain('no face was detected');
    expect(payload.code).toBe('VALIDATION_FAILED');
    expect(payload.field).toBe('options.segments');
  });

  it.each([
    ['not_image', 'is not a readable image'],
    ['too_small', 'is too small'],
    ['too_large', 'is too large'],
  ])(
    'rejects a mechanically rejected first photo with a 400 naming the real reason (%s)',
    async (code, reason) => {
      // The engine reports has_face null for a rejected file (its verdict
      // is meaningless), so the code — not the face — must block the
      // charge, with the real reason instead of "no face was detected".
      stubFetch([engineBody(code, 1080, 1920)]);
      const result = await checkFirstPhotoFace(INPUT);
      expect(result).toBeInstanceOf(NextResponse);
      expect((result as NextResponse).status).toBe(400);
      const payload = (await (result as NextResponse).json()) as {
        error?: string;
        code?: string;
        field?: string;
      };
      expect(payload.error).toContain('Segment 0 image 0');
      expect(payload.error).toContain(reason);
      expect(payload.error).not.toContain('no face was detected');
      expect(payload.code).toBe('VALIDATION_FAILED');
      expect(payload.field).toBe('options.segments');
    },
  );

  it.each(['blocked_403', 'timeout', 'media_expired'])(
    'rejects an unloadable first photo with a 400 naming the code (%s)',
    async (code) => {
      // The engine gate fails the task on any resolve_first_segment_photo
      // reason except no_segment_media, so a blocked, timed-out, or
      // expired first photo must block the charge too — otherwise the
      // route charges and the engine fails the task and refunds it.
      stubFetch([engineBody(code)]);
      const result = await checkFirstPhotoFace(INPUT);
      expect(result).toBeInstanceOf(NextResponse);
      expect((result as NextResponse).status).toBe(400);
      const payload = (await (result as NextResponse).json()) as {
        error?: string;
        code?: string;
        field?: string;
      };
      expect(payload.error).toContain('Segment 0 image 0');
      expect(payload.error).toContain(`could not be loaded (${code})`);
      expect(payload.code).toBe('VALIDATION_FAILED');
      expect(payload.field).toBe('options.segments');
    },
  );

  it('rejects a mechanically rejected persona avatar with a 400 naming the real reason', async () => {
    stubFetch([engineBody('not_image')]);
    const result = await checkFirstPhotoFace({
      ...INPUT,
      segments: [],
      avatarUrl: 'https://e.com/avatar.jpg',
    });
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
    const payload = (await (result as NextResponse).json()) as {
      error?: string;
      code?: string;
      field?: string;
    };
    expect(payload.error).toContain('The persona photo is not a readable image');
    expect(payload.code).toBe('VALIDATION_FAILED');
    expect(payload.field).toBe('personaId');
  });

  it.each(['too_small', 'too_large'])(
    'passes a %s persona avatar: the engine applies no size bounds to the fallback',
    async (code) => {
      // The engine's persona fallback enforces only the 20 MB SSRF
      // download cap and image/* — a small or over-cap avatar still
      // renders, so the pre-charge check must not be stricter than the
      // gate it mirrors. Only an unreadable file stays a 400.
      stubFetch([engineBody(code)]);
      const result = await checkFirstPhotoFace({
        ...INPUT,
        segments: [],
        avatarUrl: 'https://e.com/avatar.jpg',
      });
      expect(result).toBeNull();
    },
  );

  it.each(['too_small', 'too_large'])(
    'passes a %s picked library photo: the engine applies no size bounds to the fallback',
    async (code) => {
      stubFetch([engineBody(code)]);
      const result = await checkFirstPhotoFace({
        ...INPUT,
        segments: [],
        avatarUrl: 'https://e.com/avatar.jpg',
        libraryPhotoUrl: 'https://cdn.example/signed-library.jpg',
      });
      expect(result).toBeNull();
    },
  );

  it('checks the stored persona photo when the avatar is null and a photo path was signed', async () => {
    // Uploaded/https personas store photo_path with avatar_url null, and
    // dispatch signs photoPath as the persona fallback: a faceless stored
    // photo must block the charge here, not after it in the engine.
    const calls = stubFetch([engineBody('ok', 1080, 1920, false)]);
    const result = await checkFirstPhotoFace({
      ...INPUT,
      segments: [],
      avatarUrl: null,
      photoPathUrl: 'https://cdn.example/signed-photo.jpg',
    });
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
    const payload = (await (result as NextResponse).json()) as {
      error?: string;
      code?: string;
      field?: string;
    };
    expect(payload.error).toContain('The persona photo has no detectable face');
    expect(payload.code).toBe('VALIDATION_FAILED');
    expect(payload.field).toBe('personaId');
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      url: 'https://cdn.example/signed-photo.jpg',
      video_aspect: '9:16',
    });
  });

  it('passes when the stored persona photo has a face', async () => {
    stubFetch([engineBody('ok', 1080, 1920, true)]);
    const result = await checkFirstPhotoFace({
      ...INPUT,
      segments: [],
      avatarUrl: null,
      photoPathUrl: 'https://cdn.example/signed-photo.jpg',
    });
    expect(result).toBeNull();
  });

  it('checks the avatar, not the stored photo, when an avatar URL is set', async () => {
    // Dispatch prefers the hosted avatar over the signed photo path, so
    // the pre-charge check must validate the same file.
    const calls = stubFetch([engineBody('ok', 1080, 1920, true)]);
    const result = await checkFirstPhotoFace({
      ...INPUT,
      segments: [],
      avatarUrl: 'https://e.com/avatar.jpg',
      photoPathUrl: 'https://cdn.example/signed-photo.jpg',
    });
    expect(result).toBeNull();
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      url: 'https://e.com/avatar.jpg',
      video_aspect: '9:16',
    });
  });
  it('checks the picked library photo, not the stored avatar, when one was picked', async () => {
    // The engine's persona fallback is the library image dispatch will
    // sign: a faceless stored avatar must not block a faced library
    // photo, and a faced avatar must not wave through a faceless one.
    const calls = stubFetch([engineBody('ok', 1080, 1920, false)]);
    const result = await checkFirstPhotoFace({
      ...INPUT,
      segments: [],
      avatarUrl: 'https://e.com/avatar.jpg',
      libraryPhotoUrl: 'https://cdn.example/signed-library.jpg',
    });
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
    const payload = (await (result as NextResponse).json()) as {
      error?: string;
      code?: string;
      field?: string;
    };
    expect(payload.error).toContain('The photo selected for this video has no detectable face');
    expect(payload.code).toBe('VALIDATION_FAILED');
    expect(payload.field).toBe('personaId');
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      url: 'https://cdn.example/signed-library.jpg',
      video_aspect: '9:16',
    });
  });

  it('passes when the picked library photo has a face even if the stored avatar does not', async () => {
    // The stored avatar is never the hook image when a library photo was
    // picked, so its face is irrelevant here.
    const calls = stubFetch([engineBody('ok', 1080, 1920, true)]);
    const result = await checkFirstPhotoFace({
      ...INPUT,
      segments: [],
      avatarUrl: 'https://e.com/avatar.jpg',
      libraryPhotoUrl: 'https://cdn.example/signed-library.jpg',
    });
    expect(result).toBeNull();
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      url: 'https://cdn.example/signed-library.jpg',
      video_aspect: '9:16',
    });
  });

  it('fails closed with a 502 when the engine is unreachable', async () => {
    stubFetch([new Error('fetch failed')]);
    const result = await checkFirstPhotoFace(INPUT);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(502);
    const payload = (await (result as NextResponse).json()) as { error?: string; code?: string };
    expect(payload.error).toBe('Video service is unavailable.');
    expect(payload.code).toBe('INTERNAL_ERROR');
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      '[first-photo-face] engine unreachable',
      expect.any(Error),
    );
  });

  it('fails closed with a 502 when the engine returns no code', async () => {
    stubFetch([
      new Response(JSON.stringify({ status: 200, body: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ]);
    const result = await checkFirstPhotoFace(INPUT);
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
    libraryPhotoUrl: null as string | null,
    photoPathUrl: null as string | null,
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
      options: { ...OPTIONS, videoType: 'full_lipsync' },
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
      options: { ...OPTIONS, videoType: 'full_lipsync' },
    });
    expect(result).toBeNull();
    expect(checkFullLipsyncNarration).toHaveBeenCalledTimes(1);
    // A full lip-sync face fills the whole video, so no photo is aspect-
    // gated; the single call is the first-photo face check.
    expect(calls).toHaveLength(1);
  });

  it('skips the narration check when full lip-sync is off', async () => {
    const calls = stubFetch([engineBody('ok', 1080, 1920)]);
    vi.mocked(checkFullLipsyncNarration).mockResolvedValue(45);
    const result = await checkPreChargePreflights(COMBINED);
    expect(result).toBeNull();
    expect(checkFullLipsyncNarration).not.toHaveBeenCalled();
    // Three aspect checks plus the first-photo face check.
    expect(calls).toHaveLength(4);
  });

  it('returns null with no engine calls for text-only segments and no lip-sync', async () => {
    const calls = stubFetch([engineBody('ok')]);
    vi.mocked(checkFullLipsyncNarration).mockResolvedValue(45);
    const result = await checkPreChargePreflights({
      ...COMBINED,
      segments: [
        { kind: 'hook', text: 'Welcome to Porto.' },
        { kind: 'content', text: 'Where the river meets the sea.' },
        { kind: 'content', text: 'Visit Porto soon.' },
      ],
    });
    expect(result).toBeNull();
    expect(checkFullLipsyncNarration).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('returns the faceless-first-photo failure after the aspect check passes', async () => {
    const calls = stubFetch([
      engineBody('ok', 1080, 1920),
      engineBody('ok', 1080, 1920, false),
    ]);
    vi.mocked(checkFullLipsyncNarration).mockResolvedValue(45);
    const result = await checkPreChargePreflights(COMBINED);
    expect(result).not.toBeNull();
    expect(result?.status).toBe(400);
    const payload = (await result?.json()) as { error?: string };
    expect(payload.error).toContain('Segment 0 image 0');
    expect(payload.error).toContain('no face was detected');
    expect(checkFullLipsyncNarration).not.toHaveBeenCalled();
    // Three aspect checks plus the first-photo face check.
    expect(calls).toHaveLength(4);
  });

  it('fails fast with a 400 when the persona stores an unknown aspect, never silently checks as portrait', async () => {
    const calls = stubFetch([engineBody('ok', 1080, 1920)]);
    vi.mocked(checkFullLipsyncNarration).mockResolvedValue(45);
    const result = await checkPreChargePreflights({
      ...COMBINED,
      prep: { ...PREP, videoAspect: '4:3' },
    });
    expect(result).not.toBeNull();
    expect(result?.status).toBe(400);
    const payload = (await result?.json()) as Record<string, unknown>;
    expect(payload.code).toBe('VALIDATION_FAILED');
    expect(payload.field).toBe('personaId');
    expect(calls).toHaveLength(0);
  });

  it('checks landscape photos against 16:9 when the persona stores it', async () => {
    const calls = stubFetch([engineBody('ok', 1080, 1920)]);
    vi.mocked(checkFullLipsyncNarration).mockResolvedValue(45);
    const result = await checkPreChargePreflights({
      ...COMBINED,
      prep: { ...PREP, videoAspect: '16:9' },
    });
    expect(result).toBeNull();
    // Three aspect checks plus the first-photo face check, all against 16:9.
    expect(calls).toHaveLength(4);
    expect(
      calls.every(
        (call) => (JSON.parse(call.init.body as string) as { video_aspect?: string }).video_aspect === '16:9',
      ),
    ).toBe(true);
  });

  it('checks square photos against 1:1 when the persona stores it', async () => {
    const calls = stubFetch([engineBody('ok', 1080, 1920)]);
    vi.mocked(checkFullLipsyncNarration).mockResolvedValue(45);
    const result = await checkPreChargePreflights({
      ...COMBINED,
      prep: { ...PREP, videoAspect: '1:1' },
    });
    expect(result).toBeNull();
    expect(calls).toHaveLength(4);
    expect(
      calls.every(
        (call) => (JSON.parse(call.init.body as string) as { video_aspect?: string }).video_aspect === '1:1',
      ),
    ).toBe(true);
  });

  it('skips the hook photo in the aspect check when the persona has a face photo', async () => {
    const calls = stubFetch([engineBody('ok', 1080, 1920)]);
    vi.mocked(checkFullLipsyncNarration).mockResolvedValue(45);
    const result = await checkPreChargePreflights({
      ...COMBINED,
      prep: { ...PREP, photoPath: '/tmp/persona.jpg' },
    });
    expect(result).toBeNull();
    expect(checkFullLipsyncNarration).not.toHaveBeenCalled();
    // The hook photo is a panel over the face: only the two content photos
    // are aspect-checked, plus the first-photo face check.
    expect(calls).toHaveLength(3);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      url: 'https://e.com/body.jpg',
      video_aspect: '9:16',
    });
  });

  it('checks the hook photo in the aspect check when the persona has no face photo', async () => {
    const calls = stubFetch([
      engineBody('wrong_aspect', 1920, 1080),
      engineBody('ok', 1080, 1920),
    ]);
    vi.mocked(checkFullLipsyncNarration).mockResolvedValue(45);
    const result = await checkPreChargePreflights(COMBINED);
    expect(result).not.toBeNull();
    expect(result?.status).toBe(400);
    const payload = (await result?.json()) as { error?: string };
    expect(payload.error).toContain('Segment 0 image 0');
    expect(calls).toHaveLength(1);
  });

  it('checks the hook photo in the aspect check for faceless videos even with a persona photo', async () => {
    const calls = stubFetch([
      engineBody('wrong_aspect', 1920, 1080),
      engineBody('ok', 1080, 1920),
    ]);
    vi.mocked(checkFullLipsyncNarration).mockResolvedValue(45);
    const result = await checkPreChargePreflights({
      ...COMBINED,
      options: { ...OPTIONS, videoType: 'faceless' },
      prep: { ...PREP, photoPath: '/tmp/persona.jpg' },
    });
    expect(result).not.toBeNull();
    expect(result?.status).toBe(400);
    const payload = (await result?.json()) as { error?: string };
    expect(payload.error).toContain('Segment 0 image 0');
    expect(calls).toHaveLength(1);
  });

  it('returns the aspect failure without running the face check', async () => {
    const calls = stubFetch([
      engineBody('wrong_aspect', 1920, 1080),
      engineBody('ok', 1080, 1920),
    ]);
    vi.mocked(checkFullLipsyncNarration).mockResolvedValue(45);
    const result = await checkPreChargePreflights(COMBINED);
    expect(result).not.toBeNull();
    expect(result?.status).toBe(400);
    const payload = (await result?.json()) as { error?: string };
    expect(payload.error).toContain('Segment 0 image 0');
    expect(payload.error).toContain('1920x1080 (16:9)');
    expect(checkFullLipsyncNarration).not.toHaveBeenCalled();
    // The aspect failure short-circuits: the first-photo face check never runs.
    expect(calls).toHaveLength(1);
  });

  it('checks the persona avatar for full lip-sync text-only segments', async () => {
    const calls = stubFetch([engineBody('ok', 1080, 1920, false)]);
    vi.mocked(checkFullLipsyncNarration).mockResolvedValue(45);
    const result = await checkPreChargePreflights({
      ...COMBINED,
      options: { ...OPTIONS, videoType: 'full_lipsync' },
      prep: { ...PREP, avatarUrl: 'https://e.com/avatar.jpg' },
      segments: [
        { kind: 'hook', text: 'Welcome to Porto.' },
        { kind: 'content', text: 'Where the river meets the sea.' },
      ],
    });
    expect(result).not.toBeNull();
    expect(result?.status).toBe(400);
    const payload = (await result?.json()) as { error?: string; field?: string };
    expect(payload.error).toContain('The persona photo has no detectable face');
    expect(payload.field).toBe('personaId');
    expect(checkFullLipsyncNarration).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });

  it('passes text-only segments with no avatar through to the engine backstop', async () => {
    const calls = stubFetch([engineBody('ok')]);
    vi.mocked(checkFullLipsyncNarration).mockResolvedValue(45);
    const result = await checkPreChargePreflights({
      ...COMBINED,
      options: { ...OPTIONS, videoType: 'full_lipsync' },
      segments: [
        { kind: 'hook', text: 'Welcome to Porto.' },
        { kind: 'content', text: 'Where the river meets the sea.' },
      ],
    });
    expect(result).toBeNull();
    expect(checkFullLipsyncNarration).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });
});
