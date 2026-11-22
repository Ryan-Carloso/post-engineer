import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertSafePreviewUrl, sanitizeUrl } from './auth.js';
import type { ResolvedConfig } from './config.js';
import { addWorktree, removeWorktree, revParse, shortSha, snapshotWorkingTree, untrackedFiles } from './git.js';
import { log, UiDiffError } from './log.js';
import { fillPort, getFreePort, runLogged, ServerStartError, startServer, type RunningServer } from './server.js';

export type SideName = 'base' | 'head';

export interface Side {
  name: SideName;
  /** Human label, e.g. "main @ 1a2b3c4" or a sanitized preview URL. */
  label: string;
  mode: 'worktree' | 'url';
  sha?: string;
  shortSha?: string;
  ref?: string;
  /** Root URL to which route paths are appended (no trailing slash). */
  url: string;
  dir?: string;
  includesUncommitted?: boolean;
  server?: RunningServer;
}

export interface SideRequest {
  name: SideName;
  ref?: string;
  /** Ref name shown to reviewers (e.g. "origin/main" while `ref` is its merge-base sha). */
  displayRef?: string;
  url?: string;
  workingTree?: boolean;
}

const LOCKFILES: Array<{ file: string; command: string }> = [
  { file: 'pnpm-lock.yaml', command: 'pnpm install --frozen-lockfile --prefer-offline' },
  { file: 'yarn.lock', command: 'yarn install --frozen-lockfile' },
  { file: 'bun.lock', command: 'bun install --frozen-lockfile' },
  { file: 'bun.lockb', command: 'bun install --frozen-lockfile' },
  { file: 'package-lock.json', command: 'npm ci --prefer-offline --no-audit --no-fund' },
  { file: 'npm-shrinkwrap.json', command: 'npm ci --prefer-offline --no-audit --no-fund' },
];

/** Cache directories that must not be shared between base and head checkouts. */
const UNSHARED_ENTRIES = new Set(['.cache', '.vite', '.vite-temp', '.turbo', '.next', '.parcel-cache', '.astro']);

function findUp(start: string, stop: string, predicate: (dir: string) => boolean): string | undefined {
  let dir = start;
  for (;;) {
    if (predicate(dir)) return dir;
    if (dir === stop || dir === path.dirname(dir)) return undefined;
    dir = path.dirname(dir);
  }
}

/**
 * Content hash of a lockfile that ignores line endings and trailing whitespace, so a checkout
 * with CRLF endings (or an editor's trailing newline) still counts as the same dependency set.
 */
export function lockfileHash(file: string): string | undefined {
  let data: Buffer;
  try {
    data = readFileSync(file);
  } catch {
    return undefined;
  }
  const hash = createHash('sha256');
  if (file.endsWith('.lockb')) hash.update(data);
  else hash.update(data.toString('utf8').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, ''));
  return hash.digest('hex');
}

/**
 * Gives a worktree access to the main checkout's installed packages without sharing caches:
 * node_modules becomes a real directory whose entries are symlinks.
 */
export function linkNodeModules(fromDir: string, toDir: string): boolean {
  const source = path.join(fromDir, 'node_modules');
  const target = path.join(toDir, 'node_modules');
  if (!existsSync(source) || existsSync(target)) return false;
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source)) {
    if (UNSHARED_ENTRIES.has(entry)) continue;
    symlinkSync(path.join(source, entry), path.join(target, entry));
  }
  return true;
}

export interface InstallPlan {
  kind: 'none' | 'link' | 'command';
  command?: string;
  dir?: string;
  reason: string;
  /** Lockfile identity (path + content hash): sides with the same key can share one install. */
  lockKey?: string;
}

export function planInstall(cfg: ResolvedConfig, worktreeRoot: string): InstallPlan {
  const appDir = path.join(worktreeRoot, cfg.dirRel, cfg.cwd);
  if (cfg.install === false) return { kind: 'none', reason: 'install disabled' };
  if (typeof cfg.install === 'string' && cfg.install !== 'auto') return { kind: 'command', command: cfg.install, dir: appDir, reason: 'install command from config' };
  const pkgDir = findUp(appDir, worktreeRoot, (d) => existsSync(path.join(d, 'package.json')));
  if (!pkgDir) return { kind: 'none', reason: 'no package.json' };
  const lockDir = findUp(pkgDir, worktreeRoot, (d) => LOCKFILES.some((l) => existsSync(path.join(d, l.file))));
  if (!lockDir) return { kind: 'command', command: 'npm install --no-audit --no-fund', dir: pkgDir, reason: 'no lockfile' };
  const lock = LOCKFILES.find((l) => existsSync(path.join(lockDir, l.file)))!;
  const rel = path.relative(worktreeRoot, lockDir);
  const mainLockDir = path.join(cfg.repoRoot, rel);
  if (usesNext(pkgDir)) {
    return { kind: 'command', command: lock.command, dir: lockDir, reason: 'Next.js (Turbopack) does not follow node_modules symlinks that point outside the project' };
  }
  const hash = lockfileHash(path.join(lockDir, lock.file));
  if (hash && hash === lockfileHash(path.join(mainLockDir, lock.file)) && existsSync(path.join(mainLockDir, 'node_modules'))) {
    return { kind: 'link', dir: lockDir, reason: `${lock.file} matches your checkout` };
  }
  return { kind: 'command', command: lock.command, dir: lockDir, reason: `${lock.file} differs from your checkout`, lockKey: hash ? `${rel}|${lock.file}|${hash}` : undefined };
}

/**
 * Base and head often share a lockfile that differs from your checkout: the first side installs,
 * the other links to its node_modules instead of installing the same dependencies again.
 */
export class SharedInstalls {
  private readonly installs = new Map<string, Promise<string>>();

  /** Runs `install` once per key. Returns the worktree root to link from when another side already installed. */
  async run(key: string, root: string, install: () => Promise<void>): Promise<string | undefined> {
    const first = this.installs.get(key);
    if (first) {
      const from = await first.catch(() => undefined);
      if (from) return from;
      await install();
      return undefined;
    }
    const pending = install().then(() => root);
    this.installs.set(key, pending);
    await pending;
    return undefined;
  }
}

function usesNext(pkgDir: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return Boolean(pkg.dependencies?.next ?? pkg.devDependencies?.next);
  } catch {
    return false;
  }
}

/** How long a server started with linked dependencies may answer only 5xx before ui-diff retries with a clean install. */
const LINKED_5XX_GRACE_MS = 30000;

function linkAll(cfg: ResolvedConfig, worktreeRoot: string, lockDir: string, fromRoot = cfg.repoRoot): void {
  const rel = path.relative(worktreeRoot, lockDir);
  linkNodeModules(path.join(fromRoot, rel), lockDir);
  const appDir = path.join(worktreeRoot, cfg.dirRel, cfg.cwd);
  if (appDir !== lockDir) linkNodeModules(path.join(fromRoot, cfg.dirRel, cfg.cwd), appDir);
}

function unlinkAll(worktreeRoot: string, cfg: ResolvedConfig, lockDir: string): void {
  for (const dir of new Set([lockDir, path.join(worktreeRoot, cfg.dirRel, cfg.cwd)])) {
    const nm = path.join(dir, 'node_modules');
    if (existsSync(nm) && lstatSync(nm).isDirectory()) rmSync(nm, { recursive: true, force: true });
  }
}

export class SideManager {
  private tmpRoot?: string;
  private readonly worktrees: string[] = [];
  private readonly installs = new SharedInstalls();
  readonly sides: Side[] = [];

  constructor(
    private readonly cfg: ResolvedConfig,
    private readonly opts: { outDir: string; keepWorktrees?: boolean },
  ) {}

  private tmp(): string {
    if (!this.tmpRoot) this.tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'ui-diff-'));
    return this.tmpRoot;
  }

  async prepare(request: SideRequest): Promise<Side> {
    const side = request.url ? this.fromUrl(request) : await this.fromWorktree(request);
    this.sides.push(side);
    return side;
  }

  private fromUrl(request: SideRequest): Side {
    const url = assertSafePreviewUrl(request.url!, `${request.name} URL`);
    if (url.search || url.hash) log.warn(`${request.name} URL: query and hash are ignored; use routes or themes[].query for parameters`);
    url.search = '';
    url.hash = '';
    const root = url.toString().replace(/\/$/, '');
    return { name: request.name, label: sanitizeUrl(root), mode: 'url', url: root };
  }

  private async fromWorktree(request: SideRequest): Promise<Side> {
    const { cfg } = this;
    if (!cfg.startCommand) {
      throw new UiDiffError('No startCommand configured, so ui-diff cannot run the app locally', {
        hint: 'Add "startCommand" (with {port}) to ui-diff.config.json, or pass --base-url/--head-url for deployed previews. `ui-diff init` can suggest one.',
      });
    }
    let sha: string;
    let includesUncommitted = false;
    if (request.workingTree) {
      sha = await snapshotWorkingTree(cfg.repoRoot);
      includesUncommitted = sha !== (await revParse('HEAD', cfg.repoRoot));
    } else {
      sha = await revParse(request.ref ?? 'HEAD', cfg.repoRoot);
    }
    const dir = path.join(this.tmp(), request.name);
    log.step(`${request.name}: checking out ${sha.slice(0, 7)} into a temporary worktree`);
    await addWorktree(cfg.repoRoot, dir, sha);
    this.worktrees.push(dir);

    if (request.workingTree) {
      for (const file of await untrackedFiles(cfg.repoRoot)) {
        const from = path.join(cfg.repoRoot, file);
        const to = path.join(dir, file);
        mkdirSync(path.dirname(to), { recursive: true });
        try {
          copyFileSync(from, to);
        } catch {
          // unreadable or vanished
        }
      }
    }
    for (const rel of cfg.copyFiles) {
      const from = path.join(cfg.dir, rel);
      const to = path.join(dir, cfg.dirRel, rel);
      if (existsSync(from) && !existsSync(to)) {
        mkdirSync(path.dirname(to), { recursive: true });
        copyFileSync(from, to);
        log.debug(`${request.name}: copied ${rel}`);
      }
    }

    const logDir = path.join(this.opts.outDir, 'logs');
    const env = { ...process.env, ...cfg.env };
    const appDir = path.join(dir, cfg.dirRel, cfg.cwd);
    if (!existsSync(appDir)) {
      throw new UiDiffError(`${request.name}: the app directory "${path.posix.join(cfg.dirRel, cfg.cwd)}" does not exist at ${sha.slice(0, 7)}`, {
        hint: '"cwd" in ui-diff.config.json is relative to the config file and uses forward slashes.',
      });
    }
    const plan = planInstall(cfg, dir);
    let linked = plan.kind === 'link';
    if (plan.kind === 'link') {
      log.step(`${request.name}: reusing installed dependencies (${plan.reason})`);
      linkAll(cfg, dir, plan.dir!);
    } else if (plan.kind === 'command') {
      const install = async () => {
        log.step(`${request.name}: installing dependencies (${plan.reason}): ${plan.command}`);
        await runLogged(plan.command!, { cwd: plan.dir!, env, logFile: path.join(logDir, `install-${request.name}.log`), label: `${request.name} install` });
      };
      const from = plan.lockKey ? await this.installs.run(plan.lockKey, dir, install) : (await install(), undefined);
      if (from) {
        log.step(`${request.name}: reusing dependencies installed for the other side (same lockfile)`);
        linkAll(cfg, dir, plan.dir!, from);
        linked = true;
      }
    }
    if (cfg.buildCommand) {
      log.step(`${request.name}: building`);
      await runLogged(cfg.buildCommand, { cwd: appDir, env, logFile: path.join(logDir, `build-${request.name}.log`), label: `${request.name} build` });
    }

    const start = async (linkedDeps: boolean): Promise<RunningServer> => {
      const port = await getFreePort();
      const url = fillPort(cfg.baseUrl, port).replace(/\/$/, '');
      return startServer({
        label: request.name,
        command: cfg.startCommand!,
        cwd: appDir,
        port,
        url,
        readyUrl: url + (cfg.readyPath.startsWith('/') ? cfg.readyPath : `/${cfg.readyPath}`),
        env,
        logFile: path.join(logDir, `server-${request.name}.log`),
        timeoutMs: cfg.startTimeoutMs,
        failOn5xxAfterMs: linkedDeps ? LINKED_5XX_GRACE_MS : undefined,
      });
    };
    log.step(`${request.name}: starting server`);
    let server: RunningServer;
    try {
      server = await start(linked);
    } catch (error) {
      if (!linked || (error instanceof ServerStartError && error.reason === 'unreachable')) throw error;
      log.warn(`${request.name}: server failed with linked dependencies, retrying with a clean install`);
      unlinkAll(dir, cfg, plan.dir!);
      const fallback = planInstall({ ...cfg, install: 'auto' }, dir);
      const lock = LOCKFILES.find((l) => existsSync(path.join(plan.dir!, l.file)));
      await runLogged(lock?.command ?? fallback.command ?? 'npm install', {
        cwd: plan.dir!,
        env,
        logFile: path.join(logDir, `install-${request.name}.log`),
        label: `${request.name} install`,
      });
      server = await start(false);
    }
    const short = await shortSha(sha, cfg.repoRoot);
    const display = request.workingTree ? 'working tree' : (request.displayRef ?? request.ref);
    const plain = !display || display === sha || display === short || /^[0-9a-f]{7,40}$/i.test(display);
    return {
      name: request.name,
      label: plain ? short : `${display.replace(/^origin\//, '')} @ ${short}`,
      mode: 'worktree',
      sha,
      shortSha: short,
      ref: request.ref,
      url: server.url,
      dir,
      includesUncommitted,
      server,
    };
  }

  /** Best-effort synchronous cleanup for signal handlers, where async work may not finish. */
  cleanupSync(): void {
    if (this.opts.keepWorktrees) return;
    for (const dir of this.worktrees) {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: this.cfg.repoRoot, stdio: 'ignore' });
      } catch {
        // already gone
      }
    }
    if (this.tmpRoot) rmSync(this.tmpRoot, { recursive: true, force: true });
  }

  async cleanup(): Promise<void> {
    await Promise.all(this.sides.map((s) => s.server?.stop()));
    if (this.opts.keepWorktrees) {
      if (this.worktrees.length) log.info(`kept worktrees: ${this.worktrees.join(', ')}`);
      return;
    }
    for (const dir of this.worktrees) await removeWorktree(this.cfg.repoRoot, dir);
    if (this.tmpRoot) rmSync(this.tmpRoot, { recursive: true, force: true });
  }
}
