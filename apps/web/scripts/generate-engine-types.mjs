// Generates apps/web/lib/engine/schema.gen.ts from the engine's committed
// OpenAPI snapshot (apps/engine/openapi.json, exported by
// apps/engine/scripts/export_openapi.py).
//
// The generated file is committed (like lib/generation/script-segments.ts)
// because the web Docker build context copies only apps/web: the engine
// snapshot is not there at build time. The drift test
// (lib/engine/__tests__/schema-gen.test.ts) regenerates in memory and fails
// when the committed file is stale.
//
// Run: node apps/web/scripts/generate-engine-types.mjs [--check]
//   --check  exit 1 (without writing) when the committed file is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const SNAPSHOT_PATH = join(root, 'apps/engine/openapi.json');
export const OUTPUT_PATH = join(root, 'apps/web/lib/engine/schema.gen.ts');

const HEADER = [
  '// GENERATED FILE — do not edit by hand.',
  '// Source: apps/engine/openapi.json (engine OpenAPI contract snapshot).',
  '// Regenerate: node apps/web/scripts/generate-engine-types.mjs',
  '',
  '',
].join('\n');

/**
 * Render the TypeScript types for an OpenAPI spec (parsed JSON object).
 * Pure apart from openapi-typescript itself: same spec in, same text out.
 */
export async function generateEngineTypes(spec) {
  const ast = await openapiTS(spec, { alphabetize: true, defaultNonNullable: false });
  return HEADER + astToString(ast);
}

async function main() {
  const spec = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  const text = await generateEngineTypes(spec);
  if (process.argv.includes('--check')) {
    let current;
    try {
      current = readFileSync(OUTPUT_PATH, 'utf8');
    } catch {
      current = undefined;
    }
    if (current !== text) {
      console.error(`stale ${OUTPUT_PATH} — run node apps/web/scripts/generate-engine-types.mjs`);
      process.exit(1);
    }
    console.log(`up to date ${OUTPUT_PATH}`);
    return;
  }
  writeFileSync(OUTPUT_PATH, text);
  console.log(`wrote ${OUTPUT_PATH}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
