// House voices copy guard: the MCP copy of the house voice catalog must be
// a generated copy of the engine's voice_catalog.json (name + label, same
// order). This test fails loudly (instead of silently routing unknown
// voices) whenever the copy drifts. The MCP published tarball cannot read
// apps/engine at runtime (self-contained; same reason as
// script-segments-shared / prompts-sync), so paths resolve with
// findRepoRoot like those precedents.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOUSE_VOICES } from '../persona-voice.js';

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
