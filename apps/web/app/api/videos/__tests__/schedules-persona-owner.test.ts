import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

const REPO_ROOT = findRepoRoot(import.meta.url);
const MIGRATION = join(REPO_ROOT, 'supabase/migrations/011_schedules-drop-persona-owner-unique.sql');
const SCHEMA = join(REPO_ROOT, 'supabase/migrations/001_schema.sql');
const CONSTRAINT = 'schedules_persona_owner';

describe('migration 011 drops the legacy one-schedule-per-persona constraint', () => {
  it('drops the constraint by name, guarded so re-running is safe', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain(`alter table public.schedules drop constraint if exists ${CONSTRAINT}`);
  });

  it('never re-creates the constraint it drops', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).not.toContain('add constraint');
    expect(sql).not.toContain('add  constraint');
  });

  it('leaves the canonical schema without any unique constraint on persona_id', () => {
    const schema = readFileSync(SCHEMA, 'utf8');
    expect(schema).not.toContain(CONSTRAINT);
  });

  it('still declares the schedules table (a wrong schema path would pass vacuously)', () => {
    const schema = readFileSync(SCHEMA, 'utf8');
    expect(schema).toContain('create table if not exists public.schedules');
    expect(schema).toContain('bluesky_account_ids');
  });
});
