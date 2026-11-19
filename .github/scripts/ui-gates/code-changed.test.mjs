import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterCodeChanged } from './code-changed.mjs';

function fakeGit(files, { mergeBase = 'mb' } = {}) {
  const calls = [];
  const runGit = (args) => {
    calls.push(args);
    if (args[0] === 'merge-base') {
      if (mergeBase === null) throw new Error('no merge base');
      return `${mergeBase}\n`;
    }
    if (args[0] === 'show') {
      const text = files[args[1]];
      if (text === undefined) throw new Error(`missing ${args[1]}`);
      return text;
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  return { runGit, calls };
}

const sameText = async (before, after) => before.replace(/\/\/.*$/gm, '').trim() === after.replace(/\/\/.*$/gm, '').trim();

describe('filterCodeChanged', () => {
  it('drops a comment-only file and keeps a code change, comparing the merge base to head', async () => {
    const { runGit, calls } = fakeGit({
      'mb:apps/web/a.ts': 'x(); // note',
      'HEAD:apps/web/a.ts': 'x();',
      'mb:apps/web/b.ts': 'x();',
      'HEAD:apps/web/b.ts': 'y();',
    });
    const kept = await filterCodeChanged(['apps/web/a.ts', 'apps/web/b.ts'], 'origin/main', 'HEAD', {
      runGit,
      sameCode: sameText,
    });
    assert.deepEqual(kept, ['apps/web/b.ts']);
    assert.deepEqual(calls[0], ['merge-base', 'origin/main', 'HEAD']);
    assert.ok(calls.some((c) => c[0] === 'show' && c[1] === 'mb:apps/web/a.ts'));
  });

  it('keeps a file missing on either side (new file)', async () => {
    const { runGit } = fakeGit({ 'HEAD:apps/web/new.ts': 'x();' });
    const kept = await filterCodeChanged(['apps/web/new.ts'], 'origin/main', 'HEAD', { runGit, sameCode: sameText });
    assert.deepEqual(kept, ['apps/web/new.ts']);
  });

  it('keeps every path when there is no merge base', async () => {
    const { runGit } = fakeGit({}, { mergeBase: null });
    const kept = await filterCodeChanged(['apps/web/a.ts'], 'origin/main', 'HEAD', { runGit, sameCode: sameText });
    assert.deepEqual(kept, ['apps/web/a.ts']);
  });

  it('keeps a file when the comparison throws', async () => {
    const { runGit } = fakeGit({ 'mb:apps/web/a.ts': 'x();', 'HEAD:apps/web/a.ts': 'x();' });
    const kept = await filterCodeChanged(['apps/web/a.ts'], 'origin/main', 'HEAD', {
      runGit,
      sameCode: async () => {
        throw new Error('typescript missing');
      },
    });
    assert.deepEqual(kept, ['apps/web/a.ts']);
  });

  it('passes non-code paths through without reading them', async () => {
    const { runGit, calls } = fakeGit({});
    const kept = await filterCodeChanged(['apps/web/app/globals.css'], 'origin/main', 'HEAD', {
      runGit,
      sameCode: sameText,
    });
    assert.deepEqual(kept, ['apps/web/app/globals.css']);
    assert.equal(calls.filter((c) => c[0] === 'show').length, 0);
  });
});
