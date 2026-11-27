import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.gen';
import { encryptJson, decryptJson, TokenDecryptError } from '@/lib/token-crypto';

export const TOOL_CONFIG_SEARCH_TOOLS = ['tavily', 'exa', 'own'] as const;
type ToolConfigSearchTool = (typeof TOOL_CONFIG_SEARCH_TOOLS)[number];

export const TOOL_CONFIG_STOCK_SOURCES = ['pexels', 'pixabay', 'coverr'] as const;
type ToolConfigStockSource = (typeof TOOL_CONFIG_STOCK_SOURCES)[number];

const TOOL_CONFIG_KEY_NAMES = ['tavily', 'exa', 'pexels', 'pixabay', 'coverr'] as const;
type ToolConfigKeyName = (typeof TOOL_CONFIG_KEY_NAMES)[number];

type ToolConfigKeys = Partial<Record<ToolConfigKeyName, string>>;

export interface ToolConfigInput {
  searchTool: ToolConfigSearchTool | null;
  stockSources: ToolConfigStockSource[];
  keys: ToolConfigKeys;
}

export interface ToolConfig {
  searchTool: ToolConfigSearchTool | null;
  stockSources: ToolConfigStockSource[];
  keys: ToolConfigKeys;
}

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

export function validateToolConfigInput(value: unknown): ToolConfigInput {
  if (!isRecord(value)) {
    throw new ToolConfigValidationError('config', 'Tool configuration must be an object');
  }

  const searchTool = value.searchTool;
  if (searchTool !== null && searchTool !== 'tavily' && searchTool !== 'exa' && searchTool !== 'own') {
    throw new ToolConfigValidationError(
      'searchTool',
      'searchTool must be "tavily", "exa", "own", or null',
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
    data.search_tool === 'tavily' || data.search_tool === 'exa' || data.search_tool === 'own'
      ? data.search_tool
      : null;
  const stockSources = (Array.isArray(data.stock_sources) ? data.stock_sources : []).filter(
    (source): source is ToolConfigStockSource =>
      source === 'pexels' || source === 'pixabay' || source === 'coverr',
  );

  let keys: ToolConfigKeys;
  try {
    keys = parseStoredKeys(data.encrypted_keys);
  } catch (error) {
    if (error instanceof TokenDecryptError) {
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
