// Sync the generated musicMood-field copies from the shared source.
//
// Single source of truth: shared/music-mood-field/music-mood-field.ts.
// Generated copies (byte-identical, committed so a fresh checkout builds
// and tests without running this first):
//   apps/web/lib/generation/music-mood-field.ts
//   apps/mcp/src/music-mood-field.ts
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
// Wiring: apps/mcp and apps/web prebuild and pretest run
// scripts/sync-script-segments.mjs, which runs this script afterwards
// and forwards --check. This script is not named in those package.json
// files: they are guarded by the parity-exclusion gate. The per-app
// sync tests (music-mood-field-shared.test.ts) fail loudly if a copy
// ever drifts.
// Usage: node scripts/sync-music-mood-field.mjs [--check]
//   --check  exit 1 (without writing) when any copy differs from shared.
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const shared = join(root, 'shared', 'music-mood-field', 'music-mood-field.ts');
const targets = [
  join(root, 'apps', 'web', 'lib', 'generation', 'music-mood-field.ts'),
  join(root, 'apps', 'mcp', 'src', 'music-mood-field.ts'),
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
  console.error('Generated music-mood-field copies drift from shared/music-mood-field/music-mood-field.ts.');
  console.error('Run: node scripts/sync-music-mood-field.mjs');
  process.exit(1);
}
