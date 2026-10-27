// Shared guards for persona library image reads, extracted from client.ts
// so the client stays under the file-size ratchet. The size guard is
// shared by the stat pre-check and the post-read check so the limit and
// the message text can't drift apart.
import { extname } from 'node:path';
import { ImageTooLargeError } from './errors.js';
import { MAX_LIBRARY_IMAGE_BYTES } from './limits.js';

/**
 * Throws the typed ImageTooLargeError carrying the full path when the
 * image exceeds the library size limit.
 */
export function assertImageSize(sizeBytes: number, path: string): void {
  if (sizeBytes > MAX_LIBRARY_IMAGE_BYTES) {
    throw new ImageTooLargeError(path, sizeBytes);
  }
}

export function mimeTypeForImagePath(path: string): string {
  const extension = extname(path).toLowerCase();
  // No special hidden-file check needed: Node's extname('.PNG') is ''
  // (a leading dot with no other dots is not an extension), so dotfiles
  // fall through to the unsupported-extension rejection below.
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  throw new Error(
    `Unsupported image extension "${extension || '(none)'}": use JPG/JPEG, PNG, or WebP.`,
  );
}
