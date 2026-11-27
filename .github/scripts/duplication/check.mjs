#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VENDORED_CALENDARCN_FILES } from '../file-size/vendored-calendarcn.mjs';
import { VENDORED_UIDIFF_FILES } from '../file-size/vendored-uidiff.mjs';

export const CONFIG_PATH = '.jscpd.json';
export const VENDORED_FILES = [...VENDORED_CALENDARCN_FILES, ...VENDORED_UIDIFF_FILES];

export function buildConfig(root, base, outputDir) {
  return {
    ...base,
    path: base.path.map((dir) => path.join(root, dir)),
    ignore: [...base.ignore, ...VENDORED_FILES.map((file) => path.join(root, file))],
    reporters: ['json'],
    output: outputDir,
    silent: true,
  };
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

export function clonesFromReport(root, report) {
  const vendored = new Set(VENDORED_FILES);
  return report.duplicates
    .map((clone) => ({
      tokens: clone.tokens,
      lines: clone.lines,
      first: { file: relative(root, clone.firstFile.name), start: clone.firstFile.start, end: clone.firstFile.end },
      second: { file: relative(root, clone.secondFile.name), start: clone.secondFile.start, end: clone.secondFile.end },
    }))
    .filter((clone) => !vendored.has(clone.first.file) && !vendored.has(clone.second.file))
    .sort((a, b) => b.tokens - a.tokens);
}

export function describeClone(clone) {
  return `${clone.first.file}:${clone.first.start}-${clone.first.end} == ${clone.second.file}:${clone.second.start}-${clone.second.end} (${clone.lines} lines, ${clone.tokens} tokens)`;
}

export function run(root) {
  const base = JSON.parse(readFileSync(path.join(root, CONFIG_PATH), 'utf8'));
  const outputDir = mkdtempSync(path.join(tmpdir(), 'jscpd-'));
  try {
    const configFile = path.join(outputDir, 'jscpd.json');
    writeFileSync(configFile, JSON.stringify(buildConfig(root, base, outputDir)));
    try {
      execFileSync('pnpm', ['exec', 'jscpd', '--config', configFile], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
    } catch (error) {
      if (error.status !== 1) throw error;
    }
    const report = JSON.parse(readFileSync(path.join(outputDir, 'jscpd-report.json'), 'utf8'));
    return clonesFromReport(root, report);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const clones = run(root);
  for (const clone of clones) console.error(describeClone(clone));
  if (clones.length > 0) {
    console.error(`\n${clones.length} duplicated block(s). Extract the shared code into one function or module (limits in ${CONFIG_PATH}).`);
    process.exit(1);
  }
  console.log('duplication: no copy-pasted block.');
}
