import { describe, expect, it } from 'vitest';

import { detectCloneReferenceMime, validateCloneReferenceBuffer } from '@/lib/cloned-voice-audio';

describe('cloned-voice-audio', () => {
  it('detects wav from magic bytes', () => {
    const wav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(detectCloneReferenceMime(wav)).toBe('audio/wav');
  });

  it('rejects empty buffer', () => {
    expect(validateCloneReferenceBuffer(new Uint8Array())).toEqual({
      ok: false,
      error: 'Reference audio is empty.',
    });
  });
});
