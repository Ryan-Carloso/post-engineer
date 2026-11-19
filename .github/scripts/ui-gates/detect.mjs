#!/usr/bin/env node
import { changedUiFiles } from './changed.mjs';
import { filterCodeChanged } from './code-changed.mjs';

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

console.log((await filterCodeChanged(changedUiFiles(base, head), base, head)).join(','));
