// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

//---------------
// Guard for the Web API rule in the root AGENTS.md:
//
//   "Service-role bypasses RLS: re-check ownership explicitly (comment at
//    each site). API-key **and** OAuth callers take the service-client
//    branch (`isApiKey === true || isOAuth === true`)."
//
// OAuth callers (the remote MCP) have no cookie session, so the cookie
// Supabase client sees no user and RLS hides every row. A route that picks
// the service client on `auth.isApiKey === true` alone silently returns
// empty data (or no-ops a delete) for them. This test scans every route
// handler for that bare form.
//---------------

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
