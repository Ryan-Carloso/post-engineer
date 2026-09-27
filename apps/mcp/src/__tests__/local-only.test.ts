import { describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
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
    let child: ChildProcess | undefined;
    try {
      child = spawn(process.execPath, [entry, '--http'], {
        env: { ...process.env, MCP_PORT: String(TEST_PORT) },
        stdio: 'ignore',
      });
      child.on('error', (err) => {
        throw err;
      });
      // Give the process time to bind the port, if it were going to.
      await delay(2000);
      expect(await isHttpListening(TEST_PORT)).toBe(false);
    } finally {
      child?.kill('SIGKILL');
    }
  }, 15000);
});
