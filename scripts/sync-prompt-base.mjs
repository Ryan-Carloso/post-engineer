// Sync the generated prompt-base copies from the shared source.
//
// Single source of truth: shared/prompt-base/prompt-base.ts.
// Generated copies (byte-identical, committed so a fresh checkout builds
// and tests without running this first):
//   apps/web/lib/generation/prompt-base.ts
//   apps/mcp/src/prompt-base.ts
//
// Why copies instead of a direct import or a workspace package: the same
// reason as scripts/sync-script-segments.mjs — the MCP tsconfig has
// rootDir ./src and the web tsconfig has rootDir ./ (apps/web), so
// neither accepts an import from the repo root, and an unpublished
// workspace package would break a standalone MCP install from npm.
//
// Wiring: the per-app prompt-base-shared tests fail loudly if a copy
// ever drifts, so run this script after editing the shared source.
// It is deliberately NOT wired into prebuild/pretest: both apps'
// package.json files are guard-protected paths, and auto-regeneration
// is a convenience, not a correctness requirement.
// Usage: node scripts/sync-prompt-base.mjs [--check]
//   --check  exit 1 (without writing) when any copy differs from shared.
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const shared = join(root, 'shared', 'prompt-base', 'prompt-base.ts');
const targets = [
  join(root, 'apps', 'web', 'lib', 'generation', 'prompt-base.ts'),
  join(root, 'apps', 'mcp', 'src', 'prompt-base.ts'),
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
  console.error('Generated prompt-base copies drift from shared/prompt-base/prompt-base.ts.');
  console.error('Run: node scripts/sync-prompt-base.mjs');
  process.exit(1);
}
