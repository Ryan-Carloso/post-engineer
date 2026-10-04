//---------------
// findRepoRoot — resolve the monorepo root from any test file.
//
// Several suites read repo-level fixtures (supabase migrations, public/,
// route sources). They used to climb a FIXED number of `..` segments from
// `import.meta.url`, which breaks whenever the tests run from a directory
// nested deeper than the repo layout — e.g. Stryker's sandbox
// (`.stryker-tmp/sandbox-<n>/`). Instead, walk up until the
// `pnpm-workspace.yaml` marker is found.
//---------------
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Absolute path of the monorepo root (the directory containing
 * pnpm-workspace.yaml), starting the search at the calling test file.
 */
export function findRepoRoot(fromUrl: string): string {
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
