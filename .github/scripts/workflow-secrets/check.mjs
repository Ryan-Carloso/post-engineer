import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { staleEntries, violationsOf } from './parse.mjs';

export const ALLOWLIST = '.github/scripts/workflow-secrets/allowlist.json';
const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/;

export function checkFiles(files, allowlist) {
  const violations = [];
  for (const entry of allowlist) {
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      violations.push({ file: ALLOWLIST, line: 1, message: `allowlist entry ${entry.workflow}#${entry.job} has no reason` });
    }
  }
  for (const [file, text] of files) violations.push(...violationsOf(file, text, allowlist));
  for (const entry of staleEntries(files, allowlist)) {
    violations.push({ file: ALLOWLIST, line: 1, message: `allowlist entry ${entry.workflow}#${entry.job} no longer matches a job that reads secrets without an environment; delete it` });
  }
  return violations;
}

export function run(root) {
  const allowlist = JSON.parse(readFileSync(join(root, ALLOWLIST), 'utf8'));
  const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n').filter((file) => WORKFLOW_FILE.test(file));
  const files = new Map(tracked.map((file) => [file, readFileSync(join(root, file), 'utf8')]));
  return checkFiles(files, allowlist);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const violations = run(root);
  for (const { file, line, message } of violations) {
    if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error file=${file},line=${line}::${message}`);
    else console.log(`${file}:${line} ${message}`);
  }
  if (violations.length > 0) {
    console.log(`\nworkflow-secrets: ${violations.length} violation(s).`);
    process.exit(1);
  }
  console.log('workflow-secrets: clean.');
}
