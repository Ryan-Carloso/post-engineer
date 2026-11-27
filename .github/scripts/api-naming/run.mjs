#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { extractFromDiff } from './extract.mjs';
import { checkDenylist } from './denylist.mjs';
import { reviewNames } from './llm.mjs';
import { formatAnnotations } from './report.mjs';
import { parseArgs } from '../cli/args.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

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

  const denyFindings = checkDenylist(candidates, config);
  const denied = new Set(denyFindings.map((f) => `${f.file}:${f.line}:${f.name}`));
  const llmCandidates = candidates.filter((c) => !denied.has(`${c.file}:${c.line}:${c.name}`));

  const { findings: llmFindings, warnings } = await reviewNames(llmCandidates, config);

  const findings = [...denyFindings, ...llmFindings].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name),
  );

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
