#!/usr/bin/env node
//---------------
// dump-schema — snapshot of the public schema as Postgres itself reports it
// after the migration chain is applied: tables, columns (type, NOT NULL,
// default), constraints (CHECK / FK / PK / UNIQUE definitions), RLS flag,
// policies and enum types.
//
//   node scripts/db/dump-schema.mjs --db-url <url> --write   regenerate
//   node scripts/db/dump-schema.mjs --db-url <url> --check   fail on drift
//
// The committed supabase/schema.snapshot.json is what the unit tests read
// (no database needed there) and what CI compares against a freshly migrated
// ephemeral Postgres, so a migration that changes the schema without the
// snapshot change is visible in review, and code-side lists (providers,
// modes) are checked against the constraints the database really has.
//---------------

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SNAPSHOT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'schema.snapshot.json');

// jsonb sorts object keys, so the output is deterministic; columns keep
// attnum order and constraints/policies are keyed by name.
const QUERY = `
select jsonb_pretty(jsonb_build_object('enums', coalesce((
  select jsonb_object_agg(t.typname, (
    select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid
  ))
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typtype = 'e'
), '{}'::jsonb), 'tables', coalesce((
  select jsonb_object_agg(c.relname, jsonb_build_object(
    'rls', c.relrowsecurity,
    'columns', (
      select jsonb_agg(jsonb_build_object(
        'name', a.attname,
        'type', format_type(a.atttypid, a.atttypmod),
        'notNull', a.attnotnull,
        'default', pg_get_expr(d.adbin, d.adrelid)
      ) order by a.attnum)
      from pg_attribute a
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    ),
    'constraints', (
      select coalesce(jsonb_object_agg(k.conname, pg_get_constraintdef(k.oid)), '{}'::jsonb)
      from pg_constraint k where k.conrelid = c.oid
    ),
    'policies', (
      select coalesce(jsonb_object_agg(p.polname, jsonb_build_object(
        'cmd', p.polcmd,
        'qual', pg_get_expr(p.polqual, p.polrelid),
        'withCheck', pg_get_expr(p.polwithcheck, p.polrelid)
      )), '{}'::jsonb)
      from pg_policy p where p.polrelid = c.oid
    )
  ))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
), '{}'::jsonb)));
`;

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function dumpSchema(dbUrl) {
  const result = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-At', '-c', QUERY], { encoding: 'utf8' });
  if (result.status !== 0) {
    // psql echoes the connection string on failure; print stderr only.
    throw new Error(`psql failed: ${result.stderr.trim() || result.error?.message || 'unknown error'}`);
  }
  return `${result.stdout.trim()}\n`;
}

function main() {
  const dbUrl = readFlag('--db-url');
  const write = process.argv.includes('--write');
  const check = process.argv.includes('--check');
  if (!dbUrl || write === check) {
    console.error('usage: dump-schema.mjs --db-url <url> (--write | --check)');
    process.exit(2);
  }

  const fresh = dumpSchema(dbUrl);
  if (write) {
    writeFileSync(SNAPSHOT_PATH, fresh);
    console.log(`wrote ${SNAPSHOT_PATH}`);
    return;
  }

  const committed = readFileSync(SNAPSHOT_PATH, 'utf8');
  if (committed === fresh) {
    console.log('schema snapshot is up to date');
    return;
  }
  const freshLines = fresh.split('\n');
  const committedLines = new Set(committed.split('\n'));
  const added = freshLines.filter((line) => !committedLines.has(line)).slice(0, 20);
  console.error('supabase/schema.snapshot.json is stale: the migrated database differs from the committed snapshot.');
  console.error('Regenerate it against a freshly migrated local Postgres:');
  console.error('  node scripts/db/dump-schema.mjs --db-url <local-url> --write');
  console.error('Lines the migrated database has that the snapshot lacks (first 20):');
  for (const line of added) console.error(`  + ${line}`);
  process.exit(1);
}

main();
