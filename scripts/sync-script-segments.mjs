// Sync the generated segments-validation copies from the shared source.
//
// Single source of truth: shared/script-segments/*.ts. Each shared module
// has generated copies (committed so a fresh checkout builds and tests
// without running this first):
//   shared/script-segments/script-segments.ts
//     -> apps/web/lib/generation/script-segments.ts
//     -> apps/mcp/src/script-segments.ts
//   shared/script-segments/segment-media.ts
//     -> apps/web/lib/generation/segment-media.ts
//     -> apps/mcp/src/segment-media.ts
//   shared/script-segments/segment-text.ts
//     -> apps/web/lib/generation/segment-text.ts
//     -> apps/mcp/src/segment-text.ts
//
// The MCP copies are byte-identical to shared. The web copy of
// script-segments.ts is the shared text with the `.js` suffix stripped
// from its relative sibling imports (`./segment-media.js` ->
// `./segment-media`): the MCP's NodeNext tsc requires the `.js` suffix
// (TS2835 without it), but the web's Next.js webpack build fails with
// "Module not found: Can't resolve './segment-media.js'" on the same
// suffix, because webpack resolves an explicit `.js` extension
// literally and there is no `.js` file. The sibling helper copies have
// no imports, so they are byte-identical in both apps.
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
// before compiling or testing. This script then runs
// sync-music-mood-field.mjs and sync-contracts.mjs and forwards
// --check. Those syncs are not named in either package.json: those
// files are guarded by the parity-exclusion gate. The per-app sync
// tests (script-segments-shared.test.ts) fail loudly if a copy ever
// drifts.
// Usage: node scripts/sync-script-segments.mjs [--check]
//   --check  exit 1 (without writing) when any copy differs from shared.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sharedDir = join(root, 'shared', 'script-segments');
const files = ['script-segments.ts', 'segment-media.ts', 'segment-text.ts'].map((name) => ({
  source: join(sharedDir, name),
  targets: [
    join(root, 'apps', 'web', 'lib', 'generation', name),
    join(root, 'apps', 'mcp', 'src', name),
  ],
}));
const checkOnly = process.argv.includes('--check');

// The web copy of script-segments.ts drops the `.js` suffix from its
// relative sibling imports: Next.js webpack resolves an explicit `.js`
// extension literally and fails the production build, while the MCP's
// NodeNext tsc requires it. Only `from './<name>.js'` spellings are
// rewritten; every other line (including comments) is untouched.
function toWebCopy(sourceText) {
  return sourceText.replaceAll(/from '(\.\/[^']+)\.js'/g, "from '$1'");
}

// Exact-path comparison on purpose: `target` is absolute, so a substring
// check for 'apps/web' would also match a checkout rooted under a path
// containing it (e.g. /home/me/apps/web-tools/post-engineer) and would
// wrongly strip the MCP copy's `.js` suffix, breaking its NodeNext tsc.
const webScriptSegments = join(
  root,
  'apps',
  'web',
  'lib',
  'generation',
  'script-segments.ts',
);

let drifted = false;
for (const { source, targets } of files) {
  const sourceText = readFileSync(source, 'utf8');
  for (const target of targets) {
    const isWeb = target === webScriptSegments;
    const expected = isWeb ? toWebCopy(sourceText) : sourceText;
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
    if (current === expected) {
      console.log(`unchanged ${target}`);
      continue;
    }
    drifted = true;
    if (checkOnly) {
      console.log(`drifted ${target}`);
      continue;
    }
    writeFileSync(target, expected);
    console.log(`synced ${target}`);
  }
}
if (checkOnly && drifted) {
  console.error('Generated script-segments copies drift from shared/script-segments/*.ts.');
  console.error('Run: node scripts/sync-script-segments.mjs');
}

// Run after the script-segments report so a drift here does not hide a
// drift in the music-mood copies.
const music = spawnSync(
  process.execPath,
  [join(root, 'scripts', 'sync-music-mood-field.mjs'), ...(checkOnly ? ['--check'] : [])],
  { stdio: 'inherit' },
);
if (music.error) {
  console.error(music.error.message);
}
const musicFailed = music.status !== 0;
// Run after the music-mood report so a drift here does not hide a
// drift in the contract copies. A partial checkout predating the
// contracts sync has no sync-contracts.mjs yet; skip it there.
const contractsScript = join(root, 'scripts', 'sync-contracts.mjs');
let contractsFailed = false;
let contractsStatus = null;
if (!existsSync(contractsScript)) {
  console.log(`skipped ${contractsScript} (contracts sync not present in this checkout)`);
} else {
  const contracts = spawnSync(
    process.execPath,
    [contractsScript, ...(checkOnly ? ['--check'] : [])],
    { stdio: 'inherit' },
  );
  if (contracts.error) {
    console.error(contracts.error.message);
  }
  contractsFailed = contracts.status !== 0;
  contractsStatus = contracts.status;
}
if ((checkOnly && drifted) || musicFailed || contractsFailed) {
  const code =
    music.status !== 0 && music.status !== null ? music.status
    : contractsStatus !== 0 && contractsStatus !== null ? contractsStatus
    : 1;
  process.exit(code);
}
