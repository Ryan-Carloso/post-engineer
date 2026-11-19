/**
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

function ignoreLines(): string[] {
  const text = readFileSync(
    join(findRepoRoot(import.meta.url), 'apps', 'web', 'Dockerfile.dockerignore'),
    'utf8',
  );
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

describe('web Dockerfile.dockerignore', () => {
  it('keeps host node_modules and Next build output out of the build context', () => {
    const lines = ignoreLines();
    expect(lines).toContain('**/node_modules');
    expect(lines).toContain('**/.next');
  });

  it('does not ignore apps/web/.env, which the build inlines NEXT_PUBLIC_* from', () => {
    const lines = ignoreLines();
    for (const line of lines) {
      expect(line.includes('.env'), `pattern ${line} would drop apps/web/.env`).toBe(false);
    }
  });
});
