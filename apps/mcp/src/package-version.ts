import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = 'post-engineer-mcp';

function parsePackage(path: string): { name?: unknown; version?: unknown } {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return typeof parsed === 'object' && parsed !== null ? parsed : {};
}

// The entry point sits at src/index.ts in tests and at
// dist/apps/mcp/src/index.js when built, so package.json is found by walking
// up to the file that names this package.
export function readPackageVersion(fromUrl: string = import.meta.url): string {
  let dir = dirname(fileURLToPath(fromUrl));
  for (;;) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      const pkg = parsePackage(candidate);
      if (pkg.name === PACKAGE_NAME && typeof pkg.version === 'string') return pkg.version;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`${PACKAGE_NAME} package.json not found above ${fromUrl}`);
    dir = parent;
  }
}
