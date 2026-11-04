// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';

const root = findRepoRoot(import.meta.url);

type Generator = {
  generateEngineTypes: (spec: unknown) => Promise<string>;
  runCli: (options: {
    snapshotPath: string;
    outputPath: string;
    args: string[];
    exit: (code: number) => void;
    log: (message: string) => void;
    error: (message: string) => void;
  }) => Promise<void>;
  reportCliFailure: (error: unknown) => void;
};

const loadGenerator = async (): Promise<Generator> =>
  import(join(root, 'apps/web/scripts/generate-engine-types.mjs'));

const spec = {
  openapi: '3.1.0',
  info: { title: 't', version: 'v' },
  paths: {},
  components: {
    schemas: {
      Req: {
        type: 'object',
        properties: { volume: { type: 'number', default: 0.2 } },
      },
    },
  },
};

describe('scripts/generate-engine-types.mjs CLI', () => {
  let dir = '';

  afterEach(() => {
    vi.restoreAllMocks();
    if (dir !== '') {
      rmSync(dir, { recursive: true, force: true });
      dir = '';
    }
  });

  const setup = () => {
    dir = mkdtempSync(join(tmpdir(), 'generate-engine-types-'));
    const snapshotPath = join(dir, 'openapi.json');
    const outputPath = join(dir, 'schema.gen.ts');
    writeFileSync(snapshotPath, JSON.stringify(spec));
    return { snapshotPath, outputPath };
  };

  const hooks = () => ({
    exit: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
  });

  it('writes the generated file when no --check flag is passed', async () => {
    const { generateEngineTypes, runCli } = await loadGenerator();
    const { snapshotPath, outputPath } = setup();
    const { exit, log, error } = hooks();
    await runCli({ snapshotPath, outputPath, args: ['node', 'generate-engine-types.mjs'], exit, log, error });
    expect(readFileSync(outputPath, 'utf8')).toBe(await generateEngineTypes(spec));
    expect(log).toHaveBeenCalledWith(`wrote ${outputPath}`);
    expect(exit).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('passes --check when the output is up to date', async () => {
    const { generateEngineTypes, runCli } = await loadGenerator();
    const { snapshotPath, outputPath } = setup();
    writeFileSync(outputPath, await generateEngineTypes(spec));
    const { exit, log, error } = hooks();
    await runCli({ snapshotPath, outputPath, args: ['node', 'generate-engine-types.mjs', '--check'], exit, log, error });
    expect(log).toHaveBeenCalledWith(`up to date ${outputPath}`);
    expect(exit).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('fails --check with exit 1 and leaves the file alone when the output is stale', async () => {
    const { runCli } = await loadGenerator();
    const { snapshotPath, outputPath } = setup();
    writeFileSync(outputPath, '// stale content');
    const { exit, log, error } = hooks();
    await runCli({ snapshotPath, outputPath, args: ['node', 'generate-engine-types.mjs', '--check'], exit, log, error });
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('stale'));
    expect(readFileSync(outputPath, 'utf8')).toBe('// stale content');
    expect(log).not.toHaveBeenCalled();
  });

  it('fails --check with exit 1 when the output file is missing', async () => {
    const { runCli } = await loadGenerator();
    const { snapshotPath, outputPath } = setup();
    const { exit, log, error } = hooks();
    await runCli({ snapshotPath, outputPath, args: ['node', 'generate-engine-types.mjs', '--check'], exit, log, error });
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('stale'));
    expect(log).not.toHaveBeenCalled();
  });

  it('reportCliFailure logs the error and exits 1', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as unknown as typeof process.exit);
    const { reportCliFailure } = await loadGenerator();
    const failure = new Error('boom');
    expect(() => reportCliFailure(failure)).toThrow('process.exit');
    expect(consoleSpy).toHaveBeenCalledWith(failure);
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
