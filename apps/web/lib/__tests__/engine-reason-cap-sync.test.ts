import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

describe('engine reason caps', () => {
  it('pins the MCP error cap to the web sanitiser cap', () => {
    const root = findRepoRoot(import.meta.url);
    const errors = readFileSync(join(root, 'apps', 'mcp', 'src', 'errors.ts'), 'utf8');
    expect(errors).toContain('const MAX_ERROR_BODY_CHARS = 200;');
    const scrub = readFileSync(join(root, 'apps', 'web', 'lib', 'scrub.ts'), 'utf8');
    expect(scrub).toContain('ENGINE_REASON_MAX_CHARS = 200');
  });
});
