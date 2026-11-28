import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseVitestList } from './run-shard.mjs';

describe('parseVitestList', () => {
  it('drops the vitest project prefix from each listed file', () => {
    const stdout = '[dom] lib/__tests__/a.test.ts\n[node] app/api/x/__tests__/route.node.test.ts\n';
    assert.deepEqual(parseVitestList(stdout, '/repo/apps/web'), [
      'app/api/x/__tests__/route.node.test.ts',
      'lib/__tests__/a.test.ts',
    ]);
  });

  it('keeps unprefixed lines and skips files outside the app root', () => {
    const stdout = 'lib/__tests__/a.test.tsx\n/elsewhere/b.test.ts\nnot a test\n';
    assert.deepEqual(parseVitestList(stdout, '/repo/apps/web'), ['lib/__tests__/a.test.tsx']);
  });
});
