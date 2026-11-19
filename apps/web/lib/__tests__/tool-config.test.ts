import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.gen';
import {
  getToolConfig,
  saveToolConfig,
  validateToolConfigInput,
  toToolConfigPresence,
  last4OfKey,
  ToolConfigValidationError,
  ToolConfigUnreadableError,
} from '@/lib/tool-config';
import { TokenDecryptError } from '@/lib/token-crypto';

vi.mock('@/lib/token-crypto', () => ({
  encryptJson: vi.fn((payload: unknown) => `encrypted.${JSON.stringify(payload)}`),
  decryptJson: vi.fn((encrypted: string) => JSON.parse(encrypted.replace('encrypted.', ''))),
  TokenDecryptError: class TokenDecryptError extends Error {},
}));

const VALID_INPUT = {
  searchTool: 'tavily',
  stockSources: ['pexels', 'pixabay'],
  keys: { tavily: 'tvly-fake-key-1234', pexels: 'pxls-fake-key-5678' },
};

function createMockChain(row: unknown, error: unknown = null) {
  const upsert = vi.fn().mockResolvedValue({ error });
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error }),
    upsert,
  };
  return { chain, upsert };
}

function mockSupabase(row: unknown, error: unknown = null) {
  const { chain, upsert } = createMockChain(row, error);
  const from = vi.fn(() => chain);
  return {
    client: { from } as unknown as SupabaseClient<Database>,
    from,
    chain,
    upsert,
  };
}

describe('last4OfKey', () => {
  it('returns the last 4 characters', () => {
    expect(last4OfKey('tvly-fake-key-1234')).toBe('1234');
  });

  it('never shows a short key in full', () => {
    expect(last4OfKey('ab')).toBe('****');
    expect(last4OfKey('abcd')).toBe('****');
  });
});

describe('toToolConfigPresence', () => {
  it('maps present keys to last-4 and absent keys to false/null', () => {
    const presence = toToolConfigPresence({
      searchTool: 'tavily',
      stockSources: ['pexels'],
      keys: { tavily: 'tvly-fake-key-1234' },
    });
    expect(presence.keysPresent).toEqual({
      tavily: true,
      exa: false,
      pexels: false,
      pixabay: false,
      coverr: false,
    });
    expect(presence.keysLast4).toEqual({
      tavily: '1234',
      exa: null,
      pexels: null,
      pixabay: null,
      coverr: null,
    });
    expect(presence.searchTool).toBe('tavily');
    expect(presence.stockSources).toEqual(['pexels']);
  });

  it('never carries a key value', () => {
    const presence = toToolConfigPresence({
      searchTool: 'exa',
      stockSources: [],
      keys: { exa: 'exa-fake-key-9999' },
    });
    expect(JSON.stringify(presence)).not.toContain('exa-fake-key-9999');
    expect(presence.keysLast4.exa).toBe('9999');
  });
});

describe('validateToolConfigInput', () => {
  it('accepts a full valid configuration', () => {
    expect(validateToolConfigInput(VALID_INPUT)).toEqual({
      searchTool: 'tavily',
      stockSources: ['pexels', 'pixabay'],
      keys: { tavily: 'tvly-fake-key-1234', pexels: 'pxls-fake-key-5678' },
    });
  });

  it('accepts an empty configuration', () => {
    expect(validateToolConfigInput({ searchTool: null, stockSources: [], keys: {} })).toEqual({
      searchTool: null,
      stockSources: [],
      keys: {},
    });
  });

  it('trims key whitespace and dedupes stock sources', () => {
    const input = validateToolConfigInput({
      searchTool: 'exa',
      stockSources: ['coverr', 'coverr'],
      keys: { exa: '  exa-fake-key-1111  ' },
    });
    expect(input.stockSources).toEqual(['coverr']);
    expect(input.keys.exa).toBe('exa-fake-key-1111');
  });

  it.each([
    [null, 'config'],
    ['tavily', 'config'],
    [[], 'config'],
    [{ searchTool: 'google', stockSources: [], keys: {} }, 'searchTool'],
    [{ searchTool: 'tavily', stockSources: 'pexels', keys: {} }, 'stockSources'],
    [{ searchTool: 'tavily', stockSources: ['unsplash'], keys: {} }, 'stockSources'],
    [{ searchTool: 'tavily', stockSources: [], keys: 'nope' }, 'keys'],
    [{ searchTool: 'tavily', stockSources: [], keys: { google: 'x' } }, 'keys.google'],
    [{ searchTool: 'tavily', stockSources: [], keys: { tavily: '' } }, 'keys.tavily'],
    [{ searchTool: 'tavily', stockSources: [], keys: { tavily: '   ' } }, 'keys.tavily'],
    [{ searchTool: 'tavily', stockSources: [], keys: { tavily: 42 } }, 'keys.tavily'],
    [{ searchTool: 'tavily', stockSources: [], keys: { tavily: 'x'.repeat(513) } }, 'keys.tavily'],
  ])('rejects %s with field %s', (value, field) => {
    let caught: unknown;
    try {
      validateToolConfigInput(value);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ToolConfigValidationError);
    expect((caught as ToolConfigValidationError).field).toBe(field);
  });

  it('rejects a key for a tool that is not selected', () => {
    expect(() =>
      validateToolConfigInput({
        searchTool: null,
        stockSources: [],
        keys: { tavily: 'tvly-fake-key-1234' },
      }),
    ).toThrowError(ToolConfigValidationError);
    expect(() =>
      validateToolConfigInput({
        searchTool: 'tavily',
        stockSources: [],
        keys: { exa: 'exa-fake-key-1234' },
      }),
    ).toThrowError(ToolConfigValidationError);
    expect(() =>
      validateToolConfigInput({
        searchTool: 'exa',
        stockSources: ['pexels'],
        keys: { exa: 'exa-fake-key-1234', coverr: 'cvr-fake-key-1234' },
      }),
    ).toThrowError(ToolConfigValidationError);
  });
});

describe('getToolConfig', () => {
  it('returns null when the user has no row', async () => {
    const { client, from } = mockSupabase(null);
    expect(await getToolConfig(client, 'u1')).toBeNull();
    expect(from).toHaveBeenCalledWith('user_tool_configs');
  });

  it('returns the decrypted configuration', async () => {
    const row = {
      search_tool: 'tavily',
      stock_sources: ['pexels'],
      encrypted_keys: `encrypted.${JSON.stringify({ tavily: 'tvly-fake-key-1234', pexels: 'pxls-fake-key-5678' })}`,
    };
    const { client } = mockSupabase(row);
    expect(await getToolConfig(client, 'u1')).toEqual({
      searchTool: 'tavily',
      stockSources: ['pexels'],
      keys: { tavily: 'tvly-fake-key-1234', pexels: 'pxls-fake-key-5678' },
    });
  });

  it('returns an empty key map when no blob is stored', async () => {
    const row = { search_tool: null, stock_sources: [], encrypted_keys: null };
    const { client } = mockSupabase(row);
    expect(await getToolConfig(client, 'u1')).toEqual({
      searchTool: null,
      stockSources: [],
      keys: {},
    });
  });

  it('drops unknown and non-string keys from the stored blob', async () => {
    const row = {
      search_tool: 'exa',
      stock_sources: [],
      encrypted_keys: `encrypted.${JSON.stringify({ exa: 'exa-fake-key-1234', google: 'x', pexels: 42 })}`,
    };
    const { client } = mockSupabase(row);
    const config = await getToolConfig(client, 'u1');
    expect(config?.keys).toEqual({ exa: 'exa-fake-key-1234' });
  });

  it('throws on a database error', async () => {
    const { client } = mockSupabase(null, { message: 'boom' });
    await expect(getToolConfig(client, 'u1')).rejects.toThrow('Failed to get tool configuration');
  });

  it('throws ToolConfigUnreadableError when the blob cannot be decrypted', async () => {
    const { decryptJson } = await import('@/lib/token-crypto');
    vi.mocked(decryptJson).mockImplementationOnce(() => {
      throw new TokenDecryptError('bad tag');
    });
    const row = { search_tool: 'tavily', stock_sources: [], encrypted_keys: 'encrypted.{}' };
    const { client } = mockSupabase(row);
    await expect(getToolConfig(client, 'u1')).rejects.toBeInstanceOf(ToolConfigUnreadableError);
  });
});

describe('saveToolConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts one encrypted blob and returns presence only', async () => {
    const { client, upsert } = mockSupabase(null);
    const presence = await saveToolConfig(client, 'u1', VALID_INPUT);
    expect(upsert).toHaveBeenCalledTimes(1);
    const [row, options] = upsert.mock.calls[0] as [Record<string, unknown>, { onConflict: string }];
    expect(row.user_id).toBe('u1');
    expect(row.search_tool).toBe('tavily');
    expect(row.stock_sources).toEqual(['pexels', 'pixabay']);
    expect(typeof row.encrypted_keys).toBe('string');
    expect(row.encrypted_keys).toBe(`encrypted.${JSON.stringify(VALID_INPUT.keys)}`);
    expect(options).toEqual({ onConflict: 'user_id' });
    expect(presence.keysPresent.tavily).toBe(true);
    expect(presence.keysLast4.tavily).toBe('1234');
    expect(JSON.stringify(presence)).not.toContain('tvly-fake-key-1234');
  });

  it('stores a null blob when no keys are saved', async () => {
    const { client, upsert } = mockSupabase(null);
    await saveToolConfig(client, 'u1', { searchTool: null, stockSources: [], keys: {} });
    const [row] = upsert.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(row.encrypted_keys).toBeNull();
  });

  it('never writes on invalid input', async () => {
    const { client, upsert } = mockSupabase(null);
    await expect(
      saveToolConfig(client, 'u1', { searchTool: 'google', stockSources: [], keys: {} }),
    ).rejects.toBeInstanceOf(ToolConfigValidationError);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('throws on a database error', async () => {
    const { client } = mockSupabase(null, { message: 'boom' });
    await expect(saveToolConfig(client, 'u1', VALID_INPUT)).rejects.toThrow(
      'Failed to save tool configuration',
    );
  });
});
