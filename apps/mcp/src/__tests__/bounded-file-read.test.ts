import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readBoundedRegularFile } from '../bounded-file-read.js';

const posixOnly = process.platform === 'win32' ? it.skip : it;
const linuxOnly = process.platform === 'linux' ? it : it.skip;

describe('readBoundedRegularFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pe-bounded-read-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the whole content of a regular file at the cap', async () => {
    const path = join(dir, 'exact.bin');
    writeFileSync(path, Buffer.from([1, 2, 3, 4]));
    expect(await readBoundedRegularFile(path, 4)).toEqual({ status: 'ok', buffer: Buffer.from([1, 2, 3, 4]) });
  });

  it('returns an empty buffer for an empty regular file', async () => {
    const path = join(dir, 'empty.bin');
    writeFileSync(path, Buffer.alloc(0));
    expect(await readBoundedRegularFile(path, 4)).toEqual({ status: 'ok', buffer: Buffer.alloc(0) });
  });

  it('reads a file larger than one chunk in full', async () => {
    const path = join(dir, 'chunks.bin');
    const content = Buffer.alloc(300 * 1024, 7);
    writeFileSync(path, content);
    const result = await readBoundedRegularFile(path, content.length);
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.buffer.equals(content)).toBe(true);
  });

  it('reports a file over the cap from its handle size', async () => {
    const path = join(dir, 'big.bin');
    writeFileSync(path, Buffer.alloc(5));
    expect(await readBoundedRegularFile(path, 4)).toEqual({ status: 'too-large', sizeBytes: 5 });
  });

  linuxOnly('stops reading at cap + 1 bytes when the reported size understates the content', async () => {
    expect(await readBoundedRegularFile('/proc/self/status', 8)).toEqual({ status: 'too-large', sizeBytes: 9 });
  });

  it('rejects a directory as not a regular file', async () => {
    const path = join(dir, 'folder');
    mkdirSync(path);
    expect(await readBoundedRegularFile(path, 4)).toEqual({ status: 'not-file' });
  });

  posixOnly('rejects /dev/zero behind a symlink without reading it', async () => {
    const path = join(dir, 'zero.png');
    symlinkSync('/dev/zero', path);
    expect(await readBoundedRegularFile(path, 4)).toEqual({ status: 'not-file' });
  });

  posixOnly('rejects a FIFO without blocking on a writer', async () => {
    const path = join(dir, 'pipe.png');
    execFileSync('mkfifo', [path]);
    expect(await readBoundedRegularFile(path, 4)).toEqual({ status: 'not-file' });
  }, 2_000);

  it('throws the open error for a missing file', async () => {
    await expect(readBoundedRegularFile(join(dir, 'missing.bin'), 4)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
