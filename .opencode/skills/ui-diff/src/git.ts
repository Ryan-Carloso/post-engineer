import { spawn } from 'node:child_process';
import { exec, type ExecOptions } from './exec.js';
import { UiDiffError } from './log.js';

export async function git(args: string[], opts: ExecOptions = {}): Promise<string> {
  const result = await exec('git', args, opts);
  return result.stdout.replace(/\n$/, '');
}

export async function gitOk(args: string[], opts: ExecOptions = {}): Promise<boolean> {
  const result = await exec('git', args, { ...opts, allowFailure: true });
  return result.code === 0;
}

export async function repoRoot(cwd: string): Promise<string> {
  try {
    return await git(['rev-parse', '--show-toplevel'], { cwd });
  } catch {
    throw new UiDiffError(`Not inside a git repository: ${cwd}`, { hint: 'Run ui-diff from the root of the app repository.' });
  }
}

export async function gitCommonDir(cwd: string): Promise<string> {
  return git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd });
}

export async function revParse(ref: string, cwd: string): Promise<string> {
  const result = await exec('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd, allowFailure: true });
  if (result.code !== 0 || !result.stdout.trim()) {
    throw new UiDiffError(`Unknown git ref: ${ref}`, {
      hint: `Fetch it first, e.g. \`git fetch origin ${ref.replace(/^origin\//, '')}\`.`,
    });
  }
  return result.stdout.trim();
}

export async function mergeBase(a: string, b: string, cwd: string): Promise<string> {
  const result = await exec('git', ['merge-base', a, b], { cwd, allowFailure: true });
  if (result.code !== 0 || !result.stdout.trim()) {
    throw new UiDiffError(`No merge base between ${a} and ${b}`, { hint: 'Fetch more history (e.g. `git fetch --unshallow`) or pass --base explicitly.' });
  }
  return result.stdout.trim();
}

/** Default branch as a remote-tracking ref, e.g. `origin/main`. */
export async function defaultBaseRef(cwd: string, remote = 'origin'): Promise<string | undefined> {
  const head = await exec('git', ['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`], { cwd, allowFailure: true });
  if (head.code === 0 && head.stdout.trim()) return head.stdout.trim().replace(/^refs\/remotes\//, '');
  for (const name of ['main', 'master', 'develop']) {
    if (await gitOk(['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${name}`], { cwd })) return `${remote}/${name}`;
  }
  for (const name of ['main', 'master']) {
    if (await gitOk(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], { cwd })) return name;
  }
  return undefined;
}

export interface ChangedFile {
  path: string;
  status: string;
  oldPath?: string;
}

export function parseNameStatus(output: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const status = parts[0].charAt(0);
    if ((status === 'R' || status === 'C') && parts.length >= 3) {
      files.push({ status, oldPath: parts[1], path: parts[2] });
    } else if (parts.length >= 2) {
      files.push({ status, path: parts[1] });
    }
  }
  return files;
}

/** Files changed between the merge base and `head` (a commit), or the working tree when `head` is undefined. */
export async function changedFiles(base: string, head: string | undefined, cwd: string): Promise<ChangedFile[]> {
  if (head) {
    return parseNameStatus(await git(['diff', '--name-status', '-M', '--no-color', `${base}...${head}`], { cwd }));
  }
  const tracked = parseNameStatus(await git(['diff', '--name-status', '-M', '--no-color', base], { cwd }));
  const untracked = (await untrackedFiles(cwd)).map((path) => ({ status: 'A', path }));
  const seen = new Set(tracked.map((f) => f.path));
  return [...tracked, ...untracked.filter((f) => !seen.has(f.path))];
}

export async function untrackedFiles(cwd: string): Promise<string[]> {
  const out = await git(['ls-files', '--others', '--exclude-standard', '-z'], { cwd });
  return out.split('\0').filter(Boolean);
}

export async function isDirty(cwd: string): Promise<boolean> {
  const out = await git(['status', '--porcelain', '--untracked-files=normal'], { cwd });
  return out.trim().length > 0;
}

/** Snapshot of tracked uncommitted changes as a dangling commit (does not touch the index or stash list). */
export async function snapshotWorkingTree(cwd: string): Promise<string> {
  const sha = (await git(['stash', 'create', 'ui-diff working tree snapshot'], { cwd })).trim();
  return sha || revParse('HEAD', cwd);
}

export async function addWorktree(repo: string, dir: string, sha: string): Promise<void> {
  await git(['worktree', 'add', '--detach', '--force', dir, sha], { cwd: repo });
}

export async function removeWorktree(repo: string, dir: string): Promise<void> {
  await exec('git', ['worktree', 'remove', '--force', dir], { cwd: repo, allowFailure: true });
  await exec('git', ['worktree', 'prune'], { cwd: repo, allowFailure: true });
}

export async function lsTree(ref: string, cwd: string): Promise<string[]> {
  const out = await git(['ls-tree', '-r', '--name-only', '-z', ref], { cwd });
  return out.split('\0').filter(Boolean);
}

/** Reads many blobs at `ref` through one `git cat-file --batch` process. Missing paths are skipped. */
export function readBlobs(ref: string, paths: string[], cwd: string, maxBytes = 512 * 1024): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    const result = new Map<string, string>();
    if (paths.length === 0) {
      resolve(result);
      return;
    }
    const child = spawn('git', ['cat-file', '--batch'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = Buffer.alloc(0);
    let index = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const newline = buffer.indexOf(0x0a);
        if (newline === -1) return;
        const header = buffer.subarray(0, newline).toString('utf8');
        if (header.endsWith(' missing')) {
          buffer = buffer.subarray(newline + 1);
          index++;
          continue;
        }
        const size = Number(header.split(' ')[2]);
        if (buffer.length < newline + 1 + size + 1) return;
        const body = buffer.subarray(newline + 1, newline + 1 + size);
        if (size <= maxBytes) result.set(paths[index], body.toString('utf8'));
        buffer = buffer.subarray(newline + 1 + size + 1);
        index++;
      }
    });
    child.on('error', reject);
    child.on('close', () => resolve(result));
    child.stdin.end(paths.map((p) => `${ref}:${p}`).join('\n') + '\n');
  });
}

export interface RemoteInfo {
  host: string;
  owner: string;
  repo: string;
}

export function parseRemoteUrl(url: string): RemoteInfo | undefined {
  const trimmed = url.trim().replace(/\.git$/, '').replace(/\/$/, '');
  const ssh = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)\/([^/]+)$/.exec(trimmed);
  if (ssh) return { host: ssh[1], owner: ssh[2], repo: ssh[3] };
  const https = /^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+)\/([^/]+)$/.exec(trimmed);
  if (https) return { host: https[1], owner: https[2], repo: https[3] };
  return undefined;
}

export async function remoteUrl(remote: string, cwd: string): Promise<string | undefined> {
  if (/^[a-z]+:\/\/|^\/|^git@|^\.\.?\//.test(remote)) return remote;
  const result = await exec('git', ['remote', 'get-url', remote], { cwd, allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : undefined;
}

export async function shortSha(sha: string, cwd: string): Promise<string> {
  const result = await exec('git', ['rev-parse', '--short=7', sha], { cwd, allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : sha.slice(0, 7);
}
