import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLONE_PREVIEW_TEXT_MAX_CHARS, HOUSE_PREVIEW_TEXT_MAX_CHARS } from '../limits.js';
import { PREVIEW_TEXT_MAX_CHARS } from '../contracts/voices.js';

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

const ENGINE = join('apps', 'engine', 'app', 'services', 'cloned_voices', 'preview_text.py');
const WEB = join('apps', 'web', 'app', 'api', 'persona', 'cloned-voices', '[cloneId]', 'preview', 'preview-text.ts');
const WEB_HOUSE = join('apps', 'web', 'app', 'api', 'persona', 'voices', '[voiceId]', 'preview', 'preview-text.ts');

describe('cloned-voice preview text cap', () => {
  it('is 300 in the MCP limits module', () => {
    expect(CLONE_PREVIEW_TEXT_MAX_CHARS).toBe(300);
  });

  it('is the same literal in the engine validator', () => {
    const source = readFileSync(join(findRepoRoot(import.meta.url), ENGINE), 'utf8');
    expect(source.includes(`CLONE_PREVIEW_TEXT_MAX_CHARS = ${CLONE_PREVIEW_TEXT_MAX_CHARS}\n`)).toBe(true);
  });

  it('is the same literal in the web preview route parser', () => {
    const source = readFileSync(join(findRepoRoot(import.meta.url), WEB), 'utf8');
    expect(source.includes(`export const CLONE_PREVIEW_TEXT_MAX_CHARS = ${CLONE_PREVIEW_TEXT_MAX_CHARS};`)).toBe(true);
  });

  it('is the same literal in the shared voices contract', () => {
    expect(PREVIEW_TEXT_MAX_CHARS).toBe(CLONE_PREVIEW_TEXT_MAX_CHARS);
  });
});

describe('house-voice preview text cap', () => {
  it('is 300 in the MCP limits module', () => {
    expect(HOUSE_PREVIEW_TEXT_MAX_CHARS).toBe(300);
  });

  it('is the same literal in the web house preview route parser', () => {
    const source = readFileSync(join(findRepoRoot(import.meta.url), WEB_HOUSE), 'utf8');
    expect(source.includes(`export const HOUSE_PREVIEW_TEXT_MAX_CHARS = ${HOUSE_PREVIEW_TEXT_MAX_CHARS};`)).toBe(true);
  });

  it('matches the cloned-voice cap it shares the validator with', () => {
    expect(HOUSE_PREVIEW_TEXT_MAX_CHARS).toBe(CLONE_PREVIEW_TEXT_MAX_CHARS);
  });
});
