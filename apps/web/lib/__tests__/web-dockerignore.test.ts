/**
 * @vitest-environment node
 */

//---------------
// web-dockerignore — the web image builds from the monorepo root, so its
// Dockerfile-specific ignore file must keep host build artefacts out of
// `COPY apps/web ./apps/web`; a host node_modules copied over the image's
// fresh install broke every prod web build from 2026-10-23.
//---------------

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
