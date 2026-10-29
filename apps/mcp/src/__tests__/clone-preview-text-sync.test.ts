// Pins the cloned-voice preview text cap to the same literal in all three
// apps (AGENTS.md: pin the same literal everywhere it lives). Each app keeps
// its own constant because the MCP tarball and the engine cannot import the
// web app; this test parses the three source files instead.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLONE_PREVIEW_TEXT_MAX_CHARS } from '../limits.js';

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
});
