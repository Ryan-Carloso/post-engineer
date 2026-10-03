#!/usr/bin/env node
/**
 * API naming lint — CI entry point.
 *
 * Diff-based: only names ADDED in the PR diff under the configured
 * contract surface (api_paths) are linted. Existing names are grandfathered.
 *
 * Pipeline: extract candidates -> deterministic denylist -> LLM review
 * (skipped gracefully without API_NAMING_LLM_API_KEY) -> GitHub annotations
 * + findings JSON for the PR-comment step.
 *
 * Usage:
 *   node run.mjs --base <sha> --head <sha> [--repo-root <path>]
 *                [--config <path>] [--diff-file <path>] [--findings-out <path>]
 *
 * --diff-file reads a unified diff from disk instead of git (test hook).
 * Exit code: 1 when any error-severity finding exists, else 0.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { extractFromDiff } from './extract.mjs';
import { checkDenylist } from './denylist.mjs';
import { reviewNames } from './llm.mjs';
import { formatAnnotations } from './report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    }
  }
  return args;
}

function getDiff(args, repoRoot) {
  if (args.diffFile) return fs.readFileSync(args.diffFile, 'utf8');
  if (!args.base || !args.head) {
    throw new Error('Need --base <sha> and --head <sha> (or --diff-file for local testing).');
  }
  return execFileSync(
    'git',
    ['diff', '--no-color', '--no-ext-diff', '-U3', `${args.base}...${args.head}`, '--', '.'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(args.repoRoot ?? path.join(HERE, '..', '..', '..'));
  const configPath = args.config ?? path.join(repoRoot, '.github', 'api-naming.yml');
  const config = loadConfig(configPath);

  const diff = getDiff(args, repoRoot);
  const { candidates, newEndpoints } = extractFromDiff(diff, config);

  // Deterministic layer first; denylisted names skip the LLM (already failed).
  const denyFindings = checkDenylist(candidates, config);
  const denied = new Set(denyFindings.map((f) => `${f.file}:${f.line}:${f.name}`));
  const llmCandidates = candidates.filter((c) => !denied.has(`${c.file}:${c.line}:${c.name}`));

  const { findings: llmFindings, warnings } = await reviewNames(llmCandidates, config);

  const findings = [...denyFindings, ...llmFindings].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name),
  );

  // Annotations go to stdout (GitHub scans the whole log for :: commands).
  const annotations = formatAnnotations(findings, warnings);
  if (annotations) console.log(annotations);
  for (const ep of newEndpoints) {
    console.log(`::notice file=${ep.file}::New API surface added in this PR: ${ep.file}`);
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warns = findings.filter((f) => f.severity === 'warn').length;
  console.error(
    `API naming lint: ${candidates.length} new name(s) in contract surface, ` +
      `${errors} error(s), ${warns} warning(s), ${newEndpoints.length} new endpoint file(s).`,
  );
  if (warnings.length > 0) {
    for (const w of warnings) console.error(`warning: ${w}`);
  }

  if (args.findingsOut) {
    fs.writeFileSync(
      args.findingsOut,
      JSON.stringify(
        {
          findings,
          warnings,
          newEndpoints,
          candidateCount: candidates.length,
          headSha: args.head ?? 'local',
        },
        null,
        2,
      ),
    );
  }

  process.exitCode = errors > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(`::error::API naming lint crashed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
