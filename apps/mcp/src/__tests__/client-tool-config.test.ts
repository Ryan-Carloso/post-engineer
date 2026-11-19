import { describe, expect, it, vi } from 'vitest';
import type { PostEngineerClient } from '../client.js';
import { getToolConfig, saveToolConfig } from '../client-tool-config.js';

const PRESENCE = {
  success: true,
  configured: true,
  searchTool: 'tavily',
  stockSources: ['pexels'],
  keysPresent: { tavily: true, exa: false, pexels: true, pixabay: false, coverr: false },
  keysLast4: { tavily: '1234', exa: null, pexels: '5678', pixabay: null, coverr: null },
};

function mockClient(payload: unknown): PostEngineerClient {
  return {
    request: vi.fn(async () => payload),
    getHeaders: () => ({ Authorization: 'Bearer <redacted>' }),
  } as unknown as PostEngineerClient;
}

describe('tool-config client', () => {
  it('parses a well-formed get 200', async () => {
    const client = mockClient(PRESENCE);
    const result = await getToolConfig(client);
    expect(result.keysPresent.tavily).toBe(true);
    expect(result.keysLast4.tavily).toBe('1234');
    expect(client.request).toHaveBeenCalledWith(
      '/api/tool-config',
      { method: 'GET', headers: { Authorization: 'Bearer <redacted>' } },
      'get tool configuration',
    );
  });

  it('strips a key value from a get 200 instead of passing it through', async () => {
    const client = mockClient({ ...PRESENCE, keys: { tavily: 'tvly-fake-key-1234' } });
    const result = await getToolConfig(client);
    expect(result.keysPresent.tavily).toBe(true);
    expect('keys' in result).toBe(false);
    expect(JSON.stringify(result)).not.toContain('tvly-fake-key-1234');
  });

  it('rejects a malformed get 200', async () => {
    const client = mockClient({ success: true, configured: true });
    await expect(getToolConfig(client)).rejects.toThrow(
      'Malformed response from GET /api/tool-config',
    );
  });

  it('parses a well-formed save 200 and sends the whole configuration', async () => {
    const client = mockClient(PRESENCE);
    const config = {
      searchTool: 'tavily' as const,
      stockSources: ['pexels' as const],
      keys: { tavily: 'tvly-fake-key-1234', pexels: 'pxls-fake-key-5678' },
    };
    const result = await saveToolConfig(client, config);
    expect(result.configured).toBe(true);
    expect(client.request).toHaveBeenCalledWith(
      '/api/tool-config',
      {
        method: 'PUT',
        headers: { Authorization: 'Bearer <redacted>' },
        body: JSON.stringify(config),
      },
      'save tool configuration',
    );
  });

  it('rejects a malformed save 200', async () => {
    const client = mockClient({ success: true, configured: true });
    await expect(
      saveToolConfig(client, { searchTool: null, stockSources: [], keys: {} }),
    ).rejects.toThrow('Malformed response from PUT /api/tool-config');
  });
});
