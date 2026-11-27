import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { CONFIG_PATH, VENDORED_FILES, buildConfig, clonesFromReport, describeClone, run } from './check.mjs';

const ROOT = '/repo';

function clone(first, second, tokens = 120) {
  return {
    tokens,
    lines: 12,
    firstFile: { name: `${ROOT}/${first}`, start: 1, end: 12 },
    secondFile: { name: `${ROOT}/${second}`, start: 20, end: 31 },
  };
}

describe('buildConfig', () => {
  it('makes the scanned paths absolute and ignores every vendored file', () => {
    const config = buildConfig(ROOT, { path: ['apps/web'], ignore: ['**/x/**'], minTokens: 100 }, '/tmp/out');
    assert.deepEqual(config.path, [path.join(ROOT, 'apps/web')]);
    assert.equal(config.ignore[0], '**/x/**');
    assert.equal(config.ignore.length, 1 + VENDORED_FILES.length);
    assert.ok(config.ignore.includes(path.join(ROOT, 'apps/web/components/calendar-provider.tsx')));
    assert.deepEqual(config.reporters, ['json']);
    assert.equal(config.output, '/tmp/out');
    assert.equal(config.minTokens, 100);
  });
});

describe('clonesFromReport', () => {
  it('reports repo-relative clones, biggest first', () => {
    const report = { duplicates: [clone('apps/web/a.ts', 'apps/web/b.ts', 110), clone('apps/mcp/c.ts', 'apps/mcp/d.ts', 150)] };
    const clones = clonesFromReport(ROOT, report);
    assert.deepEqual(clones.map((c) => c.first.file), ['apps/mcp/c.ts', 'apps/web/a.ts']);
    assert.deepEqual(clones[1].second, { file: 'apps/web/b.ts', start: 20, end: 31 });
  });

  it('drops a clone that touches a vendored file', () => {
    const report = { duplicates: [clone('apps/web/components/calendar-provider.tsx', 'apps/web/lib/x.ts')] };
    assert.deepEqual(clonesFromReport(ROOT, report), []);
  });
});

describe('describeClone', () => {
  it('names both copies with their line ranges and size', () => {
    const [found] = clonesFromReport(ROOT, { duplicates: [clone('a.ts', 'b.ts')] });
    assert.equal(describeClone(found), 'a.ts:1-12 == b.ts:20-31 (12 lines, 120 tokens)');
  });
});

describe('the repository', () => {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

  it('keeps the thresholds the AGENTS.md rule names', () => {
    const config = JSON.parse(readFileSync(path.join(root, CONFIG_PATH), 'utf8'));
    assert.equal(config.minTokens, 100);
    assert.equal(config.minLines, 10);
  });

  it('has no copy-pasted block', () => {
    assert.deepEqual(run(root).map(describeClone), []);
  });
});
