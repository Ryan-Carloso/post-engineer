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

export async function generateEngineTypes(spec) {
  const ast = await openapiTS(spec, { alphabetize: true, defaultNonNullable: false });
  return HEADER + astToString(ast);
}

export async function runCli({ snapshotPath, outputPath, args, exit, log, error }) {
  const spec = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  const text = await generateEngineTypes(spec);
  if (args.includes('--check')) {
    let current;
    try {
      current = readFileSync(outputPath, 'utf8');
    } catch {
      current = undefined;
    }
    if (current !== text) {
      error(`stale ${outputPath} — run node apps/web/scripts/generate-engine-types.mjs`);
      exit(1);
      return;
    }
    log(`up to date ${outputPath}`);
    return;
  }
  writeFileSync(outputPath, text);
  log(`wrote ${outputPath}`);
}

async function main() { await runCli({ snapshotPath: SNAPSHOT_PATH, outputPath: OUTPUT_PATH, args: process.argv, exit: process.exit, log: console.log.bind(console), error: console.error.bind(console) }); }

export function reportCliFailure(error) {
  console.error(error);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(reportCliFailure);
}
