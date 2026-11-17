import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignShards, readTimings, WEB_SHARD_TOTAL } from './shard-tests.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('assignShards', () => {
  it('puts the slow file on its own shard and fills the other with the short ones', () => {
    const bins = assignShards(['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'], {
      files: { 'a.test.ts': 100, 'b.test.ts': 1, 'c.test.ts': 1, 'd.test.ts': 1 },
    }, 2);
    assert.deepEqual(bins[0], ['a.test.ts']);
    assert.deepEqual(bins[1], ['b.test.ts', 'c.test.ts', 'd.test.ts']);
  });

  it('covers each file once', () => {
    const files = ['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts', 'e.test.ts'];
    const bins = assignShards(files, { files: { 'a.test.ts': 50, 'e.test.ts': 40 } }, 4);
    const flat = bins.flat().sort();
    assert.deepEqual(flat, [...files].sort());
    assert.equal(new Set(flat).size, files.length);
  });

  it('is stable for the same inputs', () => {
    const timings = { files: { 'b.test.ts': 5, 'a.test.ts': 9 } };
    const first = assignShards(['a.test.ts', 'b.test.ts', 'c.test.ts'], timings, 3);
    const second = assignShards(['a.test.ts', 'b.test.ts', 'c.test.ts'], timings, 3);
    assert.deepEqual(first, second);
  });

  it('gives an unknown file the lower median duration', () => {
    // Known durations 10 and 30. Lower median is 10, so the unknown file
    // shares a shard with the 10ms file and the 30ms file sits alone.
    const bins = assignShards(['a.test.ts', 'b.test.ts', 'c.test.ts'], {
      files: { 'a.test.ts': 10, 'b.test.ts': 30 },
    }, 2);
    assert.deepEqual(bins[0], ['b.test.ts']);
    assert.deepEqual(bins[1], ['a.test.ts', 'c.test.ts']);
  });

  it('rejects a non-positive shard total', () => {
    assert.throws(() => assignShards(['a.test.ts'], {}, 0), /shard total/);
  });
});

describe('readTimings', () => {
  it('drops non-numeric durations', () => {
    assert.deepEqual(readTimings({ files: { 'a.test.ts': 12, 'b.test.ts': 'nope', 'c.test.ts': -1 } }), {
      'a.test.ts': 12,
    });
  });

  it('accepts a missing file', () => {
    assert.deepEqual(readTimings(null), {});
  });
});

describe('WEB_SHARD_TOTAL', () => {
  it('matches the frontend-ci workflow matrix', () => {
    const workflow = readFileSync(path.join(repoRoot, '.github/workflows/frontend-ci.yml'), 'utf8');
    const match = workflow.match(/shard:\s*\[([^\]]+)\]/);
    assert.ok(match, 'frontend-ci.yml must declare a shard matrix');
    const shards = match[1].split(',').map((part) => part.trim()).filter((part) => part.length > 0);
    assert.equal(shards.length, WEB_SHARD_TOTAL);
    assert.deepEqual(shards, ['1', '2', '3', '4']);
  });
});
