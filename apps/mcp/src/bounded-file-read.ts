import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

export type BoundedFileRead =
  | { status: 'ok'; buffer: Buffer }
  | { status: 'not-file' }
  | { status: 'too-large'; sizeBytes: number };

const READ_CHUNK_BYTES = 64 * 1024;

export async function readBoundedRegularFile(path: string, maxBytes: number): Promise<BoundedFileRead> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile()) return { status: 'not-file' };
    if (fileStat.size > maxBytes) return { status: 'too-large', sizeBytes: fileStat.size };
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maxBytes) {
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, maxBytes + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
    if (total > maxBytes) return { status: 'too-large', sizeBytes: total };
    return { status: 'ok', buffer: Buffer.concat(chunks, total) };
  } finally {
    await handle.close();
  }
}
