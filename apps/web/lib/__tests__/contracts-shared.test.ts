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
import { METRICS_WINDOWS } from '@/lib/contracts/experiments';
import { PUBLISH_PROVIDERS } from '@/lib/contracts/posts';

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

  // The contract carries its own METRICS_WINDOWS copy (the route's
  // `?window=` validation used to import it straight from
  // metrics-query.ts). A one-sided edit would make the detail route 400 a
  // window the metrics layer supports, so the copy is pinned here.
  it('pins the shared METRICS_WINDOWS to metrics-query.ts', () => {
    const root = findRepoRoot(import.meta.url);
    const metricsQuery = readFileSync(join(root, 'apps', 'web', 'lib', 'metrics', 'metrics-query.ts'), 'utf8');
    const list = METRICS_WINDOWS.map((window) => `'${window}'`).join(', ');
    expect(metricsQuery).toContain(`export const METRICS_WINDOWS = [${list}] as const;`);
  });

  // The contract carries its own PUBLISH_PROVIDERS copy (the publish-link
  // builder drops any other provider before a link is built). A one-sided
  // edit would make the contract reject a link the route serves, so the
  // copy is pinned here against the PublishProvider union the PROVIDERS
  // set is built from.
  it('pins the shared PUBLISH_PROVIDERS to publish-links.ts', () => {
    const root = findRepoRoot(import.meta.url);
    const publishLinks = readFileSync(join(root, 'apps', 'web', 'lib', 'publish-links.ts'), 'utf8');
    const list = PUBLISH_PROVIDERS.map((provider) => `'${provider}'`).join(' | ');
    expect(publishLinks).toContain(`export type PublishProvider = ${list};`);
  });
});
