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
