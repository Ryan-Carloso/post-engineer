import { extname } from 'node:path';
import { ImageTooLargeError } from './errors.js';
import { MAX_LIBRARY_IMAGE_BYTES } from './limits.js';

export function assertImageSize(sizeBytes: number, path: string): void {
  if (sizeBytes > MAX_LIBRARY_IMAGE_BYTES) {
    throw new ImageTooLargeError(path, sizeBytes);
  }
}

export function mimeTypeForImagePath(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  throw new Error(
    `Unsupported image extension "${extension || '(none)'}": use JPG/JPEG, PNG, or WebP.`,
  );
}
