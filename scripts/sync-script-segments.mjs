import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sharedDir = join(root, 'shared', 'script-segments');
const sharedFiles = ['script-segments.ts', 'segment-media.ts', 'segment-text.ts', 'hook-title.ts'];
const files = sharedFiles.map((name) => ({
  source: join(sharedDir, name),
  targets: [
    join(root, 'apps', 'web', 'lib', 'generation', name),
    join(root, 'apps', 'mcp', 'src', name),
  ],
}));
const checkOnly = process.argv.includes('--check');

function toWebCopy(sourceText) {
  return sourceText.replaceAll(/from '(\.\/[^']+)\.js'/g, "from '$1'");
}

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

const music = spawnSync(
  process.execPath,
  [join(root, 'scripts', 'sync-music-mood-field.mjs'), ...(checkOnly ? ['--check'] : [])],
  { stdio: 'inherit' },
);
if (music.error) {
  console.error(music.error.message);
}
const musicFailed = music.status !== 0;
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
