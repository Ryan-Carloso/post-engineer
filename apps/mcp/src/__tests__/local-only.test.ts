import { describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function reserveEphemeralPort(): Promise<number> {
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
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  child.on('error', (err) => {
    spawnError = err;
  });
  await delay(2000);
  expect(spawnError).toBeUndefined();
  expect(child.exitCode).toBeNull();
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

  it('stdio startup ignores a malformed HTTP-only rate-limit env var', async () => {
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
    const child = spawn(process.execPath, [entry], {
      env: { ...process.env, POST_ENGINEER_API_KEY: 'test-key', MCP_HTTP_RATE_LIMIT_PER_MINUTE: 'bogus' },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    try {
      const answered = new Promise<boolean>((resolve) => {
        let buffer = '';
        const timer = setTimeout(() => resolve(false), 10000);
        child.stdout?.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          for (const line of buffer.split('\n')) {
            try {
              const msg = JSON.parse(line) as { id?: unknown; result?: unknown };
              if (msg.id === 1 && msg.result !== undefined) {
                clearTimeout(timer);
                resolve(true);
              }
            } catch {
            }
          }
        });
        child.on('exit', () => {
          clearTimeout(timer);
          resolve(false);
        });
      });
      child.stdin?.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
        }) + '\n',
      );
      expect(await answered).toBe(true);
      expect(child.exitCode).toBeNull();
    } finally {
      child.kill('SIGKILL');
    }
  }, 20000);
});
