import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clonedVoicePreviewUrl,
  createClonedVoice,
  deleteClonedVoice,
  fetchClonedVoice,
  fetchClonedVoices,
} from '@/lib/cloned-voices-client';

const sampleRow = {
  id: 'clone-1',
  status: 'ready',
  language: 'pt',
  voice_id: 'chatterbox:u1',
  error_code: null,
  consent_at: '2026-01-01T00:00:00Z',
  created_at: null,
  updated_at: null,
};

describe('cloned-voices-client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetchClonedVoices returns narrowed rows', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ voices: [sampleRow, { bad: true }] }),
    } as Response);

    const voices = await fetchClonedVoices();
    expect(voices).toHaveLength(1);
    expect(voices[0].id).toBe('clone-1');
  });

  it('fetchClonedVoices throws on non-ok with server error', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Denied.' }),
    } as Response);

    await expect(fetchClonedVoices()).rejects.toThrow('Denied.');
  });

  it('fetchClonedVoices throws on invalid shape', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ voices: 'nope' }),
    } as Response);

    await expect(fetchClonedVoices()).rejects.toThrow('Invalid cloned voices response.');
  });

  it('fetchClonedVoice returns a single row', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ voice: sampleRow }),
    } as Response);

    const voice = await fetchClonedVoice('clone-1');
    expect(voice.voice_id).toBe('chatterbox:u1');
  });

  it('fetchClonedVoice throws when voice is missing', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ voice: { id: 1 } }),
    } as Response);

    await expect(fetchClonedVoice('clone-1')).rejects.toThrow('Invalid cloned voice response.');
  });

  it('createClonedVoice posts multipart and returns voice', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ voice: sampleRow }),
    } as Response);

    const file = new Blob([new Uint8Array(8)], { type: 'audio/wav' });
    const voice = await createClonedVoice(file, 'pt', true);
    expect(voice.id).toBe('clone-1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/persona/cloned-voices',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('createClonedVoice surfaces server error message', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Quota exceeded.' }),
    } as Response);

    const file = new Blob([new Uint8Array(8)], { type: 'audio/wav' });
    await expect(createClonedVoice(file, 'pt', true)).rejects.toThrow('Quota exceeded.');
  });

  it('deleteClonedVoice succeeds on ok', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    await deleteClonedVoice('clone-1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/persona/cloned-voices/clone-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('deleteClonedVoice throws on failure', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Gone.' }),
    } as Response);

    await expect(deleteClonedVoice('clone-1')).rejects.toThrow('Gone.');
  });

  it('clonedVoicePreviewUrl appends language query when set', () => {
    expect(clonedVoicePreviewUrl('abc', 'pt-br')).toBe(
      '/api/persona/cloned-voices/abc/preview?language=pt-br',
    );
    expect(clonedVoicePreviewUrl('abc', null)).toBe('/api/persona/cloned-voices/abc/preview');
  });
});

describe('cloned-voices-client error and encoding branches', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetchClonedVoices calls the exact list url and filters null rows', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ voices: [null, sampleRow] }),
    } as Response);

    const voices = await fetchClonedVoices();
    expect(fetch).toHaveBeenCalledWith('/api/persona/cloned-voices');
    expect(voices).toEqual([sampleRow]);
  });

  it('fetchClonedVoices falls back when a non-ok body has no error string', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 500 }),
    } as Response);

    await expect(fetchClonedVoices()).rejects.toThrow('Failed to load cloned voices.');
  });

  it('fetchClonedVoices falls back when a non-ok body is not json', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => {
        throw new SyntaxError('not json');
      },
    } as unknown as Response);

    await expect(fetchClonedVoices()).rejects.toThrow('Failed to load cloned voices.');
  });

  it('fetchClonedVoices throws invalid response when an ok body is not json', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('not json');
      },
    } as unknown as Response);

    await expect(fetchClonedVoices()).rejects.toThrow('Invalid cloned voices response.');
  });

  it('fetchClonedVoices throws invalid response when the payload is null', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => null,
    } as Response);

    await expect(fetchClonedVoices()).rejects.toThrow('Invalid cloned voices response.');
  });

  it('fetchClonedVoice encodes the clone id in the url', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ voice: sampleRow }),
    } as Response);

    await fetchClonedVoice('a/b c');
    expect(fetch).toHaveBeenCalledWith('/api/persona/cloned-voices/a%2Fb%20c');
  });

  it('fetchClonedVoice surfaces the server error on non-ok', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Clone gone.' }),
    } as Response);

    await expect(fetchClonedVoice('clone-1')).rejects.toThrow('Clone gone.');
  });

  it('fetchClonedVoice falls back when a non-ok body has no error string', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({}),
    } as Response);

    await expect(fetchClonedVoice('clone-1')).rejects.toThrow('Failed to load cloned voice.');
  });

  it('fetchClonedVoice falls back when a non-ok body is not json', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => {
        throw new SyntaxError('not json');
      },
    } as unknown as Response);

    await expect(fetchClonedVoice('clone-1')).rejects.toThrow('Failed to load cloned voice.');
  });

  it('fetchClonedVoice throws invalid response when the voice key is absent', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ voices: [] }),
    } as Response);

    await expect(fetchClonedVoice('clone-1')).rejects.toThrow('Invalid cloned voice response.');
  });

  it('createClonedVoice sends consent=false, language and the file as reference.webm', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ voice: sampleRow }),
    } as Response);

    const file = new Blob(['abc'], { type: 'audio/wav' });
    await createClonedVoice(file, 'en', false);
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    const body = init.body as FormData;
    expect(body.get('consent')).toBe('false');
    expect(body.get('language')).toBe('en');
    const sentFile = body.get('file') as File;
    expect(sentFile.name).toBe('reference.webm');
    expect(sentFile.type).toBe('audio/wav');
    expect(sentFile.size).toBe(3);
  });

  it('createClonedVoice falls back when a non-ok body has no error string', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => null,
    } as Response);

    const file = new Blob([new Uint8Array(8)], { type: 'audio/wav' });
    await expect(createClonedVoice(file, 'pt', true)).rejects.toThrow(
      'Could not create voice clone.',
    );
  });

  it('createClonedVoice throws invalid response when the ok body row is malformed', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ voice: { id: 'clone-1' } }),
    } as Response);

    const file = new Blob([new Uint8Array(8)], { type: 'audio/wav' });
    await expect(createClonedVoice(file, 'pt', true)).rejects.toThrow(
      'Invalid clone create response.',
    );
  });

  it('createClonedVoice throws invalid response when the voice key is absent', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    const file = new Blob([new Uint8Array(8)], { type: 'audio/wav' });
    await expect(createClonedVoice(file, 'pt', true)).rejects.toThrow(
      'Invalid clone create response.',
    );
  });

  it('deleteClonedVoice encodes the clone id in the url', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    await deleteClonedVoice('x/y');
    expect(fetch).toHaveBeenCalledWith(
      '/api/persona/cloned-voices/x%2Fy',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('deleteClonedVoice falls back when a non-ok body has no error string', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({}),
    } as Response);

    await expect(deleteClonedVoice('clone-1')).rejects.toThrow('Could not delete cloned voice.');
  });

  it('deleteClonedVoice falls back when a non-ok body is not json', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => {
        throw new SyntaxError('not json');
      },
    } as unknown as Response);

    await expect(deleteClonedVoice('clone-1')).rejects.toThrow('Could not delete cloned voice.');
  });

  it('clonedVoicePreviewUrl trims and encodes the language and encodes the clone id', () => {
    expect(clonedVoicePreviewUrl('a/b', ' pt br ')).toBe(
      '/api/persona/cloned-voices/a%2Fb/preview?language=pt%20br',
    );
  });

  it('clonedVoicePreviewUrl omits the query for blank languages', () => {
    expect(clonedVoicePreviewUrl('abc', '')).toBe('/api/persona/cloned-voices/abc/preview');
    expect(clonedVoicePreviewUrl('abc', '   ')).toBe('/api/persona/cloned-voices/abc/preview');
  });
});
