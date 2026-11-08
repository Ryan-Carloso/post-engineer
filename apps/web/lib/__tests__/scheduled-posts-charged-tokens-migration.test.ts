import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { FACELESS_PRICE, FACE_QUALITY_PRICES, FULL_LIPSYNC_PRICES } from '@/lib/tokens';

//---------------
// scheduled_posts.charged_tokens (migration 045) — what each slot was
// charged. The migration backfills existing rows with the list price, so its
// SQL repeats the price literals: this test pins each one to lib/tokens.ts.
//---------------
const root = findRepoRoot(import.meta.url);
const migration = readFileSync(join(root, 'supabase/migrations/045_scheduled-posts-batch-billing.sql'), 'utf8');

describe('scheduled_posts.charged_tokens migration', () => {
  it('adds a NOT NULL, non-negative integer column', () => {
    expect(migration).toContain('add column if not exists charged_tokens integer;');
    expect(migration).toContain('alter column charged_tokens set not null;');
    expect(migration).toContain('check (charged_tokens >= 0)');
  });

  it('backfills faced slots with the lib/tokens.ts prices', () => {
    expect(migration).toContain(`when sp.faceless is true then ${FACELESS_PRICE}`);
    expect(migration).toContain(
      `when sp.full_lipsync is true and q.face_quality = 'very_good' then ${FULL_LIPSYNC_PRICES.very_good}`,
    );
    expect(migration).toContain(`when sp.full_lipsync is true then ${FULL_LIPSYNC_PRICES.ok}`);
    expect(migration).toContain(`when q.face_quality = 'very_good' then ${FACE_QUALITY_PRICES.very_good}`);
    expect(migration).toContain(`else ${FACE_QUALITY_PRICES.ok}`);
  });

  it('prices orphan slots (no schedule row) as face quality ok', () => {
    const orphan = migration.slice(migration.lastIndexOf('update public.scheduled_posts sp'));
    expect(orphan).toContain(`when sp.faceless is true then ${FACELESS_PRICE}`);
    expect(orphan).toContain(`when sp.full_lipsync is true then ${FULL_LIPSYNC_PRICES.ok}`);
    expect(orphan).toContain(`else ${FACE_QUALITY_PRICES.ok}`);
    expect(orphan).not.toContain('very_good');
  });
});

describe('scheduled_posts batch discount columns (issue #487)', () => {
  it('adds a nullable batch_id, indexed, and a non-negative discount_tokens defaulting to 0', () => {
    expect(migration).toContain('add column if not exists batch_id uuid;');
    expect(migration).toContain('add column if not exists discount_tokens integer not null default 0;');
    expect(migration).toContain('check (discount_tokens >= 0)');
    expect(migration).toContain('on public.scheduled_posts (batch_id)');
  });
});
