import { execFileSync } from 'node:child_process';
import { isUiFile } from './ui-files.mjs';

export function changedUiFiles(baseRef, headRef, runGit = defaultRunGit) {
  const output = runGit(['diff', '--name-only', '--diff-filter=ACMR', `${baseRef}...${headRef}`]);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter(isUiFile);
}

function defaultRunGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}
