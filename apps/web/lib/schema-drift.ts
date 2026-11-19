import type { SupabaseClient } from '@supabase/supabase-js';
import { trackApiEvent } from './analytics';
import { logger } from './logger';
import { REQUIRED_COLUMNS } from './schema-expectations.gen';
import { createSupabaseServiceClient } from './supabase/service';

export interface SchemaDriftReport {
  missing: Record<string, string[]>;
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
      const absent: string[] = [];
      let unverifiable = false;
      for (const column of columns) {
        const columnCode = await probe(client, table, [column]);
        if (columnCode === null) continue;
        if (MISSING_COLUMN_CODES.has(columnCode)) absent.push(column);
        else unverifiable = true;
      }
      if (absent.length > 0) report.missing[table] = absent;
      else if (unverifiable) report.unverified.push(table);
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
