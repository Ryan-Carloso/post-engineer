/**
 * @vitest-environment node
 */

// contracts shared-source guard: the web copies must be generated from
// shared/contracts/*.ts (HEADER + shared, with endpoint.ts inlined into
// the other contracts so webpack needs no relative import), never
// hand-maintained. The sync runs on pretest, so a drift means the file
// was edited by hand: run `node scripts/sync-contracts.mjs`.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

const HEADER = '// GENERATED from shared/contracts — do not edit.\n// Run `node scripts/sync-contracts.mjs` from the repo root to regenerate.\n';

describe('contracts shared source', () => {
  it('generates every shared contract with the header and no relative imports', () => {
    const root = findRepoRoot(import.meta.url);
    const sharedDir = join(root, 'shared', 'contracts');
    const files = readdirSync(sharedDir).filter((name: string) => name.endsWith('.ts'));
    expect(files).toContain('endpoint.ts');
    expect(files).toContain('experiments.ts');
    const endpointBody = readFileSync(join(sharedDir, 'endpoint.ts'), 'utf8').replace(/import \{ z \} from 'zod';\n/, '');
    for (const file of files) {
      const shared = readFileSync(join(sharedDir, file), 'utf8');
      const generated = readFileSync(join(root, 'apps', 'web', 'lib', 'contracts', file), 'utf8');
      const expected = file === 'endpoint.ts'
        ? HEADER + shared
        : HEADER + shared.replace(/import \{[^}]*\} from '\.\/endpoint\.js';\n/, endpointBody);
      expect(generated.startsWith(HEADER)).toBe(true);
      expect(generated.includes("from './endpoint.js'")).toBe(false);
      expect(generated).toBe(expected);
    }
  });
});
