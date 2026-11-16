// Sync the generated endpoint-contract copies from the shared sources.
//
// Single source of truth: shared/contracts/*.ts.
// Generated copies (gitignored, regenerated on postinstall, typecheck,
// prebuild and pretest so a fresh checkout builds without manual steps):
//   apps/web/lib/contracts/<name>.ts
//   apps/mcp/src/contracts/<name>.ts
//
// Why generated copies instead of a direct import or a workspace package:
//   - The MCP tsconfig has rootDir ./src, so tsc rejects an import of a
//     file outside src (TS6059); the web tsconfig has rootDir ./ (apps/web),
//     so it rejects an import from the repo root the same way.
//   - A workspace package that is not published would break a standalone
//     MCP install from npm: the dependency would be missing at runtime.
//     The copies land inside each app's own build output instead, so the
//     published MCP tarball (files: ["dist"]) stays self-contained.
//
// Each generated file carries a "GENERATED from shared/contracts" header.
// Generated copies are gitignored (unlike script-segments/music-mood,
// which are committed): the sync runs before typecheck/build/test, so a
// contract rename fails `pnpm typecheck` in BOTH apps in the same change
// even though only the shared file is committed.
//
// endpoint.ts is inlined into every other contract file instead of being
// imported (`./endpoint.js` resolves under `tsc` in both apps but Next's
// webpack cannot resolve it), so generated files have no relative imports.
// endpoint.ts itself is still generated for `BodyOf`/`ResponseOf` imports.
// The same webpack rule applies to cross-contract imports (`./metrics.js`
// in the shared source): the MCP copies keep the `.js` suffix (NodeNext
// requires it), but the web copies drop it (`./metrics`), which both
// `tsc` (bundler resolution) and Next's webpack resolve to the `.ts` file.
// Usage: node scripts/sync-contracts.mjs [--check]
//   --check  exit 1 (without writing) when any copy differs from shared.
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sharedDir = join(root, 'shared', 'contracts');
const checkOnly = process.argv.includes('--check');

const targets = [
  join(root, 'apps', 'web', 'lib', 'contracts'),
  join(root, 'apps', 'mcp', 'src', 'contracts'),
];

const HEADER = '// GENERATED from shared/contracts — do not edit.\n// Run `node scripts/sync-contracts.mjs` from the repo root to regenerate.\n';

const sources = readdirSync(sharedDir).filter((name) => name.endsWith('.ts')).sort();
const endpointSource = existsSync(join(sharedDir, 'endpoint.ts'))
  ? readFileSync(join(sharedDir, 'endpoint.ts'), 'utf8')
  : '';
const endpointBody = endpointSource.replace(/import \{ z \} from 'zod';\n/, '');
function expectedFor(sourceName, forWeb) {
  const shared = readFileSync(join(sharedDir, sourceName), 'utf8');
  if (sourceName === 'endpoint.ts') return HEADER + shared;
  const withoutEndpointImport = shared.replace(/import \{[^}]*\} from '\.\/endpoint\.js';\n/, endpointBody);
  // Webpack cannot resolve a `./name.js` import to `name.ts`; drop the
  // suffix in web copies only (the MCP copies keep it for NodeNext).
  const text = forWeb
    ? withoutEndpointImport.replace(/from '\.\/([a-z0-9-]+)\.js'/g, "from './$1'")
    : withoutEndpointImport;
  return HEADER + text;
}
let drifted = false;

for (const targetDir of targets) {
  // Partial checkouts (e.g. the web Docker build context, which copies only
  // apps/web) do not contain every target app. Skip those instead of failing
  // when the app directory is absent.
  const appDir = dirname(dirname(targetDir));
  if (!existsSync(appDir)) {
    console.log(`skipped ${targetDir} (app not present in this checkout)`);
    continue;
  }
  if (!checkOnly) {
    mkdirSync(targetDir, { recursive: true });
  }
  for (const source of sources) {
    const forWeb = targetDir.includes(`${join('apps', 'web')}`);
    const expected = expectedFor(source, forWeb);
    const target = join(targetDir, source);
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
  // Remove generated files whose shared source no longer exists.
  if (existsSync(targetDir)) {
    for (const file of readdirSync(targetDir)) {
      if (!file.endsWith('.ts')) continue;
      if (sources.includes(file)) continue;
      if (checkOnly) {
        drifted = true;
        console.log(`drifted ${join(targetDir, file)} (no shared source)`);
        continue;
      }
      unlinkSync(join(targetDir, file));
      console.log(`removed ${join(targetDir, file)}`);
    }
  }
}
if (checkOnly && drifted) {
  console.error('Generated contract copies drift from shared/contracts/*.ts.');
  console.error('Run: node scripts/sync-contracts.mjs');
  process.exit(1);
}
