// @vitest-environment node
// Direct unit tests for the uploadFile helper extracted from
// app/api/persona/route.ts: the fixed `photo.<ext>` path, the bytes and
// content type sent to storage, and the storage-error path (logs, null).
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { uploadFile } from '../upload-file';
import { logger } from '@/lib/logger';
import { IMAGE_BUCKET, personaAssetPath } from '@/lib/persona-images';

function mockClient(upload: ReturnType<typeof vi.fn>) {
  return {
    storage: { from: vi.fn(() => ({ upload })) },
  };
}

describe('uploadFile', () => {
  beforeEach(() => {
    vi.mocked(logger.error).mockClear();
  });

  it('uploads the file bytes to the fixed photo path and returns it', async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const supabase = mockClient(upload);
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const file = new File([bytes], 'photo.png', { type: 'image/png' });
    const expectedPath = personaAssetPath('user-1', 'persona-1', 'photo.png');

    const result = await uploadFile(supabase as never, 'user-1', 'persona-1', file, 'png');

    expect(result).toBe(expectedPath);
    expect(supabase.storage.from).toHaveBeenCalledWith(IMAGE_BUCKET);
    expect(upload).toHaveBeenCalledWith(expectedPath, bytes, { contentType: 'image/png' });
  });

  it('returns null and logs when the storage upload fails', async () => {
    const failure = { message: 'boom' };
    const upload = vi.fn(async () => ({ error: failure }));
    const supabase = mockClient(upload);
    const file = new File([new Uint8Array([1])], 'photo.png', { type: 'image/png' });
    const expectedPath = personaAssetPath('user-1', 'persona-1', 'photo.png');

    const result = await uploadFile(supabase as never, 'user-1', 'persona-1', file, 'png');

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledWith('[api/persona] storage upload failed', failure, { path: expectedPath });
  });
});
