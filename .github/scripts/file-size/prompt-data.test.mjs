import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPromptDataFile } from './prompt-data.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_BASE_DIR = path.resolve(HERE, '..', '..', '..', 'shared', 'prompt-base');

/** Recursively collect every file under a directory. */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe('prompt-data files', () => {
  it('matches the prompt store itself', () => {
    assert.equal(isPromptDataFile('shared/prompt-base/prompt-base.ts'), true);
  });

  it('matches files nested under shared/prompt-base/', () => {
    assert.equal(isPromptDataFile('shared/prompt-base/story-first-reels.ts'), true);
    assert.equal(isPromptDataFile('shared/prompt-base/steps/full-setup.ts'), true);
  });

  it('does not match a file merely named prompt-base elsewhere', () => {
    assert.equal(isPromptDataFile('apps/web/lib/prompt-base.ts'), false);
    assert.equal(isPromptDataFile('apps/web/lib/generation/prompt-base.ts'), false);
  });

  it('does not match the top-level shared/prompt-base.ts file', () => {
    assert.equal(isPromptDataFile('shared/prompt-base.ts'), false);
  });

  it('does not match other shared files', () => {
    assert.equal(isPromptDataFile('shared/other.ts'), false);
    assert.equal(isPromptDataFile('shared/prompt-base.md'), false);
  });

  it('holds only prompt wording, never logic or helpers', () => {
    // Every source type the exemption covers (.py, .ts, .tsx), not just
    // the .ts files the store holds today.
    const files = walk(PROMPT_BASE_DIR).filter((f) => /\.(py|tsx?)$/.test(f));
    assert.ok(files.length > 0, 'expected at least one prompt-data file');
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(text, /^\s*(import|from)\s/m, `${file} must be data only`);
      // Reject helpers, not just function/class declarations: arrow
      // functions, function expressions assigned to a const, and Python
      // defs (the exemption covers .py files too).
      assert.doesNotMatch(
        text,
        /=>|^\s*(export\s+)?(async\s+)?(function|class)\b|=\s*(async\s+)?function\s*\(|^\s*def\s/m,
        `${file} must not hold logic`,
      );
    }
  });
});
