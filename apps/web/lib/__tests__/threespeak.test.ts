// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { Memo, PrivateKey } from '@hiveio/dhive';
import {
  loginToThreespeak,
  parseMp4DurationSeconds,
  tusUploadVideo,
  registerThreespeakVideo,
  updateThreespeakVideoInfo,
  publishThreespeakVideo,
  extractHashtags,
  threespeakWatchUrl,
  THREESPEAK_TUS_ENDPOINT,
} from '@/lib/threespeak';

const POSTING_KEY = PrivateKey.fromSeed('threespeak-test-seed');
const POSTING_PUBLIC_KEY = POSTING_KEY.createPublic();

function memoFor(token: string): string {
  return Memo.encode(POSTING_KEY, POSTING_PUBLIC_KEY, `#${token}`);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockFetch(calls: Array<(url: string, init?: RequestInit) => Response>): typeof fetch {
  const queue = [...calls];
  return (async (url: string, init?: RequestInit) => {
    const next = queue.shift();
    if (next === undefined) throw new Error(`unexpected fetch: ${url}`);
    return next(url, init);
  }) as typeof fetch;
}

function mp4Buffer(timescale: number, duration: number, version = 0): Buffer {
  // Minimal MP4: ftyp box + moov box holding one mvhd box.
  const ftyp = Buffer.alloc(24);
  ftyp.writeUInt32BE(24, 0);
  ftyp.write('ftyp', 4, 'latin1');
  ftyp.write('isom', 8, 'latin1');
  const mvhdSize = version === 0 ? 32 : 44;
  const mvhd = Buffer.alloc(mvhdSize);
  mvhd.writeUInt32BE(mvhdSize, 0);
  mvhd.write('mvhd', 4, 'latin1');
  mvhd.writeUInt8(version, 8);
  if (version === 0) {
    mvhd.writeUInt32BE(timescale, 12 + 8);
    mvhd.writeUInt32BE(duration, 16 + 8);
  } else {
    mvhd.writeUInt32BE(timescale, 20 + 8);
    mvhd.writeBigUInt64BE(BigInt(duration), 24 + 8);
  }
  const moovSize = 8 + mvhdSize;
  const moov = Buffer.alloc(moovSize);
  moov.writeUInt32BE(moovSize, 0);
  moov.write('moov', 4, 'latin1');
  mvhd.copy(moov, 8);
  return Buffer.concat([ftyp, moov]);
}

describe('loginToThreespeak', () => {
  it('decrypts the Studio login memo with the posting key and strips the leading #', async () => {
    const fetchFn = mockFetch([(url) => {
      expect(url).toBe('https://studio.3speak.tv/mobile/login?username=alice');
      return jsonResponse({ memo: memoFor('jwt-access-token') });
    }]);
    const session = await loginToThreespeak('Alice', POSTING_KEY.toString(), fetchFn);
    expect(session).toEqual({ username: 'alice', accessToken: 'jwt-access-token' });
  });

  it('rejects a malformed posting key without calling Studio', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    await expect(loginToThreespeak('alice', 'not-a-wif', fetchFn)).rejects.toMatchObject({
      name: 'ThreespeakError',
      code: 'invalid_credentials',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects a malformed Hive username without calling Studio', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    await expect(loginToThreespeak('Alice!', POSTING_KEY.toString(), fetchFn)).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('maps an unknown username (404) to invalid_credentials', async () => {
    const fetchFn = mockFetch([() => new Response('not found', { status: 404 })]);
    await expect(loginToThreespeak('alice', POSTING_KEY.toString(), fetchFn)).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
  });

  it('maps a Studio 500 to login_failed', async () => {
    const fetchFn = mockFetch([() => new Response('boom', { status: 500 })]);
    await expect(loginToThreespeak('alice', POSTING_KEY.toString(), fetchFn)).rejects.toMatchObject({
      code: 'login_failed',
    });
  });

  it('maps a memo the key cannot decrypt to invalid_credentials', async () => {
    const otherKey = PrivateKey.fromSeed('someone-else');
    const fetchFn = mockFetch([() => jsonResponse({ memo: Memo.encode(otherKey, otherKey.createPublic(), '#jwt') })]);
    await expect(loginToThreespeak('alice', POSTING_KEY.toString(), fetchFn)).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
  });
});

describe('parseMp4DurationSeconds', () => {
  it('reads timescale/duration from a version-0 mvhd box', () => {
    expect(parseMp4DurationSeconds(mp4Buffer(1000, 45000))).toBe(45);
  });

  it('reads timescale/duration from a version-1 mvhd box', () => {
    expect(parseMp4DurationSeconds(mp4Buffer(90000, 180000, 1))).toBe(2);
  });

  it('returns null when there is no moov box', () => {
    expect(parseMp4DurationSeconds(Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]))).toBeNull();
  });

  it('returns null for a zero timescale', () => {
    expect(parseMp4DurationSeconds(mp4Buffer(0, 45000))).toBeNull();
  });
});

describe('tusUploadVideo', () => {
  it('creates the upload, PATCHes the bytes, and returns the id after the endpoint', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = mockFetch([
      (url, init) => {
        seen.push({ url, init });
        return new Response(null, { status: 201, headers: { Location: `${THREESPEAK_TUS_ENDPOINT}abc123` } });
      },
      (url, init) => {
        seen.push({ url, init });
        return new Response(null, { status: 204, headers: { 'Upload-Offset': '11' } });
      },
    ]);
    const video = Buffer.from('hello world');
    const videoUrl = await tusUploadVideo(video, 'clip.mp4', 'video/mp4', fetchFn);
    expect(videoUrl).toBe('abc123');
    const createHeaders = new Headers(seen[0].init?.headers);
    expect(createHeaders.get('Tus-Resumable')).toBe('1.0.0');
    expect(createHeaders.get('Upload-Length')).toBe('11');
    const metadata = createHeaders.get('Upload-Metadata') ?? '';
    expect(Buffer.from(metadata.split(' ')[1], 'base64').toString()).toBe('clip.mp4');
    expect(seen[1].url).toBe(`${THREESPEAK_TUS_ENDPOINT}abc123`);
    expect(new Headers(seen[1].init?.headers).get('Upload-Offset')).toBe('0');
  });

  it('uploads in 5MB chunks', async () => {
    let patchCalls = 0;
    const fetchFn = mockFetch([
      () => new Response(null, { status: 201, headers: { Location: `${THREESPEAK_TUS_ENDPOINT}big` } }),
      () => {
        patchCalls += 1;
        return new Response(null, { status: 204, headers: { 'Upload-Offset': String(patchCalls * 5 * 1024 * 1024) } });
      },
      () => {
        patchCalls += 1;
        return new Response(null, { status: 204, headers: { 'Upload-Offset': String(patchCalls * 5 * 1024 * 1024) } });
      },
      () => {
        patchCalls += 1;
        return new Response(null, { status: 204, headers: { 'Upload-Offset': String(12 * 1024 * 1024) } });
      },
    ]);
    await tusUploadVideo(Buffer.alloc(12 * 1024 * 1024), 'big.mp4', 'video/mp4', fetchFn);
    expect(patchCalls).toBe(3);
  });

  it('resumes from the server offset after a failed PATCH', async () => {
    const offsets: string[] = [];
    let patchAttempts = 0;
    const fetchFn = mockFetch([
      () => new Response(null, { status: 201, headers: { Location: `${THREESPEAK_TUS_ENDPOINT}res` } }),
      (_url, init) => {
        patchAttempts += 1;
        offsets.push(new Headers(init?.headers).get('Upload-Offset') ?? '');
        if (patchAttempts === 1) throw new Error('connection reset');
        return new Response(null, { status: 204, headers: { 'Upload-Offset': '11' } });
      },
      () => new Response(null, { status: 200, headers: { 'Upload-Offset': '5' } }),
      (_url, init) => {
        offsets.push(new Headers(init?.headers).get('Upload-Offset') ?? '');
        return new Response(null, { status: 204, headers: { 'Upload-Offset': '11' } });
      },
    ]);
    const videoUrl = await tusUploadVideo(Buffer.from('hello world'), 'clip.mp4', 'video/mp4', fetchFn);
    expect(videoUrl).toBe('res');
    expect(offsets).toEqual(['0', '5']);
  });

  it('throws upload_failed when creation is rejected', async () => {
    const fetchFn = mockFetch([() => new Response('nope', { status: 403 })]);
    await expect(tusUploadVideo(Buffer.from('x'), 'clip.mp4', 'video/mp4', fetchFn)).rejects.toMatchObject({
      name: 'ThreespeakError',
      code: 'upload_failed',
    });
  });
});

describe('registerThreespeakVideo', () => {
  it('posts upload_info with the Bearer token and returns the video id', async () => {
    let body: Record<string, unknown> = {};
    const fetchFn = mockFetch([
      (url, init) => {
        expect(url).toBe('https://studio.3speak.tv/mobile/api/upload_info');
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer jwt-1');
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ _id: 'video-1', thumbnail: 'https://img.example/t.jpg' });
      },
    ]);
    const result = await registerThreespeakVideo(
      'jwt-1',
      { videoUrl: 'abc123', oFilename: 'clip.mp4', size: 11, duration: 45, thumbnail: '', owner: 'alice', isReel: false },
      fetchFn,
    );
    expect(result).toEqual({ videoId: 'video-1', thumbnail: 'https://img.example/t.jpg' });
    expect(body).toMatchObject({ filename: 'abc123', oFilename: 'clip.mp4', size: 11, duration: 45, owner: 'alice', isReel: false });
  });

  it('throws register_failed on a non-2xx response or a missing _id', async () => {
    const fetchFn = mockFetch([() => new Response('nope', { status: 401 })]);
    await expect(
      registerThreespeakVideo('jwt-1', { videoUrl: 'x', oFilename: 'c.mp4', size: 1, duration: 0, thumbnail: '', owner: 'alice', isReel: false }, fetchFn),
    ).rejects.toMatchObject({ code: 'register_failed' });
    const noId = mockFetch([() => jsonResponse({})]);
    await expect(
      registerThreespeakVideo('jwt-1', { videoUrl: 'x', oFilename: 'c.mp4', size: 1, duration: 0, thumbnail: '', owner: 'alice', isReel: false }, noId),
    ).rejects.toMatchObject({ code: 'register_failed' });
  });
});

describe('updateThreespeakVideoInfo', () => {
  it('posts update_info and returns the permlink when present', async () => {
    let body: Record<string, unknown> = {};
    const fetchFn = mockFetch([
      (url, init) => {
        expect(url).toBe('https://studio.3speak.tv/mobile/api/update_info');
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ permlink: 'my-video' });
      },
    ]);
    const result = await updateThreespeakVideoInfo(
      'jwt-1',
      { videoId: 'video-1', title: 'Hello', description: 'Hello #hive', tags: ['threespeak', 'hive'], thumbnail: '' },
      fetchFn,
    );
    expect(result).toEqual({ permlink: 'my-video' });
    expect(body).toMatchObject({ videoId: 'video-1', title: 'Hello', tags: 'threespeak,hive', communityID: 'hive-181335', isNsfwContent: false });
  });

  it('returns a null permlink when the response carries none, and throws publish_failed on error', async () => {
    const noPermlink = mockFetch([() => jsonResponse({})]);
    await expect(
      updateThreespeakVideoInfo('jwt-1', { videoId: 'v', title: 't', description: 'd', tags: [], thumbnail: '' }, noPermlink),
    ).resolves.toEqual({ permlink: null });
    const failing = mockFetch([() => new Response('nope', { status: 500 })]);
    await expect(
      updateThreespeakVideoInfo('jwt-1', { videoId: 'v', title: 't', description: 'd', tags: [], thumbnail: '' }, failing),
    ).rejects.toMatchObject({ code: 'publish_failed' });
  });
});

describe('extractHashtags', () => {
  it('lowercases, dedupes, and drops the #', () => {
    expect(extractHashtags('Hello #Hive #hive #Post-Engineer!')).toEqual(['hive', 'post-engineer']);
  });
});

describe('publishThreespeakVideo', () => {
  it('logs in, uploads, registers, and publishes, returning the watch URL', async () => {
    const fetchFn = mockFetch([
      () => jsonResponse({ memo: memoFor('jwt-9') }),
      () => new Response(null, { status: 201, headers: { Location: `${THREESPEAK_TUS_ENDPOINT}up-1` } }),
      () => new Response(null, { status: 204, headers: { 'Upload-Offset': String(mp4Buffer(1000, 45000).length) } }),
      () => jsonResponse({ _id: 'video-9' }),
      () => jsonResponse({ permlink: 'my-first-video' }),
    ]);
    const result = await publishThreespeakVideo(
      {
        username: 'alice',
        postingKey: POSTING_KEY.toString(),
        video: mp4Buffer(1000, 45000),
        filename: 'clip.mp4',
        contentType: 'video/mp4',
        caption: 'My first video #hive',
      },
      fetchFn,
    );
    expect(result).toEqual({ videoId: 'video-9', permalink: 'https://3speak.tv/watch?v=alice/my-first-video' });
  });

  it('still succeeds without a permlink, returning the video id only', async () => {
    const fetchFn = mockFetch([
      () => jsonResponse({ memo: memoFor('jwt-9') }),
      () => new Response(null, { status: 201, headers: { Location: `${THREESPEAK_TUS_ENDPOINT}up-1` } }),
      () => new Response(null, { status: 204, headers: { 'Upload-Offset': '100' } }),
      () => jsonResponse({ _id: 'video-9' }),
      () => jsonResponse({}),
    ]);
    const result = await publishThreespeakVideo(
      { username: 'alice', postingKey: POSTING_KEY.toString(), video: Buffer.from('x'), filename: 'c.mp4', contentType: 'video/mp4', caption: 'hi' },
      fetchFn,
    );
    expect(result).toEqual({ videoId: 'video-9', permalink: null });
  });
});

describe('threespeakWatchUrl', () => {
  it('builds the watch URL from owner and permlink', () => {
    expect(threespeakWatchUrl('alice', 'my-video')).toBe('https://3speak.tv/watch?v=alice/my-video');
  });
});
