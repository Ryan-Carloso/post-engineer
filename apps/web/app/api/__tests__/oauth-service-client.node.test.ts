import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

const BARE_API_KEY_SERVICE_BRANCH = /auth\.isApiKey === true\s*\?\s*createSupabaseServiceClient\(/;

function listRouteFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      found.push(...listRouteFiles(join(dir, entry.name)));
    } else if (entry.name === 'route.ts') {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

describe('OAuth callers take the service client', () => {
  it('no route selects the service client on isApiKey alone', () => {
    const repoRoot = findRepoRoot(import.meta.url);
    const routes = listRouteFiles(join(repoRoot, 'apps/web/app/api'));
    expect(routes.length).toBeGreaterThan(20);

    const offenders = routes
      .filter((file) => BARE_API_KEY_SERVICE_BRANCH.test(readFileSync(file, 'utf8')))
      .map((file) => relative(repoRoot, file))
      .sort();

    expect(offenders).toEqual([]);
  });
});
