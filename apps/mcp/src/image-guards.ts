import { extname } from 'node:path';

export function mimeTypeForImagePath(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  throw new Error(
    `Unsupported image extension "${extension || '(none)'}": use JPG/JPEG, PNG, or WebP.`,
  );
}
