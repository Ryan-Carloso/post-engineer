//---------------
// prepare-bun-tsconfig — a tsconfig `bun check` can read.
//
// `bun check` is the TypeScript 7 checker. TypeScript 7 removed `baseUrl`
// (TS5102) and stops before checking any file when the option is present.
// Next.js and `tsc` 5.9 still use `baseUrl` for the `@/*` paths, so the
// committed tsconfig keeps it. This writes a sibling config with that one
// option removed. The paths already start with `./`, which is what
// TypeScript 7 resolves them against.
//---------------

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * @param {unknown} tsconfig
 */
export function configForBunCheck(tsconfig) {
  if (typeof tsconfig !== 'object' || tsconfig === null) {
    throw new Error('tsconfig must be an object');
  }
  const clone = /** @type {{ compilerOptions?: Record<string, unknown> }} */ (
    structuredClone(tsconfig)
  );
  if (typeof clone.compilerOptions === 'object' && clone.compilerOptions !== null) {
    delete clone.compilerOptions.baseUrl;
  }
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
