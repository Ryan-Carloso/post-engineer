import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createClonedVoiceFromUrl,
  deleteClonedVoice,
  fetchCloneReferenceAudio,
  listClonedVoices,
  previewClonedVoice,
  type ClonedVoiceClientHost,
} from '../cloned-voice-client.js';
import {
  handleCreateClonedVoice,
  handleDeleteClonedVoice,
  handleListClonedVoices,
  handlePreviewClonedVoice,
} from '../cloned-voice-tools.js';
import { createPostEngineerMcpServer } from '../index.js';
import type { PostEngineerClient } from '../client.js';

const mockTrackEvent = vi.fn();
vi.mock('../analytics.js', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

const realFetch = global.fetch;

function fakeHost(request: ReturnType<typeof vi.fn>): ClonedVoiceClientHost {
  return {
    getHeaders: vi.fn((includeContentType?: boolean): Record<string, string> => {
      const headers: Record<string, string> = { Authorization: 'Bearer test-token' };
      if (includeContentType !== false) {
        headers['Content-Type'] = 'application/json';
      }
      return headers;
    }),
    request: request as unknown as ClonedVoiceClientHost['request'],
  };
}

function audioResponse(bytes: number[], contentType = 'audio/wav') {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name === 'content-type' ? contentType : null) },
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  };
}

function firstText(result: { content?: unknown }): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content?.[0]?.text ?? '';
}

describe('fetchCloneReferenceAudio', () => {
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('rejects an unparsable URL', async () => {
    await expect(fetchCloneReferenceAudio('not a url')).rejects.toThrow(
      'audioUrl must be a valid URL'
    );
  });

  it('rejects plain http outside loopback', async () => {
    await expect(fetchCloneReferenceAudio('http://example.com/ref.wav')).rejects.toThrow(
      'audioUrl must use https (http is allowed only on loopback)'
    );
  });

  it('downloads https audio into a Blob with the response content type', async () => {
    global.fetch = vi.fn().mockResolvedValue(audioResponse([1, 2, 3], 'audio/mpeg'));
    const blob = await fetchCloneReferenceAudio('https://cdn.example.com/ref.mp3');
    expect(blob.type).toBe('audio/mpeg');
    expect(blob.size).toBe(3);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://cdn.example.com/ref.mp3',
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) })
    );
  });

  it('allows http on loopback hosts', async () => {
    global.fetch = vi.fn().mockResolvedValue(audioResponse([9]));
    const blob = await fetchCloneReferenceAudio('http://127.0.0.1:8080/ref.wav');
    expect(blob.size).toBe(1);
  });

  it('rejects a non-OK download', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    await expect(fetchCloneReferenceAudio('https://cdn.example.com/missing.wav')).rejects.toThrow(
      'Failed to download audio: HTTP 404'
    );
  });

  it('rejects an empty download', async () => {
    global.fetch = vi.fn().mockResolvedValue(audioResponse([]));
    await expect(fetchCloneReferenceAudio('https://cdn.example.com/empty.wav')).rejects.toThrow(
      'Downloaded audio is empty'
    );
  });

  it('rejects a download over the size cap', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'audio/wav' },
      arrayBuffer: async () => new ArrayBuffer(20 * 1024 * 1024 + 1),
    });
    await expect(fetchCloneReferenceAudio('https://cdn.example.com/huge.wav')).rejects.toThrow(
      'Downloaded audio exceeds 20 MB'
    );
  });
});

describe('cloned voice client calls', () => {
  it('lists cloned voices through the host request', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, voices: [] });
    const host = fakeHost(request);
    const result = await listClonedVoices(host);
    expect(result).toEqual({ success: true, voices: [] });
    expect(request).toHaveBeenCalledWith(
      '/api/persona/cloned-voices',
      { method: 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' } },
      'list cloned voices'
    );
  });

  it('deletes a cloned voice with an encoded id', async () => {
    const request = vi.fn().mockResolvedValue({ success: true });
    const host = fakeHost(request);
    await deleteClonedVoice(host, 'a/b c');
    expect(request).toHaveBeenCalledWith(
      '/api/persona/cloned-voices/a%2Fb%20c',
      expect.objectContaining({ method: 'DELETE' }),
      'delete cloned voice'
    );
  });

  it('previews without a language suffix by default', async () => {
    const request = vi.fn().mockResolvedValue({ audioBase64: 'QUJD', mediaType: 'audio/mpeg' });
    const host = fakeHost(request);
    const result = await previewClonedVoice(host, 'clone-1');
    expect(result).toEqual({ audioBase64: 'QUJD', mediaType: 'audio/mpeg' });
    expect(request).toHaveBeenCalledWith(
      '/api/persona/cloned-voices/clone-1/preview',
      expect.objectContaining({ method: 'POST' }),
      'preview cloned voice'
    );
  });

  it('adds a trimmed, encoded language suffix to previews', async () => {
    const request = vi.fn().mockResolvedValue({ audioBase64: 'QUJD' });
    const host = fakeHost(request);
    await previewClonedVoice(host, 'clone-1', ' pt-BR ');
    expect(request).toHaveBeenCalledWith(
      '/api/persona/cloned-voices/clone-1/preview?language=pt-BR',
      expect.objectContaining({ method: 'POST' }),
      'preview cloned voice'
    );
  });

  it('rejects a non-object preview response', async () => {
    const request = vi.fn().mockResolvedValue('not-an-object');
    const host = fakeHost(request);
    await expect(previewClonedVoice(host, 'clone-1')).rejects.toThrow(
      'unexpected preview response'
    );
  });

  it('rejects a preview response without audioBase64', async () => {
    const request = vi.fn().mockResolvedValue({ success: true });
    const host = fakeHost(request);
    await expect(previewClonedVoice(host, 'clone-1')).rejects.toThrow(
      'preview response missing audioBase64'
    );
  });
});

describe('createClonedVoiceFromUrl', () => {
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('requires consent before downloading anything', async () => {
    const request = vi.fn();
    const host = fakeHost(request);
    global.fetch = vi.fn();
    await expect(
      createClonedVoiceFromUrl(host, 'https://cdn.example.com/ref.wav', 'pt', false)
    ).rejects.toThrow('consent must be true to create a voice clone');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('uploads the downloaded reference as multipart form data', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, body: { id: 'clone-1' } });
    const host = fakeHost(request);
    global.fetch = vi.fn().mockResolvedValue(audioResponse([1, 2, 3, 4]));
    const result = await createClonedVoiceFromUrl(
      host,
      'https://cdn.example.com/ref.wav',
      'pt',
      true
    );
    expect(result).toEqual({ success: true, body: { id: 'clone-1' } });
    expect(request).toHaveBeenCalledTimes(1);
    const [path, init, label, timeout] = request.mock.calls[0] as [
      string,
      RequestInit,
      string,
      number,
    ];
    expect(path).toBe('/api/persona/cloned-voices');
    expect(init.method).toBe('POST');
    expect(label).toBe('create cloned voice');
    expect(timeout).toBe(120_000);
    const form = init.body as FormData;
    expect(form.get('consent')).toBe('true');
    expect(form.get('language')).toBe('pt');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });
});

describe('cloned voice tool handlers', () => {
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('handleListClonedVoices returns the payload as JSON text', async () => {
    const request = vi.fn().mockResolvedValue({ voices: [{ id: 'c1', status: 'ready' }] });
    const client = fakeHost(request) as unknown as PostEngineerClient;
    const result = await handleListClonedVoices(client);
    expect(result.isError).toBeFalsy();
    expect(firstText(result)).toContain('"c1"');
  });

  it('handleListClonedVoices maps failures to an error response', async () => {
    const request = vi.fn().mockRejectedValue(new Error('down'));
    const client = fakeHost(request) as unknown as PostEngineerClient;
    const result = await handleListClonedVoices(client);
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('Error listing cloned voices');
  });

  it('handleCreateClonedVoice prefixes the success message', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, body: { id: 'clone-1' } });
    const client = fakeHost(request) as unknown as PostEngineerClient;
    global.fetch = vi.fn().mockResolvedValue(audioResponse([7, 7]));
    const result = await handleCreateClonedVoice(client, {
      audioUrl: 'https://cdn.example.com/ref.wav',
      language: 'en',
      consent: true,
    });
    expect(result.isError).toBeFalsy();
    expect(firstText(result)).toContain('Voice clone registration started');
  });

  it('handleDeleteClonedVoice prefixes the success message', async () => {
    const request = vi.fn().mockResolvedValue({ success: true });
    const client = fakeHost(request) as unknown as PostEngineerClient;
    const result = await handleDeleteClonedVoice(client, { cloneId: 'clone-1' });
    expect(result.isError).toBeFalsy();
    expect(firstText(result)).toContain('Cloned voice deleted');
  });

  it('handleDeleteClonedVoice maps failures to an error response', async () => {
    const request = vi.fn().mockRejectedValue(new Error('gone'));
    const client = fakeHost(request) as unknown as PostEngineerClient;
    const result = await handleDeleteClonedVoice(client, { cloneId: 'clone-1' });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('Error deleting cloned voice');
  });

  it('handlePreviewClonedVoice returns the audio payload', async () => {
    const request = vi.fn().mockResolvedValue({ audioBase64: 'QUJD' });
    const client = fakeHost(request) as unknown as PostEngineerClient;
    const result = await handlePreviewClonedVoice(client, { cloneId: 'clone-1' });
    expect(result.isError).toBeFalsy();
    expect(firstText(result)).toContain('QUJD');
  });

  it('handlePreviewClonedVoice maps a malformed payload to an error response', async () => {
    const request = vi.fn().mockResolvedValue({ success: true });
    const client = fakeHost(request) as unknown as PostEngineerClient;
    const result = await handlePreviewClonedVoice(client, { cloneId: 'clone-1' });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('Error previewing cloned voice');
  });
});

describe('cloned voice tools run through the MCP server', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  async function callTool(
    toolName: string,
    args: Record<string, unknown>,
    request: ReturnType<typeof vi.fn>
  ) {
    const apiClient = fakeHost(request) as unknown as PostEngineerClient;
    const server = createPostEngineerMcpServer(apiClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({ name: toolName, arguments: args });
      expect(result.isError).toBeFalsy();
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'mcp_tool_called',
        expect.objectContaining({ toolName })
      );
      return result;
    } finally {
      await client.close();
    }
  }

  it('list_cloned_voices calls the client request', async () => {
    const request = vi.fn().mockResolvedValue({ voices: [] });
    await callTool('list_cloned_voices', {}, request);
    expect(request).toHaveBeenCalledWith(
      '/api/persona/cloned-voices',
      expect.objectContaining({ method: 'GET' }),
      'list cloned voices'
    );
  });

  it('create_cloned_voice downloads then uploads', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, body: { id: 'clone-1' } });
    global.fetch = vi.fn().mockResolvedValue(audioResponse([5, 5, 5]));
    const result = await callTool(
      'create_cloned_voice',
      { audioUrl: 'https://cdn.example.com/ref.wav', language: 'pt', consent: true },
      request
    );
    expect(firstText(result as { content?: unknown })).toContain(
      'Voice clone registration started'
    );
    expect(request).toHaveBeenCalledWith(
      '/api/persona/cloned-voices',
      expect.objectContaining({ method: 'POST' }),
      'create cloned voice',
      120_000
    );
  });

  it('delete_cloned_voice calls the client request', async () => {
    const request = vi.fn().mockResolvedValue({ success: true });
    await callTool('delete_cloned_voice', { cloneId: 'clone-1' }, request);
    expect(request).toHaveBeenCalledWith(
      '/api/persona/cloned-voices/clone-1',
      expect.objectContaining({ method: 'DELETE' }),
      'delete cloned voice'
    );
  });

  it('preview_cloned_voice calls the client request', async () => {
    const request = vi.fn().mockResolvedValue({ audioBase64: 'QUJD' });
    await callTool('preview_cloned_voice', { cloneId: 'clone-1' }, request);
    expect(request).toHaveBeenCalledWith(
      '/api/persona/cloned-voices/clone-1/preview',
      expect.objectContaining({ method: 'POST' }),
      'preview cloned voice'
    );
  });
});
