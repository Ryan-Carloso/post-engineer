import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mutationScore } from './mutation.mjs';

// Stryker mutation.json shape: files keyed by path relative to the
// Stryker working directory (apps/web), each with a mutants array.
const REPORT = {
  files: {
    'app/(main)/account/page.tsx': {
      mutants: [
        { status: 'Killed' },
        { status: 'Killed' },
        { status: 'Survived' },
        { status: 'Timeout' },
      ],
    },
    'components/ui/account-panel.tsx': {
      mutants: [{ status: 'Killed' }, { status: 'Survived' }],
    },
    'lib/api.ts': {
      mutants: [{ status: 'Survived' }],
    },
  },
};

describe('mutationScore', () => {
  it('scores killed+timeout over total for the target files only', () => {
    const score = mutationScore(REPORT, [
      'apps/web/app/(main)/account/page.tsx',
      'apps/web/components/ui/account-panel.tsx',
    ]);
    // (2 killed + 1 timeout + 1 killed) / 6 total = 66%
    assert.equal(score.total, 6);
    assert.equal(score.killed, 3);
    assert.equal(score.survived, 2);
    assert.equal(score.timeout, 1);
    assert.equal(score.score, 66);
  });

  it('ignores mutants in files outside the target set', () => {
    const score = mutationScore(REPORT, ['apps/web/app/(main)/account/page.tsx']);
    assert.equal(score.total, 4);
    assert.equal(score.score, 75);
  });

  it('returns null when no target file has mutants', () => {
    assert.equal(mutationScore(REPORT, ['apps/web/app/other.tsx']), null);
  });

  it('returns null for an empty report', () => {
    assert.equal(mutationScore({ files: {} }, ['apps/web/app/page.tsx']), null);
    assert.equal(mutationScore(null, ['apps/web/app/page.tsx']), null);
  });

  it('floors the score like the CI summary does', () => {
    const report = { files: { 'app/a.tsx': { mutants: [{ status: 'Killed' }, { status: 'Survived' }, { status: 'Survived' }] } } };
    assert.equal(mutationScore(report, ['apps/web/app/a.tsx']).score, 33);
  });

  it('counts non-killed statuses (e.g. Ignored) in the total, like the CI summary', () => {
    const report = {
      files: { 'app/a.tsx': { mutants: [{ status: 'Killed' }, { status: 'Ignored' }, { status: 'NoCoverage' }] } },
    };
    const score = mutationScore(report, ['apps/web/app/a.tsx']);
    assert.equal(score.total, 3);
    assert.equal(score.score, 33);
  });
});
