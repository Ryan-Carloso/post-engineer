import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

//---------------
// supabase/migrations/070_persona-cta-intent.sql — the CTA intent contract
// spanning the database, the engine, and the shared TS literal.
//
// The DB CHECK constraint, the engine's CtaType enum and the shared
// personas contract are three independent literals (no module is shared
// across those runtimes). A value that reaches the database but not one of
// the enums produces a task that fails at RENDER time, after a paid
// LongCat submit — so the drift between them has to be caught by a test,
// not by a user. The web zod enum and the MCP schemas both import the
// contract literal, so they cannot drift from each other; the web and MCP
// re-export pins live below.
//
// This mirrors persona-video-layout-migration.test.ts.
//---------------

const repoRoot = findRepoRoot(import.meta.url);

const migrationPath = join(
  repoRoot,
  'supabase',
  'migrations',
  '070_persona-cta-intent.sql',
);

// 071 later dropped NOT NULL on schedules.post_cta_type only (a schedule
// legitimately has no CTA); personas.cta_type stays NOT NULL.
const migration071Path = join(
  repoRoot,
  'supabase',
  'migrations',
  '071_schedules-post-cta-type-nullable.sql',
);

// The single TS literal both apps share.
const contractPath = join(repoRoot, 'shared', 'contracts', 'personas.ts');

const engineCtaPath = join(repoRoot, 'apps', 'engine', 'app', 'models', 'cta.py');

/** The CTA types the migration's CHECK constraint accepts. */
function sqlAllowedCtaTypes(column: string): string[] {
  const sql = readFileSync(migrationPath, 'utf8');
  const match = sql.match(
    new RegExp(`check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]*)\\)\\s*\\)`, 'i'),
  );
  if (!match) throw new Error(`migration has no ${column} CHECK constraint`);
  return match[1]
    .split(',')
    .map((value) => value.trim().replace(/^'|'$/g, ''))
    .filter((value) => value.length > 0);
}

/** The CTA types the shared contract accepts. */
function contractAllowedCtaTypes(): string[] {
  const source = readFileSync(contractPath, 'utf8');
  const match = source.match(/PERSONA_CTA_TYPES\s*(?::[^=]+)?=\s*\[([^\]]*)\]/);
  if (!match) throw new Error('shared/contracts/personas.ts has no PERSONA_CTA_TYPES constant');
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1]);
}

/** The CTA types the engine's CtaType enum accepts. */
function engineAllowedCtaTypes(): string[] {
  const source = readFileSync(engineCtaPath, 'utf8');
  return [...source.matchAll(/^\s{4}(\w+)\s*=\s*"([^"]+)"/gm)].map(
    (entry) => entry[2],
  );
}

describe('supabase/migrations/070_persona-cta-intent.sql', () => {
  it('is guarded so a re-run is a no-op', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('add column if not exists cta_type');
    expect(sql).toContain('add column if not exists post_cta_type');
    // The constraints are added inside pg_constraint guards; a bare ADD
    // CONSTRAINT would abort the second run.
    expect(sql).toContain("conname = 'personas_cta_type_check'");
    expect(sql).toContain("conname = 'schedules_post_cta_type_check'");
  });

  it('defaults cta_type to follow and drops the stored-text columns', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    // No backfill UPDATE: the NOT NULL DEFAULT covers every existing row.
    // (071 later dropped NOT NULL on post_cta_type only; this pins 070's
    // text as shipped, not the live schema.)
    expect(sql).toContain("cta_type text not null default 'follow'");
    expect(sql).toContain("post_cta_type text not null default 'follow'");
    expect(sql).not.toMatch(/update\s+public\.personas\s+set\s+cta_type/i);
    // BETA rule: delete the old path, never keep both.
    expect(sql).toContain('drop column if exists cta_text');
    expect(sql).toContain('drop column if exists post_cta_text');
  });
});

describe('supabase/migrations/071_schedules-post-cta-type-nullable.sql', () => {
  it('drops NOT NULL on schedules.post_cta_type only', () => {
    const sql = readFileSync(migration071Path, 'utf8');
    // A schedule legitimately has no CTA (faceless posts, per-video
    // `cta: null`); the snapshot writer stores NULL for those, so the
    // NOT NULL from 070 rejected the row. NULL means "no CTA" — it must
    // NOT fall back to 'follow', which would read back as a follow CTA.
    expect(sql).toContain('alter column post_cta_type drop not null');
    expect(sql).not.toMatch(/alter column cta_type drop not null/i);
    expect(sql).not.toMatch(/drop column/i);
  });

  it('does not recreate or drop the CHECK: only the seven intent values are admitted', () => {
    const sql = readFileSync(migration071Path, 'utf8');
    expect(sql).not.toMatch(/schedules_post_cta_type_check/i);
  });
});

// 072 drops the default 'follow' on schedules.post_cta_type only (a
// writer omitting the column inherited 'follow' by omission); the persona
// column keeps its NOT NULL DEFAULT 'follow'.
const migration072Path = join(
  repoRoot,
  'supabase',
  'migrations',
  '072_schedules-post-cta-type-no-default.sql',
);

describe('supabase/migrations/072_schedules-post-cta-type-no-default.sql', () => {
  it('drops the default on schedules.post_cta_type only', () => {
    const sql = readFileSync(migration072Path, 'utf8');
    expect(sql).toContain('alter column post_cta_type drop default');
    expect(sql).not.toMatch(/alter column cta_type drop default/i);
    expect(sql).not.toMatch(/drop not null/i);
    expect(sql).not.toMatch(/drop column/i);
  });
});

describe('cta_type literal sync across the three surfaces', () => {
  it('the persona and schedule CHECK constraints agree', () => {
    expect(sqlAllowedCtaTypes('post_cta_type')).toEqual(sqlAllowedCtaTypes('cta_type'));
  });

  it('the shared contract matches the database CHECK constraint', () => {
    expect(contractAllowedCtaTypes()).toEqual(sqlAllowedCtaTypes('cta_type'));
  });

  it('the engine enum matches the database CHECK constraint', () => {
    expect(engineAllowedCtaTypes()).toEqual(sqlAllowedCtaTypes('cta_type'));
  });

  it('names the offending surface in the failure', () => {
    // A bare toEqual on a one-sided edit reports only a diff. Naming the
    // surface makes the red self-identifying, which is the point of a sync
    // test: the next person to add a CTA type must edit all three.
    const sql = sqlAllowedCtaTypes('cta_type');
    const contract = contractAllowedCtaTypes();
    expect(
      contract.filter((value) => !sql.includes(value)),
      `CTA types accepted by the contract but not by the database: ${contract.join(', ')}`,
    ).toEqual([]);
    expect(
      sql.filter((value) => !contract.includes(value)),
      `CTA types accepted by the database but not by the contract: ${sql.join(', ')}`,
    ).toEqual([]);
  });

  it('always offers follow, whatever else is added', () => {
    // The default path must never disappear: every existing persona and
    // every deployment that predates this feature behaves as follow.
    for (const allowed of [
      sqlAllowedCtaTypes('cta_type'),
      contractAllowedCtaTypes(),
      engineAllowedCtaTypes(),
    ]) {
      expect(allowed).toContain('follow');
    }
  });

  it('the web persona form re-exports the contract literal, it does not define its own', () => {
    // A second literal in persona-schema.ts would drift the moment the
    // contract adds a type: the form would accept a value the route (or
    // the database CHECK) rejects.
    const schemaPath = join(repoRoot, 'apps', 'web', 'lib', 'persona-schema.ts');
    const schema = readFileSync(schemaPath, 'utf8');
    expect(schema).toContain("from './contracts/personas'");
    expect(schema).toContain('PERSONA_CTA_TYPES,');
    expect(schema).not.toMatch(/PERSONA_CTA_TYPES\s*(?::[^=]+)?=\s*\[/);
  });

  it('the MCP re-exports the contract literal, it does not define its own', () => {
    // Same drift rule on the MCP side: limits.ts is the single MCP
    // import site for the shared constants, and persona-cta-shape.ts
    // imports them from the contract, never a local literal.
    const limitsPath = join(repoRoot, 'apps', 'mcp', 'src', 'limits.ts');
    const limits = readFileSync(limitsPath, 'utf8');
    // The MCP imports with the .js suffix; the web imports without it.
    expect(limits).toContain("from './contracts/personas.js'");
    expect(limits).toContain('PERSONA_CTA_TYPES,');
    expect(limits).toContain('PERSONA_CTA_URL_MAX_LENGTH,');
    expect(limits).toContain('PERSONA_CTA_INSTRUCTION_MAX_LENGTH,');
    expect(limits).not.toMatch(/PERSONA_CTA_TYPES\s*(?::[^=]+)?=\s*\[/);
    const shapePath = join(repoRoot, 'apps', 'mcp', 'src', 'persona-cta-shape.ts');
    const shape = readFileSync(shapePath, 'utf8');
    expect(shape).toContain("from './contracts/personas.js'");
    expect(shape).toContain('PERSONA_CTA_TYPES');
    expect(shape).not.toMatch(/PERSONA_CTA_TYPES\s*(?::[^=]+)?=\s*\[/);
  });
});
