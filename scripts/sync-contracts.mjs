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
  const text = forWeb
    ? withoutEndpointImport.replace(/from '\.\/([a-z0-9-]+)\.js'/g, "from './$1'")
    : withoutEndpointImport;
  return HEADER + text;
}
let drifted = false;

for (const targetDir of targets) {
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
