// Generates apps/web/lib/schema-expectations.gen.ts: the columns that the
// supabase migrations ADD to existing tables. The web checks them against
// the live database at boot (lib/schema-drift.ts), so a deploy whose
// migration was not applied yet is reported at startup instead of failing at
// runtime with "column ... does not exist" (issue #308).
//
// Committed (like lib/engine/schema.gen.ts) because the web Docker build
// context copies only apps/web: supabase/migrations is not there at build
// time. The drift test (lib/__tests__/schema-expectations-gen.test.ts)
// regenerates in memory and fails when the committed file is stale.
//
// Run: node apps/web/scripts/generate-schema-expectations.mjs [--check]
//   --check  exit 1 (without writing) when the committed file is stale.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const MIGRATIONS_DIR = join(root, 'supabase/migrations');
export const OUTPUT_PATH = join(root, 'apps/web/lib/schema-expectations.gen.ts');

const HEADER = [
  '// GENERATED FILE — do not edit by hand.',
  '// Source: supabase/migrations/*.sql (columns added by `alter table ... add column`).',
  '// Regenerate: node apps/web/scripts/generate-schema-expectations.mjs',
  '',
  '',
].join('\n');

const ALTER_TABLE = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+([^;]*);/gi;
const ADD_COLUMN = /add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
const DROP_COLUMN = /drop\s+column\s+(?:if\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi;

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Columns each table must have after every migration is applied, in file
 * order: `add column` adds, a later `drop column` removes. Only columns that
 * migrations ADD to a table count — a table's original columns come from its
 * `create table`, which a missing table would already break loudly.
 */
export function extractRequiredColumns(sqlFiles) {
  const tables = new Map();
  for (const sql of sqlFiles) {
    for (const match of stripComments(sql).matchAll(ALTER_TABLE)) {
      const [, table, body] = match;
      const columns = tables.get(table) ?? new Set();
      for (const added of body.matchAll(ADD_COLUMN)) columns.add(added[1].toLowerCase());
      for (const dropped of body.matchAll(DROP_COLUMN)) columns.delete(dropped[1].toLowerCase());
      if (columns.size > 0) tables.set(table.toLowerCase(), columns);
      else tables.delete(table.toLowerCase());
    }
  }
  return Object.fromEntries(
    [...tables.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([table, columns]) => [table, [...columns].sort()]),
  );
}

export function renderSchemaExpectations(required) {
  const body = Object.entries(required)
    .map(([table, columns]) => `  ${table}: [${columns.map((c) => `'${c}'`).join(', ')}],`)
    .join('\n');
  return `${HEADER}export const REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {\n${body}\n};\n`;
}

export function generateSchemaExpectations(migrationsDir = MIGRATIONS_DIR) {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(join(migrationsDir, name), 'utf8'));
  return renderSchemaExpectations(extractRequiredColumns(files));
}

export function runCli({ outputPath = OUTPUT_PATH, args = process.argv.slice(2), exit = process.exit, log = console.log } = {}) {
  const next = generateSchemaExpectations();
  if (args.includes('--check')) {
    const current = readFileSync(outputPath, 'utf8');
    if (current !== next) {
      log('schema-expectations.gen.ts is stale — run: node apps/web/scripts/generate-schema-expectations.mjs');
      exit(1);
      return;
    }
    log('schema-expectations.gen.ts is up to date');
    return;
  }
  writeFileSync(outputPath, next);
  log(`wrote ${outputPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runCli();
