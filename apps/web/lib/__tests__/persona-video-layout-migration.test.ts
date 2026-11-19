import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

const repoRoot = findRepoRoot(import.meta.url);

const migrationPath = join(
  repoRoot,
  'supabase',
  'migrations',
  '019_personas-video-layout.sql',
);

const contractPath = join(repoRoot, 'shared', 'contracts', 'personas.ts');

const engineSchemaPath = join(repoRoot, 'apps', 'engine', 'app', 'models', 'schema.py');

const schemaPath = join(repoRoot, 'apps', 'web', 'lib', 'persona-schema.ts');
const mcpLimitsPath = join(repoRoot, 'apps', 'mcp', 'src', 'limits.ts');

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

function contractAllowedLayouts(): string[] {
  const source = readFileSync(contractPath, 'utf8');
  const match = source.match(/VIDEO_LAYOUTS\s*(?::[^=]+)?=\s*\[([^\]]*)\]/);
  if (!match) throw new Error('shared/contracts/personas.ts has no VIDEO_LAYOUTS constant');
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1]);
}

function webAllowedLayouts(): string[] {
  return contractAllowedLayouts();
}

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

function mcpAllowedLayouts(): string[] {
  return contractAllowedLayouts();
}

describe('supabase/migrations/019_personas-video-layout.sql', () => {
  it('is guarded so a re-run is a no-op', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('add column if not exists video_layout');
    expect(sql).toContain('add column if not exists post_video_layout');
    expect(sql).toContain("conname = 'personas_video_layout_check'");
  });

  it('treats NULL as standard so pre-migration personas keep working', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('video_layout is null or video_layout in');
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