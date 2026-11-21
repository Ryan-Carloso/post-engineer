#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WEB_ROOT = 'apps/web/';
const SOURCE_FILE = /\.(ts|tsx)$/;
const NOT_PRODUCTION = /(^|\/)(__tests__|test|tests|cypress|node_modules)\/|\.(test|spec|cy)\.[a-z]+$|\.gen\.[a-z]+$/;
const REPORTS_ERROR = /\b(setError|setResult|onError)\s*\(/;
const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;
const BINDING_PATTERN = /^\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)/;

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function skipQuoted(text, start) {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i + 1;
    i += 1;
  }
  return text.length;
}

function skipLineComment(text, start) {
  const end = text.indexOf('\n', start);
  return end === -1 ? text.length : end;
}

function skipBlockComment(text, start) {
  const end = text.indexOf('*/', start + 2);
  return end === -1 ? text.length : end + 2;
}

function skipNonCode(text, start) {
  const c = text[start];
  if (c === "'" || c === '"' || c === '`') return skipQuoted(text, start);
  if (c === '/' && text[start + 1] === '/') return skipLineComment(text, start);
  if (c === '/' && text[start + 1] === '*') return skipBlockComment(text, start);
  return start;
}

function matchClosingBrace(text, open) {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const next = skipNonCode(text, i);
    if (next !== i) {
      i = next;
      continue;
    }
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return text.length;
}

function startsWord(text, index, word) {
  if (!text.startsWith(word, index)) return false;
  if (index > 0 && IDENTIFIER_CHAR.test(text[index - 1])) return false;
  const after = text[index + word.length];
  return after === undefined || !IDENTIFIER_CHAR.test(after);
}

function bindingIsUsed(block, binding) {
  return new RegExp(`\\b${binding}\\b(?!\\s*:)`).test(block);
}

function isOutsideNestedRanges(index, ranges) {
  return !ranges.some(([start, end]) => index >= start && index < end);
}

function collectCatches(text) {
  const catches = [];
  let i = 0;
  while (i < text.length) {
    const next = skipNonCode(text, i);
    if (next !== i) {
      i = next;
      continue;
    }
    if (startsWord(text, i, 'catch')) {
      let j = i + 'catch'.length;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      let binding = null;
      if (text[j] === '(') {
        const matched = BINDING_PATTERN.exec(text.slice(j, j + 128));
        if (matched) {
          binding = matched[1];
          j += matched[0].length;
          while (j < text.length && /\s/.test(text[j])) j += 1;
        }
      }
      if (text[j] === '{') {
        const close = matchClosingBrace(text, j);
        catches.push({ index: i, binding, open: j, close });
        i = j + 1;
        continue;
      }
    }
    i += 1;
  }
  return catches;
}

export function findDiscardedErrorViolations(text) {
  const violations = [];
  const catches = collectCatches(text);
  for (const caught of catches) {
    const block = text.slice(caught.open, caught.close + 1);
    const nested = catches
      .filter((other) => other.open > caught.open && other.close < caught.close)
      .map((other) => [other.open - caught.open, other.close - caught.open + 1]);
    const matches = [...block.matchAll(new RegExp(REPORTS_ERROR.source, 'g'))];
    const reports = matches.some((match) => isOutsideNestedRanges(match.index, nested));
    if (reports && (caught.binding === null || !bindingIsUsed(block, caught.binding))) {
      violations.push({
        line: lineOf(text, caught.index),
        message: 'catch reports a user-facing error while discarding the thrown error: name it and surface its message (PR #704)',
      });
    }
  }
  return violations;
}

export function isCheckedFile(path) {
  return path.startsWith(WEB_ROOT) && SOURCE_FILE.test(path) && !NOT_PRODUCTION.test(path);
}

export function findViolations(files) {
  const violations = [];
  for (const { path, text } of files) {
    if (!isCheckedFile(path)) continue;
    for (const violation of findDiscardedErrorViolations(text)) {
      violations.push({ file: path, line: violation.line, message: violation.message });
    }
  }
  return violations;
}

export function listTrackedFiles(root) {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
}

export async function run(root) {
  const files = listTrackedFiles(root)
    .filter(isCheckedFile)
    .map((path) => ({ path, text: readFileSync(join(root, path), 'utf8') }));
  return findViolations(files);
}

function escapeAnnotation(value) {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

async function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const violations = await run(root);
  for (const { file, line, message } of violations) {
    if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error file=${escapeAnnotation(file)},line=${line}::${escapeAnnotation(message)}`);
    else console.log(`${file}:${line} ${message}`);
  }
  if (violations.length > 0) {
    console.log(`error-surface: ${violations.length} violation(s).`);
    process.exitCode = 1;
  } else {
    console.log('error-surface: clean.');
  }
}

if (pathToFileURL(process.argv[1] ?? '').href === import.meta.url) {
  main().catch((error) => {
    console.error(`error-surface failed: ${error.message}`);
    process.exitCode = 1;
  });
}
