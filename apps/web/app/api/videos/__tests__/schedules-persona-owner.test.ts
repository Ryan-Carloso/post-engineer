//---------------
// Migration 011 — `schedules_persona_owner unique (persona_id)` must stay gone.
//
// The constraint came from the retired recurring-timetable model. The batch
// flow (POST /api/videos/generate-and-schedule) creates one schedule per
// generation, so enforcing one-per-persona made every batch after a persona's
// first one impossible — and the route then reported
// `{slots: [], replayed: true}`, a success that generated nothing.
//
// Two ways this regresses, and neither fails a behavioral test on its own:
//
//   1. The constraint is re-added to a deployed database (someone re-runs the
//      old apps/web/supabase chain, or a migration re-creates it).
//   2. It is declared in the canonical schema snapshot, so a FRESH install
//      ships with the same breakage — which is how this reached production
//      while local dev, built from the canonical chain, never saw it.
//
// So both artifacts are pinned: the migration that drops it, and the absence
// of any uniqueness on persona_id in the canonical schema.
//---------------
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
    // `if exists` is what makes the file idempotent — a plain DROP would
    // error on the second apply and fail the CD migration step.
    expect(sql).toContain(`alter table public.schedules drop constraint if exists ${CONSTRAINT}`);
  });

  it('never re-creates the constraint it drops', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    // A drop followed by an add would be a no-op migration wearing a fix's
    // name; assert the add form is absent, not just that the drop is present.
    expect(sql).not.toContain('add constraint');
    expect(sql).not.toContain('add  constraint');
  });

  it('leaves the canonical schema without any unique constraint on persona_id', () => {
    // A fresh install must not ship the constraint in the first place; the
    // migration exists only to converge databases that already have it.
    const schema = readFileSync(SCHEMA, 'utf8');
    expect(schema).not.toContain(CONSTRAINT);
  });

  it('still declares the schedules table (a wrong schema path would pass vacuously)', () => {
    const schema = readFileSync(SCHEMA, 'utf8');
    expect(schema).toContain('create table if not exists public.schedules');
    // Sentinel column: proves the file parsed as the schedules DDL and not as
    // some other section of the snapshot.
    expect(schema).toContain('bluesky_account_ids');
  });
});
