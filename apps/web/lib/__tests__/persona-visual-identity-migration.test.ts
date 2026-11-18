import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

const migrationPath = join(
  findRepoRoot(import.meta.url),
  'supabase',
  'migrations',
  '005_persona-visual-identity.sql',
);

const routePath = join(
  findRepoRoot(import.meta.url),
  'apps',
  'web',
  'app',
  'api',
  'persona',
  'route.ts',
);

describe('supabase/migrations/005_persona-visual-identity.sql', () => {
  it('declares the constraint idempotently', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('personas_visual_identity_check');
    expect(sql).toContain('pg_constraint');
    expect(sql).toContain('if not exists');
    expect(sql).toContain('check (photo_path is null or avatar_url is null)');
    expect(sql).not.toContain('= 1) not valid');
  });

  it('repairs rows that already carry two faces before enforcing', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    const repairIndex = sql.indexOf('set avatar_url = null');
    const constraintIndex = sql.indexOf('add constraint personas_visual_identity_check');
    expect(repairIndex).toBeGreaterThan(-1);
    expect(constraintIndex).toBeGreaterThan(repairIndex);
  });
});

describe('PATCH /api/persona — the identity swap the constraint requires', () => {
  it('sets avatar_url and clears photo_path in the same update', async () => {
    const route = readFileSync(routePath, 'utf8');

    const branch = route.slice(route.indexOf('} else if (patch.avatarUrl !== null) {'));
    const setAvatar = branch.indexOf('updates.avatar_url = resolved.avatarUrl;');
    const setPhoto = branch.indexOf('updates.photo_path = resolved.photoPath;');
    expect(setAvatar).toBeGreaterThan(-1);
    expect(setPhoto).toBeGreaterThan(setAvatar);
    expect(branch.indexOf('stalePaths.push(persona.photo_path)')).toBeGreaterThan(setPhoto);
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
