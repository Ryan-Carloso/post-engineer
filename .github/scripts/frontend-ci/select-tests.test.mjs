import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { planShard } from './run-shard.mjs';
import {
  isRelevantSource,
  isWebTestFile,
  listAllTestFiles,
  parseNameStatus,
  selectTestFiles,
  shouldRunAll,
  WEB_VITEST_INCLUDE,
} from './select-tests.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const allFiles = ['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'];

describe('shouldRunAll', () => {
  it('runs everything when the vitest config, lockfile, or workflow changes', () => {
    assert.equal(shouldRunAll(['apps/web/vitest.config.ts']), true);
    assert.equal(shouldRunAll(['pnpm-lock.yaml']), true);
    assert.equal(shouldRunAll(['.github/workflows/frontend-ci.yml']), true);
    assert.equal(shouldRunAll(['apps/web/test/setup.ts']), true);
  });

  it('runs everything for a non-module file under the web app', () => {
    assert.equal(shouldRunAll(['apps/web/app/globals.css']), true);
    assert.equal(shouldRunAll(['apps/web/lib/fixtures/sample.json']), true);
  });

  it('runs everything for an MCP-only diff, which web tests read from disk', () => {
    assert.equal(shouldRunAll(['apps/mcp/src/analytics.ts']), true);
    assert.equal(shouldRunAll(['apps/mcp/src/http-auth.ts']), true);
    assert.equal(shouldRunAll(['apps/mcp/src/__tests__/parity-endpoint-tools.json']), true);
  });

  it('runs everything for a disk-read non-module file under shared/', () => {
    assert.equal(shouldRunAll(['shared/ssrf/public-ip-cases.json']), true);
  });

  it('does not run everything for a doc', () => {
    assert.equal(shouldRunAll(['docs/other-guide.md']), false);
  });

  it('does not run everything for a recipe doc, since no web test reads docs/recipes any more', () => {
    assert.equal(shouldRunAll(['docs/recipes/full-setup.md']), false);
  });

  it('does not force a full run for a cypress spec or a single source file', () => {
    assert.equal(shouldRunAll(['apps/web/cypress/e2e/login.cy.ts']), false);
    assert.equal(shouldRunAll(['apps/web/lib/timezone.ts']), false);
    assert.equal(shouldRunAll(['README.md']), false);
    assert.equal(shouldRunAll(['supabase/migrations/048_scheduled-posts-music-mood.sql']), true);
    assert.equal(shouldRunAll(['supabase/schema.snapshot.json']), true);
    assert.equal(shouldRunAll(['apps/mcp/src/index.ts']), true);
  });
});

describe('selectTestFiles', () => {
  it('runs the full suite on main', () => {
    const selected = selectTestFiles({
      event: 'push',
      changedPaths: [],
      forceAll: false,
      allFiles,
      listedChanged: ['a.test.ts'],
      listChangedFailed: false,
    });
    assert.equal(selected.mode, 'all');
    assert.deepEqual(selected.files, allFiles);
  });

  it('keeps the changed list on a pull request', () => {
    const selected = selectTestFiles({
      event: 'pull_request',
      changedPaths: ['apps/web/lib/timezone.ts'],
      forceAll: false,
      allFiles,
      listedChanged: ['b.test.ts'],
      listChangedFailed: false,
    });
    assert.equal(selected.mode, 'affected');
    assert.deepEqual(selected.files, ['b.test.ts']);
  });

  it('falls back to the full suite when a source edit selects nothing', () => {
    const selected = selectTestFiles({
      event: 'pull_request',
      changedPaths: ['shared/contracts/prompts.ts'],
      forceAll: false,
      allFiles,
      listedChanged: [],
      listChangedFailed: false,
    });
    assert.equal(selected.mode, 'all');
  });

  it('skips tests when the diff does not touch source', () => {
    const selected = selectTestFiles({
      event: 'pull_request',
      changedPaths: ['README.md'],
      forceAll: false,
      allFiles,
      listedChanged: [],
      listChangedFailed: false,
    });
    assert.equal(selected.mode, 'none');
    assert.deepEqual(selected.files, []);
  });

  it('runs the full suite for an MCP-only diff that selects nothing', () => {
    const selected = selectTestFiles({
      event: 'pull_request',
      changedPaths: ['apps/mcp/src/http-auth.ts'],
      forceAll: false,
      allFiles,
      listedChanged: [],
      listChangedFailed: false,
    });
    assert.equal(selected.mode, 'all');
    assert.deepEqual(selected.files, allFiles);
  });

  it('runs the full suite when changed-test discovery fails', () => {
    const selected = selectTestFiles({
      event: 'pull_request',
      changedPaths: ['apps/web/lib/timezone.ts'],
      forceAll: false,
      allFiles,
      listedChanged: [],
      listChangedFailed: true,
    });
    assert.equal(selected.mode, 'all');
  });
});

describe('planShard', () => {
  it('gives every selected file to exactly one shard', () => {
    const seen = [];
    for (let shard = 1; shard <= 4; shard += 1) {
      const plan = planShard({
        event: 'push',
        changedPaths: [],
        forceAll: false,
        allFiles,
        listedChanged: [],
        listChangedFailed: false,
        timings: { files: { 'a.test.ts': 80 } },
        shard,
        total: 4,
      });
      assert.equal(plan.mode, 'all');
      seen.push(...plan.files);
    }
    assert.deepEqual(seen.sort(), [...allFiles].sort());
  });
});

describe('parseNameStatus', () => {
  it('flags a deleted web source file as a full run', () => {
    const parsed = parseNameStatus('M\tapps/web/lib/timezone.ts\nD\tapps/web/lib/old.ts\n');
    assert.deepEqual(parsed.changed, ['apps/web/lib/timezone.ts', 'apps/web/lib/old.ts']);
    assert.equal(parsed.forceAll, true);
  });

  it('does not force a full run for an edit', () => {
    const parsed = parseNameStatus('M\tapps/web/lib/timezone.ts\n');
    assert.equal(parsed.forceAll, false);
  });
});

describe('listAllTestFiles', () => {
  it('keeps tests under __tests__ and skips node_modules', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'frontend-ci-'));
    await mkdir(path.join(root, 'lib', '__tests__'), { recursive: true });
    await mkdir(path.join(root, 'node_modules', '__tests__'), { recursive: true });
    await mkdir(path.join(root, 'app', 'api', 'coverage', '__tests__'), { recursive: true });
    await mkdir(path.join(root, 'coverage', '__tests__'), { recursive: true });
    await mkdir(path.join(root, 'cypress', 'support', '__tests__'), { recursive: true });
    await writeFile(path.join(root, 'lib', '__tests__', 'a.test.ts'), '');
    await writeFile(path.join(root, 'lib', 'not.test.ts'), '');
    await writeFile(path.join(root, 'node_modules', '__tests__', 'skip.test.ts'), '');
    await writeFile(path.join(root, 'app', 'api', 'coverage', '__tests__', 'route.test.ts'), '');
    await writeFile(path.join(root, 'coverage', '__tests__', 'report.test.ts'), '');
    await writeFile(path.join(root, 'cypress', 'support', '__tests__', 'login-command.test.ts'), '');
    assert.deepEqual(await listAllTestFiles(root), [
      'app/api/coverage/__tests__/route.test.ts',
      'cypress/support/__tests__/login-command.test.ts',
      'lib/__tests__/a.test.ts',
    ]);
  });
});

describe('path helpers', () => {
  it('recognises a web unit test and a relevant source file', () => {
    assert.equal(isWebTestFile('lib/__tests__/a.test.tsx'), true);
    assert.equal(isWebTestFile('lib/a.test.ts'), false);
    assert.equal(isRelevantSource('apps/web/lib/timezone.ts'), true);
    assert.equal(isRelevantSource('apps/web/types/css-side-effect.d.ts'), false);
    assert.equal(isRelevantSource('README.md'), false);
  });
});

describe('WEB_VITEST_INCLUDE', () => {
  it('matches the include list in apps/web/vitest.config.ts', () => {
    const config = readFileSync(path.join(repoRoot, 'apps/web/vitest.config.ts'), 'utf8');
    assert.ok(
      config.includes(`include: ['${WEB_VITEST_INCLUDE}']`),
      'vitest include drifted from WEB_VITEST_INCLUDE',
    );
  });
});
