import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

//---------------
// supabase/migrations/005_persona-visual-identity.sql — the invariant the app
// depends on when PATCH swaps a persona's face.
//
// The production database got this constraint by hand, so it was invisible to
// the migration chain (what self-hosters run) AND to CI. These assertions pin
// the two halves of the contract:
//
//   1. the SQL file declares the constraint, and
//   2. PATCH /api/persona swaps both columns in ONE update (setting only the
//      new one is what violated the check and 500'd every save of a photo
//      persona).
//---------------

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'supabase',
  'migrations',
  '005_persona-visual-identity.sql',
);

const routePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'app',
  'api',
  'persona',
  'route.ts',
);

describe('supabase/migrations/005_persona-visual-identity.sql', () => {
  it('declares the constraint idempotently', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('personas_visual_identity_check');
    // Guarded on pg_constraint: re-running the file must not fail with
    // "constraint already exists" (self-hosters re-run migrations).
    expect(sql).toContain('pg_constraint');
    expect(sql).toContain('if not exists');
    // "Never both", NOT "exactly one": a faceless persona (mix 0, no photo,
    // no character) is legitimate and creatable via API/MCP.
    expect(sql).toContain('check (photo_path is null or avatar_url is null)');
    expect(sql).not.toContain('= 1) not valid');
  });

  it('repairs rows that already carry two faces before enforcing', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    // The repair must run before ADD CONSTRAINT or the add fails.
    const repairIndex = sql.indexOf('set avatar_url = null');
    const constraintIndex = sql.indexOf('add constraint personas_visual_identity_check');
    expect(repairIndex).toBeGreaterThan(-1);
    expect(constraintIndex).toBeGreaterThan(repairIndex);
  });
});

describe('PATCH /api/persona — the identity swap the constraint requires', () => {
  it('sets avatar_url and clears photo_path in the same update', async () => {
    const route = readFileSync(routePath, 'utf8');

    // Find the avatar branch and require the clear next to the set: two
    // separate statements would race (and the second one alone is what left
    // the row with both columns set).
    const branch = route.slice(route.indexOf('} else if (patch.avatarUrl !== null) {'));
    const setIndex = branch.indexOf('updates.avatar_url = patch.avatarUrl;');
    const clearIndex = branch.indexOf('updates.photo_path = null;');
    expect(setIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeGreaterThan(setIndex);
    // The stale photo is removed only after the swap succeeded (the cleanup
    // list is applied post-update), never before.
    expect(branch.indexOf('stalePaths.push(persona.photo_path)')).toBeGreaterThan(clearIndex);
  });

  it('clears avatar_url when a new photo is uploaded (the mirror branch)', () => {
    const route = readFileSync(routePath, 'utf8');

    const branch = route.slice(
      route.indexOf('if (patch.photo && patch.photoExtension) {'),
      route.indexOf('} else if (patch.avatarUrl !== null) {'),
    );
    expect(branch).toContain('updates.photo_path = photoPath;');
    expect(branch).toContain('updates.avatar_url = null;');
  });
});
