#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WEB_ROOT = 'apps/web/';
const SOURCE_FILE = /\.(ts|tsx)$/;
const NOT_PRODUCTION = /(^|\/)(__tests__|test|tests|cypress|node_modules)\/|\.(test|spec|cy)\.[a-z]+$|\.gen\.[a-z]+$/;
const LOADED_TRUE = /set[A-Za-z0-9_$]*Loaded\s*\(\s*true\s*\)/;
const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;

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

function isOutsideNestedRanges(index, ranges) {
  return !ranges.some(([start, end]) => index >= start && index < end);
}

function collectFinallyBlocks(text) {
  const blocks = [];
  let i = 0;
  while (i < text.length) {
    const next = skipNonCode(text, i);
    if (next !== i) {
      i = next;
      continue;
    }
    if (startsWord(text, i, 'finally')) {
      let j = i + 'finally'.length;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      if (text[j] === '{') {
        const close = matchClosingBrace(text, j);
        blocks.push({ index: i, open: j, close });
        i = j + 1;
        continue;
      }
    }
    i += 1;
  }
  return blocks;
}

export function findLoadedFlagViolations(text) {
  const violations = [];
  const blocks = collectFinallyBlocks(text);
  for (const block of blocks) {
    const body = text.slice(block.open, block.close + 1);
    const nested = blocks
      .filter((other) => other.open > block.open && other.close < block.close)
      .map((other) => [other.open - block.open, other.close - block.open + 1]);
    const matches = [...body.matchAll(new RegExp(LOADED_TRUE.source, 'g'))];
    const found = matches.find((match) => isOutsideNestedRanges(match.index, nested));
    if (found) {
      violations.push({
        line: lineOf(text, block.open + found.index),
        message: 'loaded flag set to true in a finally block: a failed load must leave it false, or the save runs on a stale selection (PR #704)',
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
    for (const violation of findLoadedFlagViolations(text)) {
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
    console.log(`loaded-flag: ${violations.length} violation(s).`);
    process.exitCode = 1;
  } else {
    console.log('loaded-flag: clean.');
  }
}

if (pathToFileURL(process.argv[1] ?? '').href === import.meta.url) {
  main().catch((error) => {
    console.error(`loaded-flag failed: ${error.message}`);
    process.exitCode = 1;
  });
}
