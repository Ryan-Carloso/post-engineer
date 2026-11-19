import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPromptDataFile } from './prompt-data.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_BASE_DIR = path.resolve(HERE, '..', '..', '..', 'shared', 'prompt-base');

// The guard itself: prompt-data files hold wording only. The patterns live
// here so the negative cases below exercise exactly what the real-files
// test enforces.
// DATA_ONLY_PATTERN rejects module wiring: dynamic import, require calls,
// static imports, side-effect imports, re-exports (the barrel a
// re-attempted split would use), and Python imports. The re-export arm is
// deliberately bounded: an unbounded `[\s\S]*?` between `export` and
// `from '...'` false-positives on the real prompt file, whose wording
// contains `from'` (a string literal ending in "from"). So single-line
// re-exports match on one line with a non-empty path, and multi-line ones
// only through their braces (`export { ... } from '...'`).
const DATA_ONLY_PATTERN =
  /\b(import|require)\s*\(|^\s*(import|export)\b[^\n]*\bfrom\s*['"][^'"\n]*['"]|^\s*(import|export)\s*\{[^}]*\}\s*from\s*['"][^'"\n]+['"]|^\s*import\s*['"]|^\s*(import|from)\s+\w/m;
// NO_LOGIC_PATTERN rejects helpers: arrow functions, function/class
// declarations (including `export default`), function/class expressions
// assigned to a const (named or anonymous), call expressions assigned to a
// const — bare (`export const X = buildPrompt();`) or member
// (`export const X = base.slice(1);`) — top-level calls
// (`os.system('x')`), and Python defs (the exemption covers .py files too).
const NO_LOGIC_PATTERN =
  /=>|^\s*(async\s+)?def\s|^\s*(export\s+(default\s+)?)?(async\s+)?(function|class)\b|=\s*(async\s+)?(function|class)\b|=\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\(|^\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\(/m;

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
      assert.doesNotMatch(text, DATA_ONLY_PATTERN, `${file} must be data only`);
      assert.doesNotMatch(text, NO_LOGIC_PATTERN, `${file} must not hold logic`);
    }
  });

  it('rejects default-exported helpers', () => {
    assert.match('export default function buildPrompt() {}', NO_LOGIC_PATTERN);
    assert.match('export default class X {}', NO_LOGIC_PATTERN);
  });

  it('rejects named function and class expressions', () => {
    assert.match('const h = function named() {}', NO_LOGIC_PATTERN);
    assert.match('const h = class {}', NO_LOGIC_PATTERN);
  });

  it('rejects re-exports, dynamic imports and require calls', () => {
    assert.match("export * from './x'", DATA_ONLY_PATTERN);
    assert.match("export { h } from './x'", DATA_ONLY_PATTERN);
    assert.match("import('./x')", DATA_ONLY_PATTERN);
    assert.match("require('./x')", DATA_ONLY_PATTERN);
  });

  it('rejects call expressions assigned to a const', () => {
    assert.match('export const X = buildPrompt();', NO_LOGIC_PATTERN);
    assert.match('export const X = base.slice(1);', NO_LOGIC_PATTERN);
  });

  it('rejects multi-line re-exports and imports', () => {
    assert.match("export {\n  h,\n} from './x'", DATA_ONLY_PATTERN);
    assert.match('import {\n  a,\n  b\n} from "./y"', DATA_ONLY_PATTERN);
  });

  it('rejects Python imports and top-level calls', () => {
    assert.match('import os\nos.system("x")', DATA_ONLY_PATTERN);
    assert.match('import os\nos.system("x")', NO_LOGIC_PATTERN);
    assert.match('from x import y', DATA_ONLY_PATTERN);
  });

  it('rejects async Python definitions', () => {
    assert.match('async def f():', NO_LOGIC_PATTERN);
  });

  it('keeps rejecting the helper shapes the guard already caught', () => {
    assert.match('const h = async function() {}', NO_LOGIC_PATTERN);
    assert.match('export async function f() {}', NO_LOGIC_PATTERN);
    assert.match('const h = () => {}', NO_LOGIC_PATTERN);
  });
});
