import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const BUN_CSS_DECLARATION = '../../.github/scripts/frontend-ci/css-side-effect.d.ts';

export function configForBunCheck(tsconfig) {
  if (typeof tsconfig !== 'object' || tsconfig === null) {
    throw new Error('tsconfig must be an object');
  }
  const clone = (
    structuredClone(tsconfig)
  );
  if (typeof clone.compilerOptions === 'object' && clone.compilerOptions !== null) {
    delete clone.compilerOptions.baseUrl;
  }
  const include = Array.isArray(clone.include) ? clone.include.filter((item) => typeof item === 'string') : [];
  if (!include.includes(BUN_CSS_DECLARATION)) include.push(BUN_CSS_DECLARATION);
  clone.include = include;
  return clone;
}

function main() {
  const inIndex = process.argv.indexOf('--in');
  const outIndex = process.argv.indexOf('--out');
  if (inIndex === -1 || outIndex === -1 || inIndex + 1 >= process.argv.length || outIndex + 1 >= process.argv.length) {
    process.stderr.write('Usage: node prepare-bun-tsconfig.mjs --in <tsconfig.json> --out <tsconfig.bun.json>\n');
    process.exit(1);
  }
  const source = JSON.parse(readFileSync(process.argv[inIndex + 1], 'utf8'));
  const next = configForBunCheck(source);
  writeFileSync(process.argv[outIndex + 1], `${JSON.stringify(next, null, 2)}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
