//---------------
// provider-types — upload/mode types accept ANY provider,
// not just 'youtube' | 'instagram'.
//---------------

import { describe, it, expect } from 'vitest';
import type { UploadContentResult } from '@/lib/types';
import { useUploadStore } from '@/lib/store';

describe('provider-agnostic types', () => {
  it('UploadContentResult.provider aceita bluesky/linkedin', () => {
    const result: UploadContentResult = { success: true, provider: 'bluesky' };
    expect(result.provider).toBe('bluesky');
  });

  it('store mode aceita qualquer provider', () => {
    useUploadStore.getState().setMode('linkedin');
    expect(useUploadStore.getState().mode).toBe('linkedin');
    useUploadStore.getState().setMode('youtube');
  });
});
