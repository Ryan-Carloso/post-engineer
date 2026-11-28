#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { EXCLUSIONS_PATH, evaluateChanges } from './diff.mjs';
import { evaluateApproval } from './approval.mjs';

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || process.argv[index + 1] === undefined) {
    throw new Error(`missing ${name}`);
  }
  return process.argv[index + 1];
}

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function readJsonAt(ref) {
  const exists = git(['cat-file', '-e', `${ref}:${EXCLUSIONS_PATH}`]);
  if (!exists.ok) return undefined;
  const shown = git(['show', `${ref}:${EXCLUSIONS_PATH}`]);
  if (!shown.ok) throw new Error(`git show ${ref}:${EXCLUSIONS_PATH} failed: ${shown.stderr.trim()}`);
  try {
    return JSON.parse(shown.stdout);
  } catch {
    return { unparseable: true };
  }
}

function detect() {
  const base = argValue('--base');
  const head = argValue('--head');
  const mergeBase = git(['merge-base', base, head]);
  if (!mergeBase.ok) throw new Error(`git merge-base ${base} ${head} failed: ${mergeBase.stderr.trim()}`);
  const baseSha = mergeBase.stdout.trim();
  const diff = git(['diff', '--name-only', '--no-renames', '-z', baseSha, head]);
  if (!diff.ok) throw new Error(`git diff failed: ${diff.stderr.trim()}`);
  const files = diff.stdout.split('\0').filter((f) => f.length > 0);

  const { needsApproval, reasons } = evaluateChanges(files, {
    base: readJsonAt(baseSha),
    head: readJsonAt(head),
  });
  for (const reason of reasons) console.log(reason);
  if (!needsApproval) console.log('no guarded parity change');

  const output = process.env.GITHUB_OUTPUT;
  if (output) appendFileSync(output, `needs_approval=${needsApproval}\n`);
}

function readJson(flag) {
  return JSON.parse(readFileSync(argValue(flag), 'utf8'));
}

function approve() {
  const labels = readJson('--labels');
  const timeline = readJson('--timeline');
  const reviews = readJson('--reviews');
  if (!Array.isArray(labels) || !Array.isArray(timeline) || !Array.isArray(reviews)) {
    throw new Error('labels, timeline and reviews must be JSON arrays');
  }
  const { approved, reasons } = evaluateApproval({
    labels: labels.map((l) => (typeof l === 'string' ? l : String(l?.name))),
    timeline,
    reviews,
    headSha: argValue('--head'),
  });
  if (approved) {
    console.log('Approved by a code owner on the current head.');
    return;
  }
  for (const reason of reasons) console.log(`::error::${reason}`);
  console.log(
    '::error::This PR changes the MCP parity gate. The fix for a parity failure is an MCP tool, not an exclusion. A code owner must review and approve the current head, then apply the parity-exclusion-approved label.',
  );
  process.exit(1);
}

try {
  const mode = process.argv[2];
  if (mode === 'detect') detect();
  else if (mode === 'approve') approve();
  else throw new Error(`unknown mode ${mode ?? '(none)'}; use detect or approve`);
} catch (error) {
  console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
