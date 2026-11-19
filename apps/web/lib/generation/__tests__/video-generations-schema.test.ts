import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { GENERATION_PUBLISH_MODES } from '../video-generation';

describe('supabase/migrations/021_video-generations-params.sql literals', () => {
  it('keeps the SQL literals in sync with the TypeScript constants', () => {
    const sql = readFileSync(
      join(
        findRepoRoot(import.meta.url),
        'supabase',
        'migrations',
        '021_video-generations-params.sql',
      ),
      'utf8',
    );

    expect(sql).toMatch(/add column if not exists params jsonb/i);

    expect(sql).toMatch(
      /add column if not exists publish_mode text not null default 'asap'/i,
    );
    expect(sql).toMatch(/add column if not exists scheduled_at timestamptz/i);

    const checkMatch = sql.match(/check \(publish_mode in \(([^)]+)\)\)/i);
    expect(checkMatch).not.toBeNull();
    if (checkMatch === null) throw new Error('publish_mode CHECK not found');
    const sqlModes = checkMatch[1]
      .split(',')
      .map((part) => part.trim().replace(/^'|'$/g, ''))
      .sort();
    expect(sqlModes).toEqual([...GENERATION_PUBLISH_MODES].sort());
  });
});
