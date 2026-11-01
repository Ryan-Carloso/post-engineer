//---------------
// Bounded-parallel upload runner for the persona image library. Uploads used
// to run one after another, so a 10-image pick took ten round trips in a row.
// Up to UPLOAD_CONCURRENCY run at once; after the first failure no new upload
// starts (the user sees one actionable error and the untried items stay
// retryable), while uploads already in flight finish and are reported.
//---------------

import { ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_BYTES } from '@/lib/persona-image-select';

/**
 * partitionPickedImages — splits a file pick into uploadable files and a
 * rejected count. The explicit allowlist is the whole check: a bare
 * startsWith('image/') would also accept image/gif or image/svg+xml, which
 * the server rejects — keep client and server in agreement.
 */
export function partitionPickedImages(files: readonly File[]): { picked: File[]; rejectedCount: number } {
  const picked = files.filter(
    (file) => ALLOWED_IMAGE_MIME_TYPES.has(file.type) && file.size > 0 && file.size <= MAX_IMAGE_BYTES,
  );
  return { picked, rejectedCount: files.length - picked.length };
}

// Below the server's media-upload rate limit (10 per minute) so one pick of
// the whole library never trips the limiter on its own.
export const UPLOAD_CONCURRENCY = 3;

export type UploadOutcome<E> = { ok: true; warnings: string[] } | { ok: false; error: E };

/**
 * runUploadsInParallel — runs `uploadOne` for every item with bounded
 * concurrency. The result is index-aligned with `items`; `undefined` marks an
 * item never started because an earlier upload failed.
 */
export async function runUploadsInParallel<T, E>(
  items: readonly T[],
  uploadOne: (item: T) => Promise<UploadOutcome<E>>,
  concurrency: number = UPLOAD_CONCURRENCY,
): Promise<(UploadOutcome<E> | undefined)[]> {
  const outcomes: (UploadOutcome<E> | undefined)[] = items.map(() => undefined);
  let nextIndex = 0;
  let failed = false;

  const worker = async (): Promise<void> => {
    while (!failed && nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const outcome = await uploadOne(items[index]);
      outcomes[index] = outcome;
      if (!outcome.ok) failed = true;
    }
  };

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return outcomes;
}
