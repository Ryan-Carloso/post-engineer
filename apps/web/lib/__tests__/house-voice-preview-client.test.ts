import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchHouseVoicePreview } from '@/lib/house-voice-preview-client';
import { notifyIfSessionExpired } from '@/lib/session-expiry';

vi.mock('@/lib/session-expiry', () => ({
  notifyIfSessionExpired: vi.fn(),
}));

function audioResponse(body: Blob): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'audio/mpeg' }),
    blob: async () => body,
    json: async () => null,
  } as Response;
}

describe('fetchHouseVoicePreview', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts the text as JSON to the encoded preview url and returns the audio blob', async () => {
    const audio = new Blob(['mp3'], { type: 'audio/mpeg' });
    vi.mocked(fetch).mockResolvedValue(audioResponse(audio));

    const result = await fetchHouseVoicePreview('chatterbox:phonon_zoey', 'Hello world');

    expect(result).toEqual({ success: true, audio });
    expect(fetch).toHaveBeenCalledWith(
      '/api/persona/voices/chatterbox%3Aphonon_zoey/preview',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello world' }),
      },
    );
  });

  it('returns the status and server error on 429 without throwing', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: false, error: 'Too many requests.' }),
    } as Response);

    const result = await fetchHouseVoicePreview('chatterbox:phonon_zoey', 'Hello world');

    expect(result).toEqual({ success: false, status: 429, error: 'Too many requests.' });
  });

  it('returns the status and server error on 400 without throwing', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: false, error: 'Preview text must be 1 to 300 characters after trimming.' }),
    } as Response);

    const result = await fetchHouseVoicePreview('chatterbox:phonon_zoey', 'x'.repeat(301));

    expect(result).toEqual({
      success: false,
      status: 400,
      error: 'Preview text must be 1 to 300 characters after trimming.',
    });
  });

  it('treats a 200 without audio content as a failure', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: false, error: 'Preview unavailable.' }),
      blob: async () => new Blob(),
    } as Response);

    const result = await fetchHouseVoicePreview('chatterbox:phonon_zoey', 'Hello world');

    expect(result).toEqual({ success: false, status: 200, error: 'Preview unavailable.' });
  });

  it('returns status 0 when the request itself fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network down'));

    const result = await fetchHouseVoicePreview('chatterbox:phonon_zoey', 'Hello world');

    expect(result).toEqual({ success: false, status: 0, error: 'Could not play the preview.' });
  });

  it('notifies session expiry on 401', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: false, error: 'Unauthorized.' }),
    } as Response);

    const result = await fetchHouseVoicePreview('chatterbox:phonon_zoey', 'Hello world');

    expect(result).toEqual({ success: false, status: 401, error: 'Unauthorized.' });
    expect(notifyIfSessionExpired).toHaveBeenCalled();
  });
});
