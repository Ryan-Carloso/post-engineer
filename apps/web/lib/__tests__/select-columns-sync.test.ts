import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';

interface Snapshot {
  tables: Record<string, { columns: { name: string }[] }>;
}

const ROOT = findRepoRoot(import.meta.url);
const WEB = join(ROOT, 'apps', 'web');
const SOURCE_DIRS = ['app', 'lib', 'components'];
const FROM_SELECT = /\.from\(\s*'([a-z_]+)'\s*\)\s*\.select\(\s*'([^']*)'/g;

const snapshot = JSON.parse(readFileSync(join(ROOT, 'supabase', 'schema.snapshot.json'), 'utf8')) as Snapshot;

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...sourceFiles(path));
    } else if ((path.endsWith('.ts') || path.endsWith('.tsx')) && !path.endsWith('.gen.ts') && !path.includes('.test.')) {
      files.push(path);
    }
  }
  return files;
}

function topLevelColumns(select: string): string[] {
  const columns: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of select) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      columns.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  columns.push(current);
  return columns
    .map((column) => column.trim())
    .filter((column) => column !== '' && column !== '*' && !column.includes('('))
    .map((column) => {
      const name = column.includes(':') && !column.includes('::') ? column.slice(column.indexOf(':') + 1) : column;
      return name.split('::')[0].trim();
    });
}

export function selectColumnIssues(source: string, tables: Snapshot['tables']): string[] {
  const issues: string[] = [];
  for (const match of source.matchAll(FROM_SELECT)) {
    const [, table, select] = match;
    const known = tables[table];
    if (known === undefined) {
      issues.push(`${table}: table is not in the schema snapshot`);
      continue;
    }
    const names = new Set(known.columns.map((column) => column.name));
    for (const column of topLevelColumns(select)) {
      if (!names.has(column)) issues.push(`${table}.${column}: column is not in the schema snapshot`);
    }
  }
  return issues;
}

describe('literal .from().select() columns', () => {
  it('flags a dropped column, an unknown table, and accepts aliases, casts and embedded relations', () => {
    const tables = { scheduled_posts: { columns: [{ name: 'id' }, { name: 'published_at' }] } };
    expect(selectColumnIssues(".from('scheduled_posts').select('id, voiceover')", tables)).toEqual([
      'scheduled_posts.voiceover: column is not in the schema snapshot',
    ]);
    expect(selectColumnIssues(".from('gone').select('id')", tables)).toEqual(['gone: table is not in the schema snapshot']);
    expect(
      selectColumnIssues(
        ".from('scheduled_posts')\n  .select('id, at:published_at, published_at::text, schedules(persona_id), *')",
        tables,
      ),
    ).toEqual([]);
  });

  it('names only tables and columns the migrated schema has, in every web source file', () => {
    const issues: string[] = [];
    for (const dir of SOURCE_DIRS) {
      for (const file of sourceFiles(join(WEB, dir))) {
        for (const issue of selectColumnIssues(readFileSync(file, 'utf8'), snapshot.tables)) {
          issues.push(`${relative(ROOT, file)}: ${issue}`);
        }
      }
    }
    expect(issues).toEqual([]);
  });
});
