import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_ROOTS = ['app', 'lib', 'components'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.nx', '__tests__']);

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const SOURCE_FILES = SOURCE_ROOTS.flatMap((root) => collectSourceFiles(root));

describe('the persona face mix is fully removed', () => {
  it('finds the source files it is scanning (a wrong root would pass vacuously)', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(100);
    expect(SOURCE_FILES.some((file) => file.endsWith('.ts'))).toBe(true);
  });

  for (const file of SOURCE_FILES) {
    it(`${file} never mentions face_mix_percent / faceMixPercent`, () => {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toContain('face_mix_percent');
      expect(source).not.toContain('faceMixPercent');
    });
  }

  it('the migration drops the column and adds the per-post flag', () => {
    const sql = readFileSync(
      join(process.cwd(), '..', '..', 'supabase', 'migrations', '007_personas-drop-face-mix.sql'),
      'utf8',
    );
    expect(sql).toContain('add column if not exists faceless boolean not null default false');
    expect(sql).toContain('drop column if exists face_mix_percent');
  });

  it('the canonical schema still declares the column the migration drops', () => {
    const schema = readFileSync(
      join(process.cwd(), '..', '..', 'supabase', 'migrations', '001_schema.sql'),
      'utf8',
    );
    expect(schema).toContain('face_mix_percent integer');
  });
});