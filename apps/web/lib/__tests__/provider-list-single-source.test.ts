import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOCIAL_PROVIDERS } from '@/lib/contracts/providers';
import { findRepoRoot } from '@/test/repo-root';

//---------------
// The list of social networks exists once: shared/contracts/providers.ts.
// Every web, MCP and script source imports it. This guard fails when a
// source types the whole list again, as an array literal or as a string
// union, in any order: each of fanvue, 3speak and rumble once needed edits
// in about 25 such copies, and a missed copy rejected the new network in
// one tool only (the MCP connect action never accepted pinterest).
// A subset of the networks (a fact of its own, such as which networks
// connect directly) is not a copy and is not flagged.
//---------------

const root = findRepoRoot(import.meta.url);

const SCANNED_DIRS = ['apps/web', 'apps/mcp/src', 'scripts', 'shared'];
const SKIPPED_DIRS = new Set(['node_modules', '.next', '.stryker-tmp', '__tests__', 'coverage', 'coverage-unit', 'reports', 'dist', 'public', 'cypress']);
const SKIPPED_FILES = new Set([
  'shared/contracts/providers.ts',
  // Generated from the database schema, whose check constraints carry the
  // list in SQL (pinned by migration-check-constraints-sync.test.ts).
  'apps/web/lib/supabase/database.gen.ts',
]);
// Generated copies of shared/contracts (gitignored, synced before tests).
const GENERATED_DIRS = ['apps/web/lib/contracts/', 'apps/mcp/src/contracts/'];
const SOURCE_FILE = /\.(ts|tsx|mts|mjs|js)$/;
const TEST_FILE = /\.(test|spec|cy)\.(ts|tsx)$/;

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (SOURCE_FILE.test(name) && !TEST_FILE.test(name)) {
      files.push(path);
    }
  }
  return files;
}

const ARRAY_LITERAL = /\[([^[\]]*)\]/g;
const STRING_UNION = /'[a-z0-9]+'(?:\s*\|\s*'[a-z0-9]+')+/g;
const QUOTED = /'([a-z0-9]+)'/g;

/** Every array literal or string union in `text` that lists exactly the providers. */
function providerListCopies(text: string): string[] {
  const expected = [...SOCIAL_PROVIDERS].sort().join(',');
  const candidates = [...text.matchAll(ARRAY_LITERAL)].map((match) => match[1]).concat([...text.matchAll(STRING_UNION)].map((match) => match[0]));
  return candidates.filter((candidate) => {
    const members = [...new Set([...candidate.matchAll(QUOTED)].map((match) => match[1]))].sort().join(',');
    return members === expected;
  });
}

describe('one provider list (shared/contracts/providers.ts)', () => {
  it('flags an array copy and a union copy in any order, not a subset', () => {
    expect(providerListCopies("const P = ['rumble', 'youtube', 'instagram', 'bluesky', 'linkedin', 'threads', 'facebook', 'pinterest', '3speak', 'fanvue', 'telegram'];")).toHaveLength(1);
    expect(providerListCopies("type P = 'youtube' | 'instagram' | 'bluesky' | 'linkedin' | 'threads' | 'facebook' | 'pinterest' | '3speak' | 'rumble' | 'fanvue' | 'telegram';")).toHaveLength(1);
    expect(providerListCopies("const D = ['bluesky', '3speak', 'rumble', 'telegram'] as const;")).toHaveLength(0);
  });

  it('has no hand-typed copy of the list in any web, MCP or script source', () => {
    const offenders: string[] = [];
    for (const dir of SCANNED_DIRS) {
      for (const path of sourceFiles(join(root, dir))) {
        const rel = relative(root, path).split('\\').join('/');
        if (SKIPPED_FILES.has(rel) || GENERATED_DIRS.some((generated) => rel.startsWith(generated))) continue;
        if (providerListCopies(readFileSync(path, 'utf8')).length > 0) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('still finds the list in its one home', () => {
    // Pins the scanner itself: if it stopped matching, the guard above
    // would pass vacuously.
    expect(providerListCopies(readFileSync(join(root, 'shared/contracts/providers.ts'), 'utf8'))).toHaveLength(1);
  });
});
