import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOUSE_VOICES } from '../voice-filters.js';

function findRepoRoot(fromUrl: string): string {
  let dir = dirname(fileURLToPath(fromUrl));
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`findRepoRoot: pnpm-workspace.yaml not found above ${fromUrl}`);
    }
    dir = parent;
  }
}

interface EngineVoice {
  name?: unknown;
  label?: unknown;
}

const root = findRepoRoot(import.meta.url);
const catalog = JSON.parse(
  readFileSync(
    join(root, 'apps', 'engine', 'app', 'services', 'voice_catalog.json'),
    'utf8',
  ),
) as { voices?: EngineVoice[] };

describe('MCP house voices sync with the engine catalog', () => {
  it('engine catalog parsed with at least one voice', () => {
    expect(Array.isArray(catalog.voices) && catalog.voices.length > 0).toBe(true);
  });

  it('copy has exactly 65 house voices in engine-catalog order', () => {
    expect(HOUSE_VOICES).toHaveLength(65);
    expect(HOUSE_VOICES.map((v) => v.name)).toEqual(
      catalog.voices?.map((v) => v.name),
    );
  });

  it('labels match the engine catalog byte-for-byte', () => {
    expect(HOUSE_VOICES.map((v) => v.label)).toEqual(
      catalog.voices?.map((v) => v.label),
    );
  });
});
