// @vitest-environment node
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROTECTED_PREFIXES, isProtectedPath } from '@/lib/protected-routes';
import { PUBLIC_PAGES } from '@/lib/seo';
import { appRouteSegments, groupServesRoot } from '@/test/app-route-segments';
import { findRepoRoot } from '@/test/repo-root';

describe('PROTECTED_PREFIXES', () => {
  it('lists exactly the top-level segments served by app/(main)', () => {
    expect([...PROTECTED_PREFIXES].sort()).toEqual(appRouteSegments(import.meta.url, '(main)'));
  });

  it('keeps / protected because app/(main)/page.tsx serves it', () => {
    expect(groupServesRoot(import.meta.url, '(main)')).toBe(true);
    expect(isProtectedPath('/')).toBe(true);
  });

  it('never overlaps a top-level route directory outside (main)', () => {
    const appDir = join(findRepoRoot(import.meta.url), 'apps', 'web', 'app');
    const outside = readdirSync(appDir)
      .filter((entry) => statSync(join(appDir, entry)).isDirectory())
      .filter((entry) => !entry.startsWith('(') && !entry.startsWith('_'))
      .map((entry) => `/${entry}`);
    expect(outside.length).toBeGreaterThan(0);
    for (const segment of outside) {
      expect(PROTECTED_PREFIXES as readonly string[]).not.toContain(segment);
    }
  });

  it('never protects a public page', () => {
    for (const page of PUBLIC_PAGES) {
      expect(isProtectedPath(page)).toBe(false);
    }
  });
});

describe('isProtectedPath', () => {
  it.each(['/', '/posts', '/posts/abc', '/personas/new', '/billing', '/metrics/x'])(
    'protects %s',
    (pathname) => {
      expect(isProtectedPath(pathname)).toBe(true);
    },
  );

  it.each(['/postsx', '/landing-v2', '/unknown', '/landing', '/login', '/recipes/a', '/s/abc'])(
    'leaves %s unprotected',
    (pathname) => {
      expect(isProtectedPath(pathname)).toBe(false);
    },
  );
});
