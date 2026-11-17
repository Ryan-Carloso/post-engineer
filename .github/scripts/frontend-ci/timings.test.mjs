import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseCobertura } from '../ui-gates/coverage.mjs';
import { durationsFromVitestJson, mergeTimings } from './timings.mjs';
import { mergeCobertura } from './merge-cobertura.mjs';
import { configForBunCheck } from './prepare-bun-tsconfig.mjs';

describe('durationsFromVitestJson', () => {
  it('stores the file duration relative to the app root', () => {
    const root = path.resolve('/work/apps/web');
    const timings = durationsFromVitestJson({
      testResults: [
        {
          name: path.join(root, 'lib', '__tests__', 'a.test.ts'),
          startTime: 1_000,
          endTime: 1_250,
        },
        { name: 'not-a-file', startTime: 'x', endTime: 1 },
      ],
    }, root);
    assert.deepEqual(timings.files, { 'lib/__tests__/a.test.ts': 250 });
  });
});

describe('mergeTimings', () => {
  it('keeps previous files and overwrites the ones this run measured', () => {
    const merged = mergeTimings([
      { files: { 'a.test.ts': 10, 'b.test.ts': 20 } },
      { files: { 'b.test.ts': 5, 'c.test.ts': 7 } },
    ]);
    assert.deepEqual(merged.files, { 'a.test.ts': 10, 'b.test.ts': 5, 'c.test.ts': 7 });
  });
});

describe('mergeCobertura', () => {
  it('sums hits and stays readable by the UI coverage gate', () => {
    const first = `
      <coverage>
        <packages><package><classes>
          <class name="a" filename="lib/a.ts"><lines>
            <line number="1" hits="1" branch="true" condition-coverage="50% (1/2)"/>
            <line number="2" hits="0" branch="false"/>
          </lines></class>
        </classes></package></packages>
      </coverage>`;
    const second = `
      <coverage>
        <packages><package><classes>
          <class name="a" filename="lib/a.ts"><lines>
            <line hits="2" number="1" branch="true" condition-coverage="100% (2/2)"/>
            <line number="3" hits="1" branch="false"/>
          </lines></class>
        </classes></package></packages>
      </coverage>`;
    const merged = mergeCobertura([first, second]);
    const parsed = parseCobertura(merged);
    assert.deepEqual(parsed.get('lib/a.ts'), { covered: 2, total: 3 });
    assert.match(merged, /number="1" hits="3"/);
    assert.match(merged, /condition-coverage="100% \(2\/2\)"/);
  });

  it('emits an empty report when no shard produced coverage', () => {
    const merged = mergeCobertura([]);
    assert.equal(parseCobertura(merged).size, 0);
    assert.match(merged, /<coverage /);
  });
});

describe('configForBunCheck', () => {
  it('removes baseUrl and keeps the path mapping', () => {
    const next = configForBunCheck({
      extends: '../../tsconfig.base.json',
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['./*'] }, jsx: 'preserve' },
      include: ['**/*.ts'],
    });
    assert.equal(Object.hasOwn(next.compilerOptions, 'baseUrl'), false);
    assert.deepEqual(next.compilerOptions.paths, { '@/*': ['./*'] });
    assert.equal(next.extends, '../../tsconfig.base.json');
    assert.deepEqual(next.include, ['**/*.ts']);
  });

  it('matches the committed web tsconfig once baseUrl is removed', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const source = JSON.parse(readFileSync(path.join(repoRoot, 'apps/web/tsconfig.json'), 'utf8'));
    assert.equal(source.compilerOptions.baseUrl, '.');
    const next = configForBunCheck(source);
    assert.equal(Object.hasOwn(next.compilerOptions, 'baseUrl'), false);
    assert.deepEqual(next.compilerOptions.paths, source.compilerOptions.paths);
  });
});
