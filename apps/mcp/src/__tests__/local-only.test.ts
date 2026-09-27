import { describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The MCP server is local-only: it speaks stdio and must never open a
// network port, even if someone passes the legacy --http flag.

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

describe('local-only transport', () => {
  it('does not start an HTTP server when --http is passed', async () => {
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
    // there (the no-port-bind assertion still holds; only the symlink path is skipped).
    const linkDir = mkdtempSync(path.join(tmpdir(), 'pe-mcp-local-only-'));
    const linkEntry = path.join(linkDir, 'mcp-link.mjs');
    const spawnEntry = process.platform === 'win32' ? entry : linkEntry;
    if (process.platform !== 'win32') {
      symlinkSync(entry, linkEntry);
    }
    const testPort = await reserveEphemeralPort();
    let child: ChildProcess | undefined;
    let spawnError: unknown;
    try {
      child = spawn(process.execPath, [spawnEntry, '--http'], {
        env: {
          ...process.env,
          MCP_PORT: String(testPort),
          POST_ENGINEER_API_KEY: 'test-local-only-key',
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
      // The server must actually be running: otherwise "no port bound" would
      // pass vacuously on a startup crash.
      expect(child.exitCode).toBeNull();
      expect(await isHttpListening(testPort)).toBe(false);
    } finally {
      child?.kill('SIGKILL');
      rmSync(linkDir, { recursive: true, force: true });
    }
  }, 15000);
});
