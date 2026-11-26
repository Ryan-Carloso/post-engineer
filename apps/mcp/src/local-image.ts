import { basename } from 'node:path';

import { readBoundedRegularFile } from './bounded-file-read.js';
import { detectSegmentImageMimeType } from './image-mime.js';
import { MAX_PUBLISH_IMAGE_BYTES, MAX_PUBLISH_IMAGE_MB } from './limits.js';

export async function readLocalImage(path: string): Promise<{ buffer: Buffer; mimeType: string }> {
  let read;
  try {
    read = await readBoundedRegularFile(path, MAX_PUBLISH_IMAGE_BYTES);
  } catch {
    throw new Error(`Failed to read image "${basename(path)}".`);
  }
  if (read.status === 'not-file') {
    throw new Error(`Image "${basename(path)}" is not a regular file.`);
  }
  if (read.status === 'too-large') {
    throw new Error(
      `Image "${basename(path)}" is too large (${read.sizeBytes} bytes; max ${MAX_PUBLISH_IMAGE_MB}MB).`,
    );
  }
  const { buffer } = read;
  if (buffer.length === 0) {
    throw new Error(`Image "${basename(path)}" is empty.`);
  }
  const mimeType = detectSegmentImageMimeType(buffer);
  if (mimeType === null) {
    throw new Error(
      `Image "${basename(path)}" is not a JPG, PNG, or WebP image (real content, not extension).`,
    );
  }
  return { buffer, mimeType };
}
