import { describe, it, expect } from 'vitest';
import {
  partitionPickedImages,
  runUploadsInParallel,
  UPLOAD_CONCURRENCY,
  type UploadOutcome,
} from '../persona-image-upload-queue';

const ok: UploadOutcome<string> = { ok: true, warnings: [] };

describe('runUploadsInParallel', () => {
  it('runs uploads concurrently up to the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const outcomes = await runUploadsInParallel([1, 2, 3, 4, 5, 6], async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return ok;
    });

    expect(peak).toBe(UPLOAD_CONCURRENCY);
    expect(outcomes).toHaveLength(6);
    expect(outcomes.every((outcome) => outcome?.ok === true)).toBe(true);
  });

  it('starts no new upload after a failure and leaves untried items undefined', async () => {
    const started: number[] = [];
    const outcomes = await runUploadsInParallel(
      [1, 2, 3, 4, 5],
      async (item): Promise<UploadOutcome<string>> => {
        started.push(item);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return item === 1 ? { ok: false, error: 'boom' } : ok;
      },
      1,
    );

    expect(started).toEqual([1]);
    expect(outcomes[0]).toEqual({ ok: false, error: 'boom' });
    expect(outcomes.slice(1)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('returns an empty list for an empty queue', async () => {
    expect(await runUploadsInParallel([], async () => ok)).toEqual([]);
  });
});

describe('partitionPickedImages', () => {
  it('rejects disallowed types and empty files', () => {
    const png = new File(['x'], 'a.png', { type: 'image/png' });
    const gif = new File(['x'], 'a.gif', { type: 'image/gif' });
    const empty = new File([], 'b.png', { type: 'image/png' });

    expect(partitionPickedImages([png, gif, empty])).toEqual({ picked: [png], rejectedCount: 2 });
  });
});
