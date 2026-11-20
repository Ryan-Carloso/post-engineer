import { detectSegmentImageMimeType } from './image-mime.js';
import { fetchPublicHttps, type HostLookup } from './public-fetch.js';

const IMAGE_DOWNLOAD_TIMEOUT_MS = 120_000;
const IMAGE_SUBJECT = { param: 'imageUrl', noun: 'image' } as const;
const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface RemoteImage {
  readonly buffer: Buffer;
  readonly mimeType: string;
  readonly filename: string;
}

function filenameFor(parsed: URL, mimeType: string): string {
  const last = decodeURIComponent(parsed.pathname.split('/').filter((part) => part !== '').pop() ?? '');
  const safe = last.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
  if (/\.(jpe?g|png|webp)$/i.test(safe)) return safe;
  return `image.${EXTENSIONS[mimeType]}`;
}

export async function fetchRemoteImage(
  imageUrl: string,
  options: { readonly maxBytes: number; readonly lookup?: HostLookup },
): Promise<RemoteImage> {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new Error('imageUrl must be a valid URL');
  }
  const { buffer } = await fetchPublicHttps(parsed, {
    subject: IMAGE_SUBJECT,
    maxBytes: options.maxBytes,
    timeoutMs: IMAGE_DOWNLOAD_TIMEOUT_MS,
    lookup: options.lookup,
  });
  const mimeType = detectSegmentImageMimeType(buffer);
  if (mimeType === null) {
    throw new Error('imageUrl must point to a JPG, PNG, or WebP image (real content, not extension).');
  }
  return { buffer, mimeType, filename: filenameFor(parsed, mimeType) };
}
