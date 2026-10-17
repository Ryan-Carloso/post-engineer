import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { GENERATION_PUBLISH_MODES } from '../video-generation';

describe('supabase/migrations/021_video-generations-params.sql literals', () => {
  it('keeps the SQL literals in sync with the TypeScript constants', () => {
    // The publish_mode values have no import of the TS constant; a
    // one-sided change would silently desynchronize the database CHECK
    // from the modes the app writes. This test parses the SQL file and
    // asserts the literals match.
    const sql = readFileSync(
      join(
        findRepoRoot(import.meta.url),
        'supabase',
        'migrations',
        '021_video-generations-params.sql',
      ),
      'utf8',
    );

    // The full engine job payload rides along as JSONB so a boot triage
    // can rebuild the generation after a restart.
    expect(sql).toMatch(/add column if not exists params jsonb/i);

    // The mode defaults to 'asap' ("generate now" posts as soon as the
    // video is ready); 'scheduled' posts at scheduled_at.
    expect(sql).toMatch(
      /add column if not exists publish_mode text not null default 'asap'/i,
    );
    expect(sql).toMatch(/add column if not exists scheduled_at timestamptz/i);

    // The CHECK pins exactly the modes the app can write — no third mode
    // may slip in from either side.
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
