import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.gen';
import { encryptJson, decryptJson, TokenDecryptError } from '@/lib/token-crypto';

//---------------
// Tool Config — per-user research/stock tool configuration (issue #669).
// One row per user in user_tool_configs: the configured search tool, the
// licensed stock sources, and the API keys in one AES-256-GCM blob
// (lib/token-crypto.ts encryptJson/decryptJson, the same envelope as
// social_accounts.encrypted_tokens). Reads/writes use the service client
// after the route proves ownership: the session JWT has no SELECT on the
// table (migration 070), so ciphertext never reaches PostgREST and a key
// is never returned in full by any API or MCP response — presence and the
// last 4 characters only.
//---------------

export const TOOL_CONFIG_SEARCH_TOOLS = ['tavily', 'exa'] as const;
export type ToolConfigSearchTool = (typeof TOOL_CONFIG_SEARCH_TOOLS)[number];

export const TOOL_CONFIG_STOCK_SOURCES = ['pexels', 'pixabay', 'coverr'] as const;
export type ToolConfigStockSource = (typeof TOOL_CONFIG_STOCK_SOURCES)[number];

export const TOOL_CONFIG_KEY_NAMES = ['tavily', 'exa', 'pexels', 'pixabay', 'coverr'] as const;
export type ToolConfigKeyName = (typeof TOOL_CONFIG_KEY_NAMES)[number];

export type ToolConfigKeys = Partial<Record<ToolConfigKeyName, string>>;

export interface ToolConfigInput {
  searchTool: ToolConfigSearchTool | null;
  stockSources: ToolConfigStockSource[];
  keys: ToolConfigKeys;
}

// The full configuration as stored, keys included. This shape never
// leaves the server: the route converts it to ToolConfigPresence before
// answering, so no API or MCP response ever carries a key value.
export interface ToolConfig {
  searchTool: ToolConfigSearchTool | null;
  stockSources: ToolConfigStockSource[];
  keys: ToolConfigKeys;
}

// What a save returns: the configuration minus the key values. A key is
// shown as present + its last 4 characters, never in full.
export interface ToolConfigPresence {
  searchTool: ToolConfigSearchTool | null;
  stockSources: ToolConfigStockSource[];
  keysPresent: Record<ToolConfigKeyName, boolean>;
  keysLast4: Record<ToolConfigKeyName, string | null>;
}

export class ToolConfigValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'ToolConfigValidationError';
    this.field = field;
  }
}

// The stored blob exists but this key cannot read it (tampered, or
// encrypted under a different key). The user repairs it by saving the
// configuration again; it is never a missing row.
export class ToolConfigUnreadableError extends Error {
  constructor() {
    super('Saved tool configuration could not be read; save it again');
    this.name = 'ToolConfigUnreadableError';
  }
}

const MAX_KEY_LENGTH = 512;

const EMPTY_PRESENCE: Record<ToolConfigKeyName, boolean> = {
  tavily: false,
  exa: false,
  pexels: false,
  pixabay: false,
  coverr: false,
};

const EMPTY_LAST4: Record<ToolConfigKeyName, string | null> = {
  tavily: null,
  exa: null,
  pexels: null,
  pixabay: null,
  coverr: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The last 4 characters of a key, for display only. A key of 4 characters
// or fewer is never shown in full.
export function last4OfKey(key: string): string {
  return key.length <= 4 ? '****' : key.slice(-4);
}

export function toToolConfigPresence(config: ToolConfig): ToolConfigPresence {
  const keysPresent: Record<ToolConfigKeyName, boolean> = { ...EMPTY_PRESENCE };
  const keysLast4: Record<ToolConfigKeyName, string | null> = { ...EMPTY_LAST4 };
  for (const name of TOOL_CONFIG_KEY_NAMES) {
    const key = config.keys[name];
    if (typeof key === 'string' && key.length > 0) {
      keysPresent[name] = true;
      keysLast4[name] = last4OfKey(key);
    }
  }
  return {
    searchTool: config.searchTool,
    stockSources: [...config.stockSources],
    keysPresent,
    keysLast4,
  };
}

// Strict validation for a replace-whole save: every field is required, a
// key is only accepted for the tool/source it belongs to, and nothing is
// silently truncated, coerced, or dropped.
export function validateToolConfigInput(value: unknown): ToolConfigInput {
  if (!isRecord(value)) {
    throw new ToolConfigValidationError('config', 'Tool configuration must be an object');
  }

  const searchTool = value.searchTool;
  if (searchTool !== null && searchTool !== 'tavily' && searchTool !== 'exa') {
    throw new ToolConfigValidationError(
      'searchTool',
      'searchTool must be "tavily", "exa", or null',
    );
  }

  const stockSourcesRaw = value.stockSources;
  if (!Array.isArray(stockSourcesRaw)) {
    throw new ToolConfigValidationError('stockSources', 'stockSources must be an array');
  }
  const stockSources: ToolConfigStockSource[] = [];
  for (const source of stockSourcesRaw) {
    if (source !== 'pexels' && source !== 'pixabay' && source !== 'coverr') {
      throw new ToolConfigValidationError(
        'stockSources',
        'stockSources may only contain "pexels", "pixabay", and "coverr"',
      );
    }
    if (!stockSources.includes(source)) {
      stockSources.push(source);
    }
  }

  const keysRaw = value.keys;
  if (!isRecord(keysRaw)) {
    throw new ToolConfigValidationError('keys', 'keys must be an object');
  }
  const keys: ToolConfigKeys = {};
  for (const [name, rawKey] of Object.entries(keysRaw)) {
    if (
      name !== 'tavily' &&
      name !== 'exa' &&
      name !== 'pexels' &&
      name !== 'pixabay' &&
      name !== 'coverr'
    ) {
      throw new ToolConfigValidationError(`keys.${name}`, `Unknown key name "${name}"`);
    }
    if (typeof rawKey !== 'string') {
      throw new ToolConfigValidationError(`keys.${name}`, `Key "${name}" must be a string`);
    }
    const key = rawKey.trim();
    if (key.length === 0) {
      throw new ToolConfigValidationError(`keys.${name}`, `Key "${name}" must not be empty`);
    }
    if (key.length > MAX_KEY_LENGTH) {
      throw new ToolConfigValidationError(
        `keys.${name}`,
        `Key "${name}" must be at most ${MAX_KEY_LENGTH} characters`,
      );
    }
    keys[name] = key;
  }

  // A key only makes sense for the tool/source it belongs to: a Tavily key
  // with no Tavily selection (or an Exa key alongside Tavily) is a
  // contradictory save, not a partial one.
  if (keys.tavily !== undefined && searchTool !== 'tavily') {
    throw new ToolConfigValidationError(
      'keys.tavily',
      'A Tavily key requires searchTool "tavily"',
    );
  }
  if (keys.exa !== undefined && searchTool !== 'exa') {
    throw new ToolConfigValidationError('keys.exa', 'An Exa key requires searchTool "exa"');
  }
  for (const source of ['pexels', 'pixabay', 'coverr'] as const) {
    if (keys[source] !== undefined && !stockSources.includes(source)) {
      throw new ToolConfigValidationError(
        `keys.${source}`,
        `A ${source} key requires "${source}" in stockSources`,
      );
    }
  }

  return { searchTool, stockSources, keys };
}

// The stored blob was written by saveToolConfig, but a read never trusts
// it blindly: unknown names and non-string values are dropped, so a blob
// written by an older or foreign writer cannot smuggle a field through.
function parseStoredKeys(encryptedKeys: string | null): ToolConfigKeys {
  if (encryptedKeys === null || encryptedKeys === '') {
    return {};
  }
  const decrypted = decryptJson(encryptedKeys);
  const keys: ToolConfigKeys = {};
  for (const name of TOOL_CONFIG_KEY_NAMES) {
    const value = decrypted[name];
    if (typeof value === 'string' && value.length > 0) {
      keys[name] = value;
    }
  }
  return keys;
}

type ToolConfigClient = SupabaseClient<Database>;

export async function getToolConfig(
  supabase: ToolConfigClient,
  userId: string,
): Promise<ToolConfig | null> {
  const { data, error } = await supabase
    .from('user_tool_configs')
    .select('search_tool, stock_sources, encrypted_keys')
    .eq('user_id', userId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to get tool configuration: ${error.message}`);
  }
  if (data === null) {
    return null;
  }

  const searchTool =
    data.search_tool === 'tavily' || data.search_tool === 'exa' ? data.search_tool : null;
  const stockSources = (Array.isArray(data.stock_sources) ? data.stock_sources : []).filter(
    (source): source is ToolConfigStockSource =>
      source === 'pexels' || source === 'pixabay' || source === 'coverr',
  );

  let keys: ToolConfigKeys;
  try {
    keys = parseStoredKeys(data.encrypted_keys);
  } catch (error) {
    if (error instanceof TokenDecryptError) {
      // A blob this key cannot read is a broken stored row, not a missing
      // one: the user saves the configuration again to repair it.
      throw new ToolConfigUnreadableError();
    }
    throw error;
  }

  return { searchTool, stockSources, keys };
}

export async function saveToolConfig(
  supabase: ToolConfigClient,
  userId: string,
  value: unknown,
): Promise<ToolConfigPresence> {
  const input = validateToolConfigInput(value);
  const hasKeys = Object.keys(input.keys).length > 0;
  const { error } = await supabase.from('user_tool_configs').upsert(
    {
      user_id: userId,
      search_tool: input.searchTool,
      stock_sources: input.stockSources,
      encrypted_keys: hasKeys ? encryptJson(input.keys) : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error !== null) {
    throw new Error(`Failed to save tool configuration: ${error.message}`);
  }

  return toToolConfigPresence(input);
}
