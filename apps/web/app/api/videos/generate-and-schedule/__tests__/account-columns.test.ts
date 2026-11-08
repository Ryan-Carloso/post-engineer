import { describe, it, expect } from 'vitest';
import { PROVIDER_ACCOUNT_COLUMNS, scheduleAccountColumns } from '../account-columns';
import { VALID_SCHEDULE_PROVIDERS } from '@/app/api/schedule/route';
import { REQUIRED_COLUMNS } from '@/lib/schema-expectations.gen';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

interface SnapshotSchedules {
  tables: { schedules: { columns: { name: string }[] } };
}

const snapshot = JSON.parse(
  readFileSync(join(findRepoRoot(import.meta.url), 'supabase', 'schema.snapshot.json'), 'utf8'),
) as SnapshotSchedules;

describe('account-columns', () => {
  it('maps every schedule provider to its own <provider>_account_ids column', () => {
    expect(Object.keys(PROVIDER_ACCOUNT_COLUMNS).sort()).toEqual([...VALID_SCHEDULE_PROVIDERS].sort());
    for (const [provider, column] of Object.entries(PROVIDER_ACCOUNT_COLUMNS)) {
      expect(column).toBe(`${provider}_account_ids`);
    }
  });

  it('names only columns the schedules table really has', () => {
    const columns = snapshot.tables.schedules.columns.map((column) => column.name);
    for (const column of Object.values(PROVIDER_ACCOUNT_COLUMNS)) expect(columns).toContain(column);
    expect(REQUIRED_COLUMNS.schedules).toContain('facebook_account_ids');
  });

  it('writes every column, the targeted ones with their ids and the rest empty', () => {
    expect(scheduleAccountColumns({ facebook: ['111', '222'], youtube: ['UC-1'] })).toEqual({
      youtube_account_ids: ['UC-1'],
      instagram_account_ids: [],
      linkedin_account_ids: [],
      bluesky_account_ids: [],
      threads_account_ids: [],
      facebook_account_ids: ['111', '222'],
    });
  });

  it('writes each provider to its own column', () => {
    for (const provider of VALID_SCHEDULE_PROVIDERS) {
      const columns: Record<string, string[]> = scheduleAccountColumns({ [provider]: ['id'] });
      for (const [other, column] of Object.entries(PROVIDER_ACCOUNT_COLUMNS)) {
        expect(columns[column], `${provider} -> ${column}`).toEqual(other === provider ? ['id'] : []);
      }
    }
  });
});
