import type { SupabaseClient } from '@supabase/supabase-js';
import { trackApiEvent } from './analytics';
import { logger } from './logger';
import { REQUIRED_COLUMNS } from './schema-expectations.gen';
import { createSupabaseServiceClient } from './supabase/service';

//---------------
// Schema drift check (issue #308). A deploy whose migration was not applied
// yet used to fail only at runtime ("column scheduled_posts.faceless_material
// does not exist": 68 errors in 3 days). At boot we ask the database for every
// column the migrations add (lib/schema-expectations.gen.ts) and report the
// missing ones once, naming the table.column, so the pending migration is
// obvious. It reports loudly but never blocks the boot: a strict check must
// not take the app down for a database it merely could not reach.
//---------------

export interface SchemaDriftReport {
  /** table -> columns the database does not have (or every column, if the table is missing). */
  missing: Record<string, string[]>;
  /** Tables the probe could not verify (network, auth, ...): not drift. */
  unverified: string[];
}

const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204']);
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205']);

async function probe(client: SupabaseClient, table: string, columns: readonly string[]): Promise<string | null> {
  const { error } = await client.from(table).select(columns.join(',')).limit(0);
  return error === null ? null : error.code;
}

export async function checkSchemaDrift(
  client: SupabaseClient,
  expected: Readonly<Record<string, readonly string[]>> = REQUIRED_COLUMNS,
): Promise<SchemaDriftReport> {
  const report: SchemaDriftReport = { missing: {}, unverified: [] };
  for (const [table, columns] of Object.entries(expected)) {
    const code = await probe(client, table, columns);
    if (code === null) continue;
    if (MISSING_TABLE_CODES.has(code)) {
      report.missing[table] = [...columns];
    } else if (MISSING_COLUMN_CODES.has(code)) {
      // One probe per column names exactly which ones are missing.
      const absent: string[] = [];
      for (const column of columns) {
        const columnCode = await probe(client, table, [column]);
        if (columnCode !== null && MISSING_COLUMN_CODES.has(columnCode)) absent.push(column);
      }
      report.missing[table] = absent.length > 0 ? absent : [...columns];
    } else {
      report.unverified.push(table);
    }
  }
  return report;
}

export function describeDrift(missing: Record<string, string[]>): string {
  return Object.entries(missing)
    .map(([table, columns]) => columns.map((column) => `${table}.${column}`).join(', '))
    .join(', ');
}

//---------------
// reportSchemaDrift — boot entry point (instrumentation.register). Never
// throws: a failure to check is logged, not fatal.
//---------------
export async function reportSchemaDrift(): Promise<void> {
  try {
    const report = await checkSchemaDrift(createSupabaseServiceClient());
    const tables = Object.keys(report.missing);
    if (tables.length > 0) {
      const detail = describeDrift(report.missing);
      logger.error(
        '[schema-drift] database is behind the code: apply the pending supabase migrations',
        new Error(`schema drift: missing ${detail}`),
        { tables },
      );
      trackApiEvent('schema_drift_detected', {
        tables,
        missing_count: Object.values(report.missing).reduce((sum, columns) => sum + columns.length, 0),
      });
    }
    if (report.unverified.length > 0) {
      logger.warn('[schema-drift] could not verify some tables', { metadata: { tables: report.unverified } });
    }
  } catch (error) {
    logger.error('[schema-drift] check failed', error);
  }
}
