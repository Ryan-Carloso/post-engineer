import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { signedUrl } from '../persona-prep';

const IMAGE_PATH = 'user-id/persona-id/photo.webp';
const SIGNED_URL = 'https://example.supabase.co/storage/v1/object/sign/personas/user-id/persona-id/photo.webp?token=abc';

type SignCall = { bucket: string; path: string; expiresIn: number };

function signingClient(
  calls: SignCall[],
  result: { data: { signedUrl: string } | null; error: { message: string } | null },
): SupabaseClient {
  return {
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, expiresIn: number) => {
          calls.push({ bucket, path, expiresIn });
          return result;
        },
      }),
    },
  } as unknown as SupabaseClient;
}

describe('signedUrl generation expiry', () => {
  it('signs generation URLs for 24h so they outlive the serial render queue', async () => {
    const calls: SignCall[] = [];
    const supabase = signingClient(calls, { data: { signedUrl: SIGNED_URL }, error: null });

    await expect(signedUrl(supabase, IMAGE_PATH)).resolves.toBe(SIGNED_URL);
    expect(calls).toEqual([{ bucket: 'personas', path: IMAGE_PATH, expiresIn: 24 * 3600 }]);
  });

  it('returns undefined without signing when the path is null', async () => {
    const calls: SignCall[] = [];
    const supabase = signingClient(calls, { data: { signedUrl: SIGNED_URL }, error: null });

    await expect(signedUrl(supabase, null)).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('never throws: a signing error resolves to undefined', async () => {
    const calls: SignCall[] = [];
    const supabase = signingClient(calls, { data: null, error: { message: 'boom' } });

    await expect(signedUrl(supabase, IMAGE_PATH)).resolves.toBeUndefined();
    expect(calls).toEqual([{ bucket: 'personas', path: IMAGE_PATH, expiresIn: 24 * 3600 }]);
  });
});
