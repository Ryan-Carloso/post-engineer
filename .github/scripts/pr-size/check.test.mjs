import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PR_SIZE_LIMIT,
  SIZE_LIMIT_EXEMPT_LABEL,
  countAddedLines,
  exceedsLimit,
  hasExemptLabel,
  isCountedFile,
  isExcludedFile,
  parseArgs,
  renameNewPath,
  resolveLimit,
} from './check.mjs';

describe('isCountedFile', () => {
  it('counts production extensions, including repo scripts and migrations', () => {
    for (const p of ['apps/web/lib/a.ts', 'apps/web/lib/a.tsx', 'apps/engine/app/a.py', 'apps/web/lib/a.js', '.github/scripts/file-size/check.mjs', 'apps/web/lib/a.cjs', 'supabase/migrations/030_x.sql']) {
      assert.equal(isCountedFile(p), true, p);
    }
  });

  it('does not count other extensions', () => {
    for (const p of ['AGENTS.md', '.github/workflows/pr-size.yml', 'package.json', 'style.css', 'data.json']) {
      assert.equal(isCountedFile(p), false, p);
    }
  });
});

describe('isExcludedFile', () => {
  it('excludes test directories', () => {
    for (const p of ['apps/web/lib/__tests__/a.test.ts', 'apps/engine/test/services/test_a.py', '.github/scripts/tests/test_a.py', 'apps/web/test/a.ts']) {
      assert.equal(isExcludedFile(p), true, p);
    }
  });

  it('excludes test filenames outside test directories', () => {
    for (const p of ['apps/web/lib/a.test.ts', 'apps/web/lib/a.spec.ts', 'apps/engine/app/test_foo.py', 'apps/engine/app/foo_test.py']) {
      assert.equal(isExcludedFile(p), true, p);
    }
  });

  it('excludes docs, lockfiles, and snapshots', () => {
    for (const p of ['docs/guide.md', 'README.md', 'apps/web/README', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'a.lock', 'apps/web/__snapshots__/a.snap', 'apps/web/a.snap']) {
      assert.equal(isExcludedFile(p), true, p);
    }
  });
});

describe('countAddedLines', () => {
  it('sums added lines and lists counted files, ignoring deletions', () => {
    const numstat = '10\t2\tapps/web/lib/a.ts\n5\t0\tapps/engine/app/b.py\n3\t9\tapps/web/lib/c.ts\n';
    const { files, total } = countAddedLines(numstat);
    assert.equal(total, 18);
    assert.deepEqual(files, [
      { added: 10, path: 'apps/web/lib/a.ts' },
      { added: 5, path: 'apps/engine/app/b.py' },
      { added: 3, path: 'apps/web/lib/c.ts' },
    ]);
  });

  it('skips binary rows, non-counted files, and test files', () => {
    const numstat = '-\t-\tapps/web/public/logo.png\n7\t0\tapps/web/lib/a.test.ts\n4\t0\tAGENTS.md\n6\t0\tapps/web/lib/b.ts\n';
    const { total } = countAddedLines(numstat);
    assert.equal(total, 6);
  });

  it('counts a rename with added lines and 0 for a pure rename', () => {
    const renamed = countAddedLines('12\t3\tapps/web/lib/new.ts\n');
    assert.equal(renamed.total, 12);
    const pure = countAddedLines('0\t0\tapps/web/lib/new.ts\n');
    assert.equal(pure.total, 0);
  });

  it('resolves real numstat rename notation to the head path', () => {
    assert.equal(renameNewPath('apps/web/lib/foo.{js => ts}'), 'apps/web/lib/foo.ts');
    assert.equal(renameNewPath('apps/web/lib/old.ts => apps/web/lib/new.ts'), 'apps/web/lib/new.ts');
    assert.equal(renameNewPath('apps/web/lib/{ => __tests__}/a.ts'), 'apps/web/lib/__tests__/a.ts');
    assert.equal(renameNewPath('apps/web/lib/plain.ts'), 'apps/web/lib/plain.ts');
  });

  it('counts extension-changing renames and excludes renames into test dirs', () => {
    const changed = countAddedLines('12\t3\tapps/web/lib/foo.{js => ts}\n');
    assert.equal(changed.total, 12);
    assert.equal(changed.files[0].path, 'apps/web/lib/foo.ts');
    const intoTests = countAddedLines('12\t3\tapps/web/lib/{ => __tests__}/a.ts\n');
    assert.equal(intoTests.total, 0);
    const pureRename = countAddedLines('0\t0\tapps/web/lib/foo.{js => ts}\n');
    assert.equal(pureRename.total, 0);
  });

  it('returns total 0 for empty numstat', () => {
    assert.deepEqual(countAddedLines(''), { files: [], total: 0 });
  });

  it('handles paths containing spaces', () => {
    const { files, total } = countAddedLines('8\t0\tapps/web/lib/my file.ts\n');
    assert.equal(total, 8);
    assert.equal(files[0].path, 'apps/web/lib/my file.ts');
  });

  it('counts C-quoted non-ASCII paths instead of silently dropping them', () => {
    const { files, total } = countAddedLines('8\t0\t"apps/web/lib/caf\\303\\251.ts"\n');
    assert.equal(total, 8);
    assert.equal(files[0].path, 'apps/web/lib/café.ts');
  });

  it('counts raw UTF-8 paths', () => {
    const { total } = countAddedLines('8\t0\tapps/web/lib/café.ts\n');
    assert.equal(total, 8);
  });
});

describe('exceedsLimit and exemption label', () => {
  it('uses the 800-line limit and the boundary is exclusive', () => {
    assert.equal(PR_SIZE_LIMIT, 800);
    assert.equal(exceedsLimit(800), false);
    assert.equal(exceedsLimit(801), true);
  });

  it('detects the maintainer exemption label and ignores malformed JSON', () => {
    assert.equal(hasExemptLabel(JSON.stringify([{ name: SIZE_LIMIT_EXEMPT_LABEL }])), true);
    assert.equal(hasExemptLabel(JSON.stringify([{ name: 'other' }])), false);
    assert.equal(hasExemptLabel(''), false);
    assert.equal(hasExemptLabel('not json'), false);
  });
});

describe('parseArgs and resolveLimit', () => {
  it('parses a value-less flag as true, not as the next flag', () => {
    assert.deepEqual(parseArgs(['--limit']), { limit: true });
    assert.deepEqual(parseArgs(['--limit', '--head', 'x']), { limit: true, head: 'x' });
    assert.deepEqual(parseArgs(['--limit', '500']), { limit: '500' });
  });

  it('a value-less or missing limit means the default, never a silent NaN cap', () => {
    assert.equal(resolveLimit(undefined), PR_SIZE_LIMIT);
    assert.equal(resolveLimit(true), PR_SIZE_LIMIT);
    assert.equal(resolveLimit('500'), 500);
  });

  it('rejects non-numeric, zero, and negative limits', () => {
    for (const bad of ['true', 'abc', '0', '-5', '']) {
      assert.throws(() => resolveLimit(bad), /--limit must be a positive number/, bad);
    }
  });
});
