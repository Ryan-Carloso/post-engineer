#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const CODE_FILE = /\.(tsx?|jsx?|mjs|cjs)$/;

function defaultRunGit(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

async function defaultSameCode(baseText, headText, file) {
  const { sameCode } = await import('../comments/code-tokens.mjs');
  return sameCode(baseText, headText, file);
}

function readAt(runGit, ref, path) {
  try {
    return runGit(['show', `${ref}:${path}`]);
  } catch {
    return null;
  }
}

export async function filterCodeChanged(
  paths,
  baseRef,
  headRef,
  { runGit = defaultRunGit, sameCode = defaultSameCode } = {},
) {
  let mergeBase;
  try {
    mergeBase = runGit(['merge-base', baseRef, headRef]).trim();
  } catch {
    return [...paths];
  }
  const kept = [];
  for (const path of paths) {
    if (!CODE_FILE.test(path)) {
      kept.push(path);
      continue;
    }
    const before = readAt(runGit, mergeBase, path);
    const after = readAt(runGit, headRef, path);
    if (before === null || after === null) {
      kept.push(path);
      continue;
    }
    let unchanged = false;
    try {
      unchanged = await sameCode(before, after, path);
    } catch {
      unchanged = false;
    }
    if (!unchanged) kept.push(path);
  }
  return kept;
}

function arg(name) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? null : process.argv[idx + 1];
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = arg('--base');
  const head = arg('--head');
  if (!base || !head) {
    console.error('Usage: <paths on stdin> | node code-changed.mjs --base <ref> --head <ref>');
    process.exit(2);
  }
  const paths = (await readStdin())
    .split(/[\n,]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const kept = await filterCodeChanged(paths, base, head);
  process.stdout.write(kept.length > 0 ? `${kept.join('\n')}\n` : '');
}
