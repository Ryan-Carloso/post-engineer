#!/usr/bin/env node
//---------------
// detect.mjs — prints the PR's changed UI files (repo-relative,
// comma-separated; empty output when none).
//
// Usage: node detect.mjs --base origin/main --head <sha>
//---------------
import { changedUiFiles } from './changed.mjs';

function arg(name) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? null : process.argv[idx + 1];
}

const base = arg('--base');
const head = arg('--head');
if (!base || !head) {
  console.error('Usage: node detect.mjs --base <ref> --head <ref>');
  process.exit(2);
}

console.log(changedUiFiles(base, head).join(','));
