import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArgs } from './args.mjs';

describe('parseArgs', () => {
  it('reads --kebab-case flags into camelCase keys with their values', () => {
    assert.deepEqual(parseArgs(['--base', 'abc', '--head-sha', 'def']), { base: 'abc', headSha: 'def' });
  });

  it('reads a flag with no value, or followed by another flag, as "true"', () => {
    assert.deepEqual(parseArgs(['--dry-run', '--base', 'abc', '--fix']), { dryRun: 'true', base: 'abc', fix: 'true' });
  });

  it('ignores positional arguments', () => {
    assert.deepEqual(parseArgs(['file.ts', '--base', 'abc']), { base: 'abc' });
  });
});
