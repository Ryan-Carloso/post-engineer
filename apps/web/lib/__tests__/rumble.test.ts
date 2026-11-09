// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RUMBLE_LICENSE_TYPE_PERSONAL_USE,
  RUMBLE_SIMPLE_UPLOAD_URL,
  RUMBLE_TITLE_MAX_LENGTH,
  isValidRumbleAccessToken,
  uploadRumbleVideo,
} from '@/lib/rumble';
import { RumbleError } from '@/lib/errors';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const TOKEN = 'a'.repeat(40);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function call(index = 0): { url: string; init: RequestInit } {
  const [url, init] = mockFetch.mock.calls[index] as [string, RequestInit];
  return { url, init };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('isValidRumbleAccessToken', () => {
  it('accepts exactly 40 hex chars, upper or lower case', () => {
    expect(isValidRumbleAccessToken(TOKEN)).toBe(true);
    expect(isValidRumbleAccessToken('A'.repeat(40))).toBe(true);
    expect(isValidRumbleAccessToken('0123456789abcdef'.repeat(2) + '01234567')).toBe(true);
  });

  it('rejects 39/41 chars and non-hex', () => {
    expect(isValidRumbleAccessToken('a'.repeat(39))).toBe(false);
    expect(isValidRumbleAccessToken('a'.repeat(41))).toBe(false);
    expect(isValidRumbleAccessToken('g'.repeat(40))).toBe(false);
    expect(isValidRumbleAccessToken('')).toBe(false);
  });
});

describe('uploadRumbleVideo', () => {
  const input = {
    accessToken: TOKEN,
    channelId: 'chan-1',
    title: 'My video',
    description: 'A description',
    video: new Blob(['bytes'], { type: 'video/mp4' }),
    filename: 'video.mp4',
    contentType: 'video/mp4',
  };

  it('posts the multipart form to the Simple Upload API with the Personal Use license', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, video_id: 'vid-1', monetized_url: 'https://rumble.com/v1abcde.html' }));

    const result = await uploadRumbleVideo(input);

    expect(result).toEqual({ videoId: 'vid-1', url: 'https://rumble.com/v1abcde.html' });
    const { url, init } = call();
    expect(url).toBe(RUMBLE_SIMPLE_UPLOAD_URL);
    expect(url).not.toContain('?');
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form.get('access_token')).toBe(TOKEN);
    expect(form.get('channel_id')).toBe('chan-1');
    expect(form.get('title')).toBe('My video');
    expect(form.get('description')).toBe('A description');
    expect(form.get('license_type')).toBe(String(RUMBLE_LICENSE_TYPE_PERSONAL_USE));
    expect(form.get('video')).toBeInstanceOf(Blob);
  });

  it('reads the id and url through their aliases and allows a missing url', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'vid-2', url: 'https://rumble.com/v2.html' }));
    expect(await uploadRumbleVideo(input)).toEqual({ videoId: 'vid-2', url: 'https://rumble.com/v2.html' });

    mockFetch.mockResolvedValueOnce(jsonResponse({ videoId: 'vid-3' }));
    expect(await uploadRumbleVideo(input)).toEqual({ videoId: 'vid-3', url: null });
  });

  it('fails on success:false and on a present error object', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: false, error: 'encoding failed' }));
    await expect(uploadRumbleVideo(input)).rejects.toMatchObject({ name: 'RumbleError', code: 'upload_failed' });

    mockFetch.mockResolvedValueOnce(jsonResponse({ error: { message: 'encoding failed' } }));
    await expect(uploadRumbleVideo(input)).rejects.toMatchObject({ name: 'RumbleError', code: 'upload_failed' });
  });

  it('maps an invalid-token message to invalid_token so the handler can report the dead account', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: false, error: 'Invalid access token' }, 401));
    const error = await uploadRumbleVideo(input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RumbleError);
    expect(error as RumbleError).toMatchObject({ code: 'invalid_token', statusCode: 401 });

    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 403));
    await expect(uploadRumbleVideo(input)).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('fails on a non-2xx status and on a missing video id', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));
    await expect(uploadRumbleVideo(input)).rejects.toMatchObject({ name: 'RumbleError', code: 'upload_failed', statusCode: 500 });

    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));
    await expect(uploadRumbleVideo(input)).rejects.toMatchObject({ code: 'upload_failed' });
  });

  it('pins the title ceiling', () => {
    expect(RUMBLE_TITLE_MAX_LENGTH).toBe(100);
  });
});
