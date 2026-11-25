// @vitest-environment node
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROTECTED_PREFIXES, isProtectedPath } from '@/lib/protected-routes';
import { PUBLIC_PAGES } from '@/lib/seo';
import { appRouteSegments, groupServesRoot } from '@/test/app-route-segments';
import { findRepoRoot } from '@/test/repo-root';

const PUBLIC_TOP_LEVEL_DIRECTORIES: readonly string[] = [
  '/.well-known',
  '/api',
  '/auth',
  '/landing',
  '/login',
  '/mcp',
  '/oauth',
  '/privacy',
  '/recipes',
  '/s',
  '/terms',
];

describe('PROTECTED_PREFIXES', () => {
  it('lists exactly the top-level segments served by app/(main)', () => {
    expect([...PROTECTED_PREFIXES].sort()).toEqual(appRouteSegments(import.meta.url, '(main)'));
  });

  it('keeps / protected because app/(main)/page.tsx serves it', () => {
    expect(groupServesRoot(import.meta.url, '(main)')).toBe(true);
    expect(isProtectedPath('/')).toBe(true);
  });

  it('has no route group other than (main), so a new group must be classified here first', () => {
    const appDir = join(findRepoRoot(import.meta.url), 'apps', 'web', 'app');
    const groups = readdirSync(appDir)
      .filter((entry) => statSync(join(appDir, entry)).isDirectory())
      .filter((entry) => entry.startsWith('(') && entry.endsWith(')'))
      .sort();
    expect(groups).toEqual(['(main)']);
  });

  it('classifies every top-level app directory outside (main) as public', () => {
    const appDir = join(findRepoRoot(import.meta.url), 'apps', 'web', 'app');
    const outside = readdirSync(appDir)
      .filter((entry) => statSync(join(appDir, entry)).isDirectory())
      .filter((entry) => !entry.startsWith('(') && !entry.startsWith('_'))
      .map((entry) => `/${entry}`)
      .sort();
    expect(outside).toEqual([...PUBLIC_TOP_LEVEL_DIRECTORIES].sort());
    for (const segment of outside) {
      expect(PROTECTED_PREFIXES as readonly string[]).not.toContain(segment);
      expect(isProtectedPath(segment)).toBe(false);
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
