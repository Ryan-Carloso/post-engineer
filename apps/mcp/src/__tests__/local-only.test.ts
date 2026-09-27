import { describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The MCP server is local-only: it speaks stdio and must never open a
// network port, even if someone passes the legacy --http flag.
const TEST_PORT = 32147;

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
    const linkDir = path.join(tmpdir(), 'pe-mcp-local-only-test');
    const linkEntry = path.join(linkDir, 'mcp-link.mjs');
    mkdirSync(linkDir, { recursive: true });
    rmSync(linkEntry, { force: true });
    symlinkSync(entry, linkEntry);
    let child: ChildProcess | undefined;
    let spawnError: unknown;
    try {
      child = spawn(process.execPath, [linkEntry, '--http'], {
        env: {
          ...process.env,
          MCP_PORT: String(TEST_PORT),
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
      expect(await isHttpListening(TEST_PORT)).toBe(false);
    } finally {
      child?.kill('SIGKILL');
      rmSync(linkEntry, { force: true });
    }
  }, 15000);
});
