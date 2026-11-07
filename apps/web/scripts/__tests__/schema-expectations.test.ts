// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';

const root = findRepoRoot(import.meta.url);

type Generator = {
  extractRequiredColumns: (sqlFiles: string[]) => Record<string, string[]>;
  renderSchemaExpectations: (required: Record<string, string[]>) => string;
  runCli: (options: {
    outputPath: string;
    args: string[];
    exit: (code: number) => void;
    log: (message: string) => void;
  }) => void;
};

const loadGenerator = async (): Promise<Generator> =>
  import(join(root, 'apps/web/scripts/generate-schema-expectations.mjs'));

describe('extractRequiredColumns', () => {
  it('collects a single add column', async () => {
    const { extractRequiredColumns } = await loadGenerator();
    expect(
      extractRequiredColumns(['alter table public.personas add column if not exists cta_text text;']),
    ).toEqual({ personas: ['cta_text'] });
  });

  it('collects several add columns from one multi-line alter table', async () => {
    const { extractRequiredColumns } = await loadGenerator();
    const sql = `alter table public.schedules
      add column if not exists publish_mode text not null default 'scheduled',
      add column if not exists post_niche text;`;
    expect(extractRequiredColumns([sql])).toEqual({ schedules: ['post_niche', 'publish_mode'] });
  });

  it('removes a column that a later migration drops', async () => {
    const { extractRequiredColumns } = await loadGenerator();
    const files = [
      'alter table public.personas add column if not exists face_mix int;',
      'alter table public.personas drop column if exists face_mix;',
    ];
    expect(extractRequiredColumns(files)).toEqual({});
  });

  it('ignores comments and tables that only enable row level security', async () => {
    const { extractRequiredColumns } = await loadGenerator();
    const sql = `-- alter table public.fake add column nope text;
      /* alter table public.fake2 add column nope text; */
      alter table public.real enable row level security;`;
    expect(extractRequiredColumns([sql])).toEqual({});
  });

  it('sees an add column written inside an execute string', async () => {
    const { extractRequiredColumns } = await loadGenerator();
    const sql = "execute 'alter table public.tokens add column user_id uuid';";
    expect(extractRequiredColumns([sql])).toEqual({ tokens: ['user_id'] });
  });

  it('sorts tables and columns so the output is stable', async () => {
    const { extractRequiredColumns } = await loadGenerator();
    const files = [
      'alter table public.zeta add column b int;',
      'alter table public.alpha add column z int, add column a int;',
    ];
    expect(Object.keys(extractRequiredColumns(files))).toEqual(['alpha', 'zeta']);
    expect(extractRequiredColumns(files).alpha).toEqual(['a', 'z']);
  });
});

describe('schema-expectations CLI', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const tempFile = (content: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'schema-expectations-'));
    dirs.push(dir);
    const file = join(dir, 'out.gen.ts');
    writeFileSync(file, content);
    return file;
  };

  it('--check exits 1 and leaves the file untouched when it is stale', async () => {
    const { runCli } = await loadGenerator();
    const file = tempFile('stale');
    const exit = vi.fn();
    const log = vi.fn();
    runCli({ outputPath: file, args: ['--check'], exit, log });
    expect(exit).toHaveBeenCalledWith(1);
    expect(readFileSync(file, 'utf8')).toBe('stale');
    expect(log.mock.calls[0][0]).toContain('stale');
  });

  it('--check passes without writing when the file is current', async () => {
    const { runCli } = await loadGenerator();
    const file = tempFile('');
    runCli({ outputPath: file, args: [], exit: vi.fn(), log: vi.fn() });
    const exit = vi.fn();
    runCli({ outputPath: file, args: ['--check'], exit, log: vi.fn() });
    expect(exit).not.toHaveBeenCalled();
  });

  it('writes the generated file when run without --check', async () => {
    const { runCli } = await loadGenerator();
    const file = tempFile('old');
    runCli({ outputPath: file, args: [], exit: vi.fn(), log: vi.fn() });
    expect(readFileSync(file, 'utf8')).toContain('export const REQUIRED_COLUMNS');
  });
});
