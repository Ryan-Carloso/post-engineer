import { describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Transport scope (Phase 6, P6-1): stdio is the default and never opens a
// network port — not with no flags, and not with the legacy --http flag,
// which is ignored. The ONLY port-opening path is the explicit
// --http-transport opt-in, which binds loopback unless --allow-remote
// is passed. The HTTP skeleton has no authentication yet (P6-2 adds it).

async function reserveEphemeralPort(): Promise<number> {
  // Bind port 0 and read back the assigned port instead of hard-coding one:
  // a fixed port can be occupied by an unrelated process on the runner.
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function isHttpListening(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    await res.arrayBuffer().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

// Spawn the built server, wait for it to bind (if it were going to), and
// assert it is actually running — otherwise a "no port bound" result
// would pass vacuously on a startup crash. The caller then probes the
// port and asserts listening (HTTP mode) or not (stdio modes).
async function spawnServer(args: string[], extraEnv: NodeJS.ProcessEnv): Promise<ChildProcess> {
  const entry = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'dist',
    'index.js',
  );
  if (!existsSync(entry)) {
    throw new Error(`dist/index.js not found — run 'pnpm build' before 'pnpm test' (got ${entry})`);
  }
  // Launch through a symlink, like the published npx .bin entry, to prove
  // isMainModule() resolves the real path instead of comparing raw strings.
  // mkdtempSync keeps parallel workers from racing on a fixed path.
  // Windows needs elevated privileges for symlinks: spawn the entry directly
  // there (the port assertions still hold; only the symlink path is skipped).
  const linkDir = mkdtempSync(path.join(tmpdir(), 'pe-mcp-local-only-'));
  const linkEntry = path.join(linkDir, 'mcp-link.mjs');
  const spawnEntry = process.platform === 'win32' ? entry : linkEntry;
  if (process.platform !== 'win32') {
    symlinkSync(entry, linkEntry);
  }
  let spawnError: unknown;
  const child = spawn(process.execPath, [spawnEntry, ...args], {
    env: {
      ...process.env,
      POST_ENGINEER_API_KEY: 'test-local-only-key',
      ...extraEnv,
    },
    // stdin must be an open pipe (not 'ignore'): the stdio server sits on
    // stdin, and with /dev/null the event loop would empty and the process
    // would exit 0 even though it started fine.
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  child.on('error', (err) => {
    spawnError = err;
  });
  // Give the process time to bind the port, if it were going to.
  await delay(2000);
  expect(spawnError).toBeUndefined();
  expect(child.exitCode).toBeNull();
  // The temp symlink dir is only needed until spawn; the child already
  // resolved the entry, so it can go now. The caller kills the child.
  rmSync(linkDir, { recursive: true, force: true });
  return child;
}

describe('local-only transport', () => {
  it('does not start an HTTP server by default (stdio, no flags)', async () => {
    const testPort = await reserveEphemeralPort();
    const child = await spawnServer([], { MCP_PORT: String(testPort) });
    try {
      expect(await isHttpListening(testPort)).toBe(false);
    } finally {
      child.kill('SIGKILL');
    }
  }, 15000);

  it('does not start an HTTP server when the legacy --http flag is passed', async () => {
    const testPort = await reserveEphemeralPort();
    const child = await spawnServer(['--http'], { MCP_PORT: String(testPort) });
    try {
      expect(await isHttpListening(testPort)).toBe(false);
    } finally {
      child.kill('SIGKILL');
    }
  }, 15000);

  it('starts a loopback HTTP server only with the explicit --http-transport flag', async () => {
    const testPort = await reserveEphemeralPort();
    const child = await spawnServer(['--http-transport', '--http-port', String(testPort)], {});
    try {
      expect(await isHttpListening(testPort)).toBe(true);
    } finally {
      child.kill('SIGKILL');
    }
  }, 15000);
});
