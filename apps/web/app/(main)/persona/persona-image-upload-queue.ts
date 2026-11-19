import { ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_BYTES } from '@/lib/persona-image-select';

export function partitionPickedImages(files: readonly File[]): { picked: File[]; rejectedCount: number } {
  const picked = files.filter(
    (file) => ALLOWED_IMAGE_MIME_TYPES.has(file.type) && file.size > 0 && file.size <= MAX_IMAGE_BYTES,
  );
  return { picked, rejectedCount: files.length - picked.length };
}

export const UPLOAD_CONCURRENCY = 3;

export type UploadOutcome<E> = { ok: true; warnings: string[] } | { ok: false; error: E };

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
