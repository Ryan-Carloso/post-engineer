import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';

const root = findRepoRoot(import.meta.url);
const sql = readFileSync(join(root, 'supabase', 'migrations', '084_persona-identity-card.sql'), 'utf8');
const readme = readFileSync(join(root, 'supabase', 'README.md'), 'utf8');
const snapshot = JSON.parse(readFileSync(join(root, 'supabase', 'schema.snapshot.json'), 'utf8')) as {
  tables: Record<string, { columns: Array<{ name: string; type: string; default: string | null; notNull: boolean }>; constraints: Record<string, string> }>;
};

describe('supabase/migrations/084_persona-identity-card.sql', () => {
  it('adds the column idempotently as a nullable jsonb with no default', () => {
    expect(sql).toContain('add column if not exists identity_card jsonb;');
    expect(sql).not.toMatch(/identity_card jsonb[^;]*(not null|default)/i);
  });

  it('guards the object check on pg_constraint and pins jsonb_typeof', () => {
    expect(sql).toContain("conname = 'personas_identity_card_object_check'");
    expect(sql).toContain('pg_constraint');
    expect(sql).toContain("check (identity_card is null or jsonb_typeof(identity_card) = 'object')");
  });

  it('never stores the scene and never touches another table', () => {
    expect(sql).not.toMatch(/persona_images/);
    expect(sql).not.toMatch(/\bscene\b\s+jsonb/i);
  });

  it('is listed in the migration README', () => {
    expect(readme).toContain('`migrations/084_persona-identity-card.sql`');
  });

  it('matches the schema snapshot: nullable jsonb column plus the object check', () => {
    const personas = snapshot.tables.personas;
    expect(personas.columns.find((column) => column.name === 'identity_card')).toEqual({
      name: 'identity_card',
      type: 'jsonb',
      default: null,
      notNull: false,
    });
    expect(personas.constraints.personas_identity_card_object_check).toContain("jsonb_typeof(identity_card) = 'object'");
  });
});
