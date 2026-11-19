import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECK = path.join(HERE, 'check.mjs');

function runCheck(fixtures) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-size-it-'));
  const fixturesFile = path.join(dir, 'fixtures.json');
  fs.writeFileSync(fixturesFile, JSON.stringify(fixtures));
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    stdout = execFileSync('node', [CHECK, '--fixtures', fixturesFile], {
      encoding: 'utf8',
    });
  } catch (err) {
    exitCode = err.status ?? 1;
    stdout = err.stdout?.toString() ?? '';
    stderr = err.stderr?.toString() ?? '';
  }
  return { stdout, stderr, exitCode };
}

const A = (p, lines) => ({ path: p, status: 'A', baseLines: null, headLines: lines });
const M = (p, base, head) => ({ path: p, status: 'M', baseLines: base, headLines: head });
const D = (p, base) => ({ path: p, status: 'D', baseLines: base, headLines: null });

describe('file-size ratchet (added files)', () => {
  it('fails for a new file above the 500-line cap', () => {
    const { stdout, exitCode } = runCheck([A('apps/engine/app/services/voice.py', 1822)]);
    assert.equal(exitCode, 1);
    assert.match(stdout, /::error file=apps\/engine\/app\/services\/voice\.py::/);
    assert.match(stdout, /1822/);
    assert.match(stdout, /500/);
  });

  it('passes for a new file exactly at the cap', () => {
    const { stdout, exitCode } = runCheck([A('apps/web/lib/small.ts', 500)]);
    assert.equal(exitCode, 0);
    assert.ok(!stdout.includes('::error'), `unexpected error:\n${stdout}`);
  });

  it('passes for a new file below the cap', () => {
    const { exitCode } = runCheck([A('apps/web/lib/small.ts', 120)]);
    assert.equal(exitCode, 0);
  });
});

describe('file-size ratchet (modified files)', () => {
  it('fails when a modification grows a file past the cap', () => {
    const { stdout, exitCode } = runCheck([M('apps/engine/app/services/task.py', 400, 520)]);
    assert.equal(exitCode, 1);
    assert.match(stdout, /::error file=apps\/engine\/app\/services\/task\.py::/);
  });

  it('fails when a grandfathered file grows at all (true ratchet, no loophole)', () => {
    const { stdout, exitCode } = runCheck([M('apps/engine/app/services/task.py', 1607, 1612)]);
    assert.equal(exitCode, 1);
    assert.match(stdout, /::error/);
    assert.match(stdout, /1607/);
    assert.match(stdout, /1612/);
  });

  it('passes when a grandfathered file shrinks', () => {
    const { stdout, exitCode } = runCheck([M('apps/engine/app/services/task.py', 1607, 1500)]);
    assert.equal(exitCode, 0);
    assert.ok(!stdout.includes('::error'), `unexpected error:\n${stdout}`);
  });

  it('passes when a modification shrinks a file below the cap', () => {
    const { exitCode } = runCheck([M('apps/engine/app/services/task.py', 520, 480)]);
    assert.equal(exitCode, 0);
  });

  it('passes when a grandfathered file is untouched (same line count)', () => {
    const { exitCode } = runCheck([M('apps/engine/app/services/task.py', 1607, 1607)]);
    assert.equal(exitCode, 0);
  });

  it('passes for growth that stays under the cap', () => {
    const { exitCode } = runCheck([M('apps/web/lib/small.ts', 100, 200)]);
    assert.equal(exitCode, 0);
  });

  it('ignores deleted files', () => {
    const { exitCode } = runCheck([D('apps/engine/app/services/voice.py', 1822)]);
    assert.equal(exitCode, 0);
  });
});

describe('file-size ratchet (exemptions)', () => {
  it('ignores test files even above the cap', () => {
    const { exitCode } = runCheck([
      A('apps/engine/test/test_task.py', 900),
      A('apps/web/lib/api.test.ts', 700),
      A('apps/web/lib/util_test.ts', 650),
      A('apps/web/__tests__/page.test.tsx', 800),
    ]);
    assert.equal(exitCode, 0);
  });

  it('ignores generated *.gen.<ext> files even when huge', () => {
    const { exitCode } = runCheck([A('apps/web/lib/engine/schema.gen.ts', 2004)]);
    assert.equal(exitCode, 0);
  });

  it('still checks a file whose name merely contains "gen"', () => {
    const { exitCode } = runCheck([A('apps/web/lib/general.ts', 501)]);
    assert.equal(exitCode, 1);
  });

  it('ignores supabase migrations', () => {
    const { exitCode } = runCheck([A('supabase/migrations/20261011_big_seed.ts', 900)]);
    assert.equal(exitCode, 0);
  });

  it('ignores non-source files (markdown, lockfiles) even when huge', () => {
    const { exitCode } = runCheck([
      A('docs/BIG-DESIGN.md', 2000),
      A('pnpm-lock.yaml', 50000),
      A('uv.lock', 30000),
    ]);
    assert.equal(exitCode, 0);
  });

  it('still checks source files nested under test dirs for other extensions only', () => {
    const { exitCode } = runCheck([
      A('apps/engine/test/test_task.py', 900),
      A('apps/engine/app/services/newmod.py', 501),
    ]);
    assert.equal(exitCode, 1);
  });
});

describe('file-size ratchet (multiple violations)', () => {
  it('emits one ::error per violation and exits 1', () => {
    const { stdout, exitCode } = runCheck([
      A('apps/engine/app/a.py', 600),
      M('apps/engine/app/b.py', 1600, 1610),
      A('apps/engine/app/c.py', 10),
    ]);
    assert.equal(exitCode, 1);
    const errors = stdout.split('\n').filter((l) => l.startsWith('::error'));
    assert.equal(errors.length, 2);
    assert.ok(errors.some((l) => l.includes('apps/engine/app/a.py')));
    assert.ok(errors.some((l) => l.includes('apps/engine/app/b.py')));
  });
});

describe('file-size ratchet (prompt-data files)', () => {
  it('passes for a new prompt file above the cap', () => {
    const { exitCode, stdout } = runCheck([A('shared/prompt-base/prompt-base.ts', 600)]);
    assert.equal(exitCode, 0, stdout);
  });

  it('passes when a prompt file grows past the cap', () => {
    const { exitCode, stdout } = runCheck([
      M('shared/prompt-base/prompt-base.ts', 499, 520),
    ]);
    assert.equal(exitCode, 0, stdout);
  });

  it('passes for a prompt file nested under shared/prompt-base/', () => {
    const { exitCode, stdout } = runCheck([A('shared/prompt-base/story-first-reels.ts', 700)]);
    assert.equal(exitCode, 0, stdout);
  });

  it('still fails for our own file above the cap next to a prompt one', () => {
    const { stdout, exitCode } = runCheck([
      M('shared/prompt-base/prompt-base.ts', 499, 520),
      A('apps/web/lib/some-module.ts', 501),
    ]);
    assert.equal(exitCode, 1);
    const errors = stdout.split('\n').filter((l) => l.startsWith('::error'));
    assert.equal(errors.length, 1);
    assert.ok(errors[0].includes('apps/web/lib/some-module.ts'));
  });

  it('still fails for a file merely named prompt-base elsewhere', () => {
    const { stdout, exitCode } = runCheck([A('apps/web/lib/prompt-base.ts', 501)]);
    assert.equal(exitCode, 1);
    assert.match(stdout, /::error file=apps\/web\/lib\/prompt-base\.ts::/);
  });

  it('still fails for the top-level shared/prompt-base.ts file', () => {
    const { stdout, exitCode } = runCheck([A('shared/prompt-base.ts', 501)]);
    assert.equal(exitCode, 1);
    assert.match(stdout, /::error file=shared\/prompt-base\.ts::/);
  });
});

describe('file-size ratchet (vendored CalendarCN)', () => {
  it('passes for a vendored file above the cap', () => {
    const { exitCode, stdout } = runCheck([A('apps/web/components/calendar-provider.tsx', 3141)]);
    assert.equal(exitCode, 0, stdout);
  });

  it('passes for a vendored lib file above the cap', () => {
    const { exitCode, stdout } = runCheck([A('apps/web/lib/event-utils.ts', 2055)]);
    assert.equal(exitCode, 0, stdout);
  });

  it('still fails for our own file above the cap next to a vendored one', () => {
    const { stdout, exitCode } = runCheck([
      A('apps/web/components/calendar-provider.tsx', 3141),
      A('apps/web/app/(main)/posts/calendar-provider.tsx', 501),
    ]);
    assert.equal(exitCode, 1);
    const errors = stdout.split('\n').filter((l) => l.startsWith('::error'));
    assert.equal(errors.length, 1);
    assert.ok(errors[0].includes('apps/web/app/(main)/posts/calendar-provider.tsx'));
  });
});
