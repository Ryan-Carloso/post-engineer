import { describe, it, expect } from 'vitest';
import { detectMagicMimeType } from '@/lib/media/magic-bytes';

function buildFtypBox(brand: string): Buffer {
  const buf = Buffer.alloc(12);
  buf.write('ftyp', 4, 'ascii');
  buf.write(brand.padEnd(4, '\0'), 8, 'ascii');
  return buf;
}

describe('detectMagicMimeType', () => {
  it('detects JPEG', () => {
    const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
    expect(detectMagicMimeType(buf)).toBe('image/jpeg');
  });

  it('detects PNG', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
    expect(detectMagicMimeType(buf)).toBe('image/png');
  });

  it('detects MP4 (isom)', () => {
    const buf = buildFtypBox('isom');
    expect(detectMagicMimeType(buf)).toBe('video/mp4');
  });

  it('detects MP4 (mp42)', () => {
    const buf = buildFtypBox('mp42');
    expect(detectMagicMimeType(buf)).toBe('video/mp4');
  });

  it('detects MOV (qt)', () => {
    const buf = buildFtypBox('qt  ');
    expect(detectMagicMimeType(buf)).toBe('video/quicktime');
  });

  it('returns null for unknown header', () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B]);
    expect(detectMagicMimeType(buf)).toBeNull();
  });

  it('returns null for short buffer', () => {
    const buf = Buffer.from([0xFF, 0xD8, 0xFF]);
    expect(detectMagicMimeType(buf)).toBeNull();
  });

  it('returns null for empty buffer', () => {
    expect(detectMagicMimeType(Buffer.alloc(0))).toBeNull();
  });
});
