// Sync the generated segments-validation copies from the shared source.
//
// Single source of truth: shared/script-segments/script-segments.ts.
// Generated copies (byte-identical, committed so a fresh checkout builds
// and tests without running this first):
//   apps/web/lib/generation/script-segments.ts
//   apps/mcp/src/script-segments.ts
//
// Why copies instead of a direct import or a workspace package:
//   - The MCP tsconfig has rootDir ./src, so tsc rejects an import of a
//     file outside src (TS6059); the web tsconfig has rootDir ./ (apps/web),
//     so it rejects an import from the repo root the same way.
//   - A workspace package that is not published would break a standalone
//     MCP install from npm: the dependency would be missing at runtime.
//     The copies land inside each app's own build output instead, so the
//     published MCP tarball (files: ["dist"]) stays self-contained.
//
// Wiring: apps/mcp and apps/web both run this from their prebuild and
// pretest scripts, so `pnpm build` and `pnpm test` always regenerate
// before compiling or testing. The per-app sync tests
// (script-segments-shared.test.ts) fail loudly if a copy ever drifts.
// Usage: node scripts/sync-script-segments.mjs [--check]
//   --check  exit 1 (without writing) when any copy differs from shared.
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const shared = join(root, 'shared', 'script-segments', 'script-segments.ts');
const targets = [
  join(root, 'apps', 'web', 'lib', 'generation', 'script-segments.ts'),
  join(root, 'apps', 'mcp', 'src', 'script-segments.ts'),
];
const checkOnly = process.argv.includes('--check');

const source = readFileSync(shared, 'utf8');
let drifted = false;
for (const target of targets) {
  // Partial checkouts (e.g. the web Docker build context, which copies only
  // apps/web) do not contain every target app. Skip those instead of failing
  // when copyFileSync cannot create the missing parent directory.
  if (!existsSync(dirname(target))) {
    console.log(`skipped ${target} (app not present in this checkout)`);
    continue;
  }
  let current = undefined;
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    current = undefined;
  }
  if (current === source) {
    console.log(`unchanged ${target}`);
    continue;
  }
  drifted = true;
  if (checkOnly) {
    console.log(`drifted ${target}`);
    continue;
  }
  copyFileSync(shared, target);
  console.log(`synced ${target}`);
}
if (checkOnly && drifted) {
  console.error('Generated script-segments copies drift from shared/script-segments/script-segments.ts.');
  console.error('Run: node scripts/sync-script-segments.mjs');
  process.exit(1);
}
