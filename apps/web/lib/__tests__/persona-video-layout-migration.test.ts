import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

//---------------
// supabase/migrations/019_personas-video-layout.sql — the layout contract
// spanning the database, the engine, and the shared TS literal.
//
// The DB CHECK constraint, the engine's VideoLayout enum and the shared
// personas contract are three independent literals (no module is shared
// across those runtimes). A value that reaches the database but not one of
// the enums produces a task that fails at RENDER time, after a paid
// LongCat submit — so the drift between them has to be caught by a test,
// not by a user. The web zod enum and the MCP schemas both import the
// contract literal, so they cannot drift from each other.
//
// This mirrors the SQL-literals sync tests already in the repo.
//---------------

const repoRoot = findRepoRoot(import.meta.url);

const migrationPath = join(
  repoRoot,
  'supabase',
  'migrations',
  '019_personas-video-layout.sql',
);

// The single TS literal both apps share.
const contractPath = join(repoRoot, 'shared', 'contracts', 'personas.ts');

const engineSchemaPath = join(repoRoot, 'apps', 'engine', 'app', 'models', 'schema.py');

// The web schema and the MCP limits re-export the contract literal; a
// one-sided local definition would silently fork the lists again.
const schemaPath = join(repoRoot, 'apps', 'web', 'lib', 'persona-schema.ts');
const mcpLimitsPath = join(repoRoot, 'apps', 'mcp', 'src', 'limits.ts');

/** The layout values the migration's CHECK constraint accepts. */
function sqlAllowedLayouts(): string[] {
  const sql = readFileSync(migrationPath, 'utf8');
  const match = sql.match(
    /check\s*\(\s*video_layout\s+is\s+null\s+or\s+video_layout\s+in\s*\(([^)]*)\)\s*\)/i,
  );
  if (!match) throw new Error('migration has no video_layout CHECK constraint');
  return match[1]
    .split(',')
    .map((value) => value.trim().replace(/^'|'$/g, ''))
    .filter((value) => value.length > 0);
}

/** The layout values the shared contract accepts. */
function contractAllowedLayouts(): string[] {
  const source = readFileSync(contractPath, 'utf8');
  const match = source.match(/VIDEO_LAYOUTS\s*(?::[^=]+)?=\s*\[([^\]]*)\]/);
  if (!match) throw new Error('shared/contracts/personas.ts has no VIDEO_LAYOUTS constant');
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1]);
}

/** The layout values the web zod enum accepts (a re-export of the contract). */
function webAllowedLayouts(): string[] {
  return contractAllowedLayouts();
}

/** The layout values the engine's VideoLayout enum accepts. */
function engineAllowedLayouts(): string[] {
  const source = readFileSync(engineSchemaPath, 'utf8');
  const block = source.match(
    /class VideoLayout\(str, Enum\):([\s\S]*?)\n\nclass /,
  );
  if (!block) throw new Error('engine schema has no VideoLayout enum');
  return [...block[1].matchAll(/^\s{4}(\w+)\s*=\s*"([^"]+)"/gm)].map(
    (entry) => entry[2],
  );
}

/** The layout values the MCP zod schemas accept (a re-export of the contract). */
function mcpAllowedLayouts(): string[] {
  return contractAllowedLayouts();
}

describe('supabase/migrations/019_personas-video-layout.sql', () => {
  it('is guarded so a re-run is a no-op', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('add column if not exists video_layout');
    expect(sql).toContain('add column if not exists post_video_layout');
    // The constraint is added inside a pg_constraint guard; a bare ADD
    // CONSTRAINT would abort the second run.
    expect(sql).toContain("conname = 'personas_video_layout_check'");
  });

  it('treats NULL as standard so pre-migration personas keep working', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    // "is null or" is the whole compatibility story: rows written before this
    // migration have NULL here and must still render as they always did.
    expect(sql).toContain('video_layout is null or video_layout in');
    // And there is deliberately no backfill UPDATE.
    expect(sql).not.toMatch(/update\s+public\.personas\s+set\s+video_layout/i);
  });
});

describe('video_layout literal sync across the three surfaces', () => {
  it('the web and MCP re-export the contract literal instead of defining their own', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    expect(schema).toContain("from './contracts/personas'");
    expect(schema).toContain('VIDEO_LAYOUTS,');
    expect(schema).not.toMatch(/VIDEO_LAYOUTS\s*=\s*\[/);
    const limits = readFileSync(mcpLimitsPath, 'utf8');
    expect(limits).toContain("from './contracts/personas.js'");
    expect(limits).toContain('VIDEO_LAYOUTS');
    expect(limits).not.toMatch(/VIDEO_LAYOUTS\s*=\s*\[/);
  });

  it('the web enum matches the database CHECK constraint', () => {
    expect(webAllowedLayouts()).toEqual(sqlAllowedLayouts());
  });

  it('the engine enum matches the database CHECK constraint', () => {
    expect(engineAllowedLayouts()).toEqual(sqlAllowedLayouts());
  });

  it('the MCP tool schemas match the database CHECK constraint', () => {
    expect(mcpAllowedLayouts()).toEqual(sqlAllowedLayouts());
  });

  it('names the offending surface in the failure', () => {
    // A bare toEqual on a one-sided edit reports only a diff. Naming the
    // surface makes the red self-identifying, which is the point of a sync
    // test: the next person to add a layout must edit all three.
    const sql = sqlAllowedLayouts();
    const web = webAllowedLayouts();
    expect(
      web.filter((value) => !sql.includes(value)),
      `layouts accepted by web but not by the database: ${web.join(', ')}`,
    ).toEqual([]);
    expect(
      sql.filter((value) => !web.includes(value)),
      `layouts accepted by the database but not by web: ${sql.join(', ')}`,
    ).toEqual([]);
  });

  it('always offers standard, whatever else is added', () => {
    // The default path must never disappear: every existing persona and every
    // deployment that predates this feature renders as standard.
    for (const allowed of [
      sqlAllowedLayouts(),
      webAllowedLayouts(),
      engineAllowedLayouts(),
      mcpAllowedLayouts(),
    ]) {
      expect(allowed).toContain('standard');
    }
  });
});