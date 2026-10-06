import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCobertura, parseLcov, normalizeWebPath, aggregateCoverage } from './coverage.mjs';

const COBERTURA = `<?xml version="1.0" ?>
<coverage lines-valid="10" lines-covered="7" line-rate="0.7">
  <packages>
    <package name="app">
      <classes>
        <class name="page" filename="app/(main)/account/page.tsx" line-rate="0.8">
          <lines>
            <line number="1" hits="1" branch="false"/>
            <line number="2" hits="1" branch="false"/>
            <line number="3" hits="1" branch="false"/>
            <line number="4" hits="0" branch="false"/>
            <line number="5" hits="1" branch="false"/>
          </lines>
        </class>
        <class name="panel" filename="components/ui/account-panel.tsx" line-rate="0.6">
          <lines>
            <line number="1" hits="1" branch="false"/>
            <line number="2" hits="1" branch="false"/>
            <line number="3" hits="1" branch="false"/>
            <line number="4" hits="0" branch="false"/>
            <line number="5" hits="0" branch="false"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>`;

const LCOV = `TN:
SF:app/(main)/account/page.tsx
DA:1,1
DA:2,1
DA:3,1
DA:4,0
DA:5,1
LF:5
LH:4
end_of_record
SF:components/ui/account-panel.tsx
DA:1,2
DA:2,0
DA:3,0
LF:3
LH:1
end_of_record
`;

describe('normalizeWebPath', () => {
  it('prepends apps/web/ to app-relative paths', () => {
    assert.equal(normalizeWebPath('app/(main)/account/page.tsx'), 'apps/web/app/(main)/account/page.tsx');
  });

  it('leaves repo-relative paths untouched', () => {
    assert.equal(normalizeWebPath('apps/web/app/page.tsx'), 'apps/web/app/page.tsx');
  });
});

describe('parseCobertura', () => {
  it('counts covered/total lines per file', () => {
    const perFile = parseCobertura(COBERTURA);
    assert.deepEqual(perFile.get('app/(main)/account/page.tsx'), { covered: 4, total: 5 });
    assert.deepEqual(perFile.get('components/ui/account-panel.tsx'), { covered: 3, total: 5 });
  });

  it('returns an empty map for malformed input', () => {
    assert.equal(parseCobertura('not xml').size, 0);
  });
});

describe('parseLcov', () => {
  it('counts covered/total DA records per file', () => {
    const perFile = parseLcov(LCOV);
    assert.deepEqual(perFile.get('app/(main)/account/page.tsx'), { covered: 4, total: 5 });
    assert.deepEqual(perFile.get('components/ui/account-panel.tsx'), { covered: 1, total: 3 });
  });

  it('returns an empty map for empty input', () => {
    assert.equal(parseLcov('').size, 0);
  });
});

describe('aggregateCoverage', () => {
  it('sums covered/total across the target files only', () => {
    const perFile = new Map([
      ['apps/web/app/(main)/account/page.tsx', { covered: 4, total: 5 }],
      ['apps/web/components/ui/account-panel.tsx', { covered: 3, total: 5 }],
      ['apps/web/lib/api.ts', { covered: 100, total: 100 }],
    ]);
    const agg = aggregateCoverage(perFile, [
      'apps/web/app/(main)/account/page.tsx',
      'apps/web/components/ui/account-panel.tsx',
    ]);
    assert.equal(agg.covered, 7);
    assert.equal(agg.total, 10);
    assert.deepEqual(agg.missing, []);
  });

  it('lists files with no coverage data as missing', () => {
    const perFile = new Map([['apps/web/app/page.tsx', { covered: 1, total: 2 }]]);
    const agg = aggregateCoverage(perFile, ['apps/web/app/page.tsx', 'apps/web/app/other.tsx']);
    assert.equal(agg.covered, 1);
    assert.equal(agg.total, 2);
    assert.deepEqual(agg.missing, ['apps/web/app/other.tsx']);
  });

  it('skips files with zero coverable lines', () => {
    const perFile = new Map([
      ['apps/web/app/empty.tsx', { covered: 0, total: 0 }],
      ['apps/web/app/page.tsx', { covered: 1, total: 2 }],
    ]);
    const agg = aggregateCoverage(perFile, ['apps/web/app/empty.tsx', 'apps/web/app/page.tsx']);
    assert.equal(agg.covered, 1);
    assert.equal(agg.total, 2);
  });
});
