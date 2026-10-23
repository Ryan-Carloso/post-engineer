#!/usr/bin/env node
//---------------
// Detect whether a PR adds or changes an MCP parity exclusion.
//
// Usage:
//   node check.mjs --base <sha> --head <sha>
//
// Reads apps/mcp/src/__tests__/parity-exclusions.json at both refs and
// prints the added/changed endpoint keys. Writes `changed=true|false` (and
// the key lists) to $GITHUB_OUTPUT when set, so the workflow can decide
// whether the code-owner approval label is required.
//
// Exit codes: 0 = detection completed (even when exclusions changed),
// 2 = the refs or files could not be read/parsed.
//---------------

import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { changedExclusions } from './diff.mjs';

const EXCLUSIONS_PATH = 'apps/mcp/src/__tests__/parity-exclusions.json';

/** @param {string} name */
function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined) throw new Error(`missing value for ${name}`);
  return value;
}

/**
 * @param {string} ref
 * @returns {unknown}
 */
function readAtRef(ref) {
  const result = spawnSync('git', ['show', `${ref}:${EXCLUSIONS_PATH}`], {
    encoding: 'utf8',
  });
  if (result.status === 0) return JSON.parse(result.stdout);
  // The file did not exist at the base ref (first PR that introduces it) or
  // the ref is shallow. Treat a missing file as an empty set; any other git
  // failure is a configuration error, not a silent pass.
  const stderr = result.stderr ?? '';
  if (/does not exist|exists on disk, but not in|Path .* does not exist/.test(stderr)) {
    return {};
  }
  throw new Error(`git show ${ref}:${EXCLUSIONS_PATH} failed: ${stderr.trim()}`);
}

function main() {
  const base = argValue('--base') ?? 'origin/main';
  const head = argValue('--head') ?? 'HEAD';
  const { added, modified } = changedExclusions(readAtRef(base), readAtRef(head));
  const changed = added.length > 0 || modified.length > 0;

  for (const key of added) console.log(`added exclusion: ${key}`);
  for (const key of modified) console.log(`changed exclusion: ${key}`);
  if (!changed) console.log('no parity exclusion added or changed');

  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    appendFileSync(
      output,
      `changed=${changed}\nadded=${added.join(',')}\nmodified=${modified.join(',')}\n`,
    );
  }
}

try {
  main();
} catch (error) {
  console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
