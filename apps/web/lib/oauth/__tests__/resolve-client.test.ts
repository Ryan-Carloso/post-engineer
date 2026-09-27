import { describe, it, expect, vi } from 'vitest';
import { resolveClient } from '../resolve-client';
import { fetchCimdDocument } from '../clients';

vi.mock('../clients', async (importOriginal) => {
  const original = await importOriginal<typeof import('../clients')>();
  return { ...original, fetchCimdDocument: vi.fn() };
});

function serviceClientWith(row: unknown) {
  const single = vi.fn().mockResolvedValue({ data: row, error: null });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  return { from: vi.fn().mockReturnValue({ select }) };
}

describe('resolveClient', () => {
  it('resolves a registered DCR client from the database', async () => {
    const supabase = serviceClientWith({
      client_id: 'mcp_client_abc',
      client_name: 'ChatGPT',
      redirect_uris: ['https://chatgpt.com/connector/callback'],
    });
    const client = await resolveClient(
      'mcp_client_abc',
      supabase as unknown as Parameters<typeof resolveClient>[1],
    );
    expect(client).toEqual({
      clientName: 'ChatGPT',
      redirectUris: ['https://chatgpt.com/connector/callback'],
    });
  });

  it('returns null for unknown client ids', async () => {
    const supabase = serviceClientWith(null);
    const client = await resolveClient(
      'mcp_client_missing',
      supabase as unknown as Parameters<typeof resolveClient>[1],
    );
    expect(client).toBeNull();
  });

  it('resolves CIMD urls without touching the database', async () => {
    vi.mocked(fetchCimdDocument).mockResolvedValue({
      redirect_uris: ['https://chatgpt.com/connector/callback'],
    });
    const from = vi.fn();
    const client = await resolveClient(
      'https://chatgpt.com/mcp-client.json',
      { from } as unknown as Parameters<typeof resolveClient>[1],
    );
    expect(client).toEqual({
      clientName: 'MCP client',
      redirectUris: ['https://chatgpt.com/connector/callback'],
    });
    expect(from).not.toHaveBeenCalled();
  });
});
