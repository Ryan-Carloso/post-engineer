import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';

const root = findRepoRoot(import.meta.url);
const webRoot = join(root, 'apps', 'web');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return ['node_modules', '__tests__', '.next', 'cypress', '.stryker-tmp'].includes(entry.name) ? [] : sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const READERS_OF_THE_COLUMN = [
  'app/api/persona/create-row.ts',
  'app/api/persona/identity-card/route.ts',
  'app/api/persona/patch-updates.ts',
  'lib/api-telemetry-names.ts',
  'lib/schema-expectations.gen.ts',
  'lib/supabase/database.gen.ts',
];

describe('the identity card column stays private', () => {
  it('is named only by the create row, the patch update, the owner-checked route, the event labels and the generated files', () => {
    const files = [...sourceFiles(join(webRoot, 'app')), ...sourceFiles(join(webRoot, 'lib'))]
      .filter((file) => readFileSync(file, 'utf8').includes('identity_card'))
      .map((file) => relative(webRoot, file))
      .sort();
    expect(files).toEqual(READERS_OF_THE_COLUMN);
  });

  it('is not selected by the persona list', () => {
    const list = readFileSync(join(webRoot, 'app/api/persona/list/route.ts'), 'utf8');
    expect(list).not.toContain('identity_card');
    expect(list).not.toContain('identityCard');
  });

  it('is not part of the persona list contract', () => {
    const contract = readFileSync(join(root, 'shared/contracts/personas.ts'), 'utf8');
    expect(contract).not.toMatch(/identity[_]?[cC]ard/);
  });
});
