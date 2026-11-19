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
