import { describe, expect, it } from 'vitest';

import {
  ALLOWED_CLONE_REFERENCE_MIME_TYPES,
  MAX_CLONE_REFERENCE_BYTES,
  detectCloneReferenceMime,
  isAllowedCloneReferenceMime,
  validateCloneReferenceBuffer,
} from '@/lib/cloned-voice-audio';

function bytes(...values: number[]): Uint8Array {
  const out = new Uint8Array(Math.max(12, values.length));
  out.set(values);
  return out;
}

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

  it('accepts exactly the allow-listed mime types and rejects others', () => {
    for (const mime of ALLOWED_CLONE_REFERENCE_MIME_TYPES) {
      expect(isAllowedCloneReferenceMime(mime)).toBe(true);
    }
    expect(isAllowedCloneReferenceMime('audio/ogg')).toBe(false);
    expect(isAllowedCloneReferenceMime('audio/mpeg ')).toBe(false);
    expect(isAllowedCloneReferenceMime('AUDIO/MPEG')).toBe(false);
    expect(isAllowedCloneReferenceMime('')).toBe(false);
  });

  it('returns null for buffers shorter than 12 bytes even with a valid prefix', () => {
    expect(detectCloneReferenceMime(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBeNull();
    expect(detectCloneReferenceMime(new Uint8Array(11))).toBeNull();
    expect(detectCloneReferenceMime(new Uint8Array())).toBeNull();
  });

  it('detects mp3 from an MPEG frame sync', () => {
    expect(detectCloneReferenceMime(bytes(0xff, 0xfb, 0x90, 0x00))).toBe('audio/mpeg');
  });

  it('detects mp3 from an ID3 tag', () => {
    expect(detectCloneReferenceMime(bytes(0x49, 0x44, 0x33, 0x03))).toBe('audio/mpeg');
  });

  it('detects mp4 from an ftyp box', () => {
    expect(detectCloneReferenceMime(bytes(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70))).toBe(
      'audio/mp4',
    );
  });

  it('detects webm from the EBML header', () => {
    expect(detectCloneReferenceMime(bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe('audio/webm');
  });

  it('returns null for unknown magic bytes', () => {
    expect(detectCloneReferenceMime(bytes(0x00, 0x01, 0x02, 0x03, 0x04, 0x05))).toBeNull();
  });

  it('returns null when only half of the RIFF/WAVE signature matches', () => {
    const riffOnly = bytes(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00);
    expect(detectCloneReferenceMime(riffOnly)).toBeNull();
    const waveOnly = bytes(0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45);
    expect(detectCloneReferenceMime(waveOnly)).toBeNull();
  });

  it('rejects buffers over the 20 MB limit with the exact error', () => {
    const oversized = new Uint8Array(MAX_CLONE_REFERENCE_BYTES + 1);
    expect(validateCloneReferenceBuffer(oversized)).toEqual({
      ok: false,
      error: 'Reference audio exceeds the 20 MB limit.',
    });
  });

  it('accepts a valid buffer at exactly the 20 MB limit', () => {
    const atLimit = new Uint8Array(MAX_CLONE_REFERENCE_BYTES);
    atLimit.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45], 0);
    expect(validateCloneReferenceBuffer(atLimit)).toEqual({ ok: true });
  });

  it('rejects unknown containers with the exact accepted-formats error', () => {
    expect(validateCloneReferenceBuffer(bytes(0x4f, 0x67, 0x67, 0x53))).toEqual({
      ok: false,
      error: 'Only MP3, WAV, M4A, or WebM reference audio is accepted.',
    });
  });

  it('accepts each detected container type', () => {
    expect(validateCloneReferenceBuffer(bytes(0xff, 0xfb))).toEqual({ ok: true });
    expect(validateCloneReferenceBuffer(bytes(0x1a, 0x45, 0xdf, 0xa3))).toEqual({ ok: true });
    expect(
      validateCloneReferenceBuffer(bytes(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70)),
    ).toEqual({ ok: true });
  });
});
