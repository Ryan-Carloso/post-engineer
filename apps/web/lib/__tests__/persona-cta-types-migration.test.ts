import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

const repoRoot = findRepoRoot(import.meta.url);

const migrationPath = join(
  repoRoot,
  'supabase',
  'migrations',
  '072_persona-cta-intent.sql',
);

const migration073Path = join(
  repoRoot,
  'supabase',
  'migrations',
  '073_schedules-post-cta-type-nullable.sql',
);

const contractPath = join(repoRoot, 'shared', 'contracts', 'personas.ts');

const engineCtaPath = join(repoRoot, 'apps', 'engine', 'app', 'models', 'cta.py');

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

function contractAllowedCtaTypes(): string[] {
  const source = readFileSync(contractPath, 'utf8');
  const match = source.match(/PERSONA_CTA_TYPES\s*(?::[^=]+)?=\s*\[([^\]]*)\]/);
  if (!match) throw new Error('shared/contracts/personas.ts has no PERSONA_CTA_TYPES constant');
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1]);
}

function engineAllowedCtaTypes(): string[] {
  const source = readFileSync(engineCtaPath, 'utf8');
  return [...source.matchAll(/^\s{4}(\w+)\s*=\s*"([^"]+)"/gm)].map(
    (entry) => entry[2],
  );
}

describe('supabase/migrations/072_persona-cta-intent.sql', () => {
  it('is guarded so a re-run is a no-op', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('add column if not exists cta_type');
    expect(sql).toContain('add column if not exists post_cta_type');
    expect(sql).toContain("conname = 'personas_cta_type_check'");
    expect(sql).toContain("conname = 'schedules_post_cta_type_check'");
  });

  it('defaults cta_type to follow and drops the stored-text columns', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain("cta_type text not null default 'follow'");
    expect(sql).toContain("post_cta_type text not null default 'follow'");
    expect(sql).not.toMatch(/update\s+public\.personas\s+set\s+cta_type/i);
    expect(sql).toContain('drop column if exists cta_text');
    expect(sql).toContain('drop column if exists post_cta_text');
  });
});

describe('supabase/migrations/073_schedules-post-cta-type-nullable.sql', () => {
  it('drops NOT NULL on schedules.post_cta_type only', () => {
    const sql = readFileSync(migration073Path, 'utf8');
    expect(sql).toContain('alter column post_cta_type drop not null');
    expect(sql).not.toMatch(/alter column cta_type drop not null/i);
    expect(sql).not.toMatch(/drop column/i);
  });

  it('does not recreate or drop the CHECK: only the seven intent values are admitted', () => {
    const sql = readFileSync(migration073Path, 'utf8');
    expect(sql).not.toMatch(/schedules_post_cta_type_check/i);
  });
});

const migration074Path = join(
  repoRoot,
  'supabase',
  'migrations',
  '074_schedules-post-cta-type-no-default.sql',
);

describe('supabase/migrations/074_schedules-post-cta-type-no-default.sql', () => {
  it('drops the default on schedules.post_cta_type only', () => {
    const sql = readFileSync(migration074Path, 'utf8');
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
    for (const allowed of [
      sqlAllowedCtaTypes('cta_type'),
      contractAllowedCtaTypes(),
      engineAllowedCtaTypes(),
    ]) {
      expect(allowed).toContain('follow');
    }
  });

  it('the web persona form re-exports the contract literal, it does not define its own', () => {
    const schemaPath = join(repoRoot, 'apps', 'web', 'lib', 'persona-schema.ts');
    const schema = readFileSync(schemaPath, 'utf8');
    expect(schema).toContain("from './contracts/personas'");
    expect(schema).toContain('PERSONA_CTA_TYPES,');
    expect(schema).not.toMatch(/PERSONA_CTA_TYPES\s*(?::[^=]+)?=\s*\[/);
  });

  it('the MCP re-exports the contract literal, it does not define its own', () => {
    const limitsPath = join(repoRoot, 'apps', 'mcp', 'src', 'limits.ts');
    const limits = readFileSync(limitsPath, 'utf8');
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
