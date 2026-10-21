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
