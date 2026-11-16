import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// contracts shared-source guard: the MCP copies must be generated from
// shared/contracts/*.ts (HEADER + shared, with endpoint.ts inlined into
// the other contracts so webpack needs no relative import), never
// hand-maintained. The sync runs on pretest, so a drift means the file
// was edited by hand: run `node scripts/sync-contracts.mjs`.
function findRepoRoot(fromUrl: string): string {
  let dir = dirname(fileURLToPath(fromUrl));
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`findRepoRoot: pnpm-workspace.yaml not found above ${fromUrl}`);
    }
    dir = parent;
  }
}

const HEADER = '// GENERATED from shared/contracts — do not edit.\n// Run `node scripts/sync-contracts.mjs` from the repo root to regenerate.\n';

describe('contracts shared source', () => {
  it('generates every shared contract with the header and no relative imports', () => {
    const root = findRepoRoot(import.meta.url);
    const sharedDir = join(root, 'shared', 'contracts');
    const files = readdirSync(sharedDir).filter((name) => name.endsWith('.ts'));
    expect(files).toContain('endpoint.ts');
    expect(files).toContain('experiments.ts');
    const endpointBody = readFileSync(join(sharedDir, 'endpoint.ts'), 'utf8').replace(/import \{ z \} from 'zod';\n/, '');
    for (const file of files) {
      const shared = readFileSync(join(sharedDir, file), 'utf8');
      const generated = readFileSync(join(root, 'apps', 'mcp', 'src', 'contracts', file), 'utf8');
      const expected = file === 'endpoint.ts'
        ? HEADER + shared
        : HEADER + shared.replace(/import \{[^}]*\} from '\.\/endpoint\.js';\n/, endpointBody);
      expect(generated.startsWith(HEADER)).toBe(true);
      expect(generated.includes("from './endpoint.js'")).toBe(false);
      expect(generated).toBe(expected);
      // The MCP copies keep the `.js` suffix on cross-contract imports:
      // NodeNext requires it, and the web copies drop it for webpack.
      for (const match of shared.matchAll(/from '\.\/([a-z0-9-]+)\.js'/g)) {
        if (match[1] === 'endpoint') continue;
        expect(generated).toContain(`from './${match[1]}.js'`);
      }
    }
  });
});
