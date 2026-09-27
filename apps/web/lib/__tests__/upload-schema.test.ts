import { describe, it, expect } from 'vitest';
import { parseMediaUpload, MAX_FILE_SIZE, ALLOWED_TYPES, ALLOWED_TYPES_SET, ALLOWED_EXTENSIONS } from '@/lib/media/upload-schema';

function makeFile(type: string, name = 'test', size = 1024): File {
  return new File([new ArrayBuffer(Math.max(size, 12))], `${name}.${type.split('/')[1]}`, { type });
}

function jpegBuffer(): Buffer {
  return Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
}

function pngBuffer(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
}

function mp4Buffer(): Buffer {
  const ftyp = Buffer.alloc(12);
  ftyp.write('ftyp', 0, 'ascii');
  ftyp.write('isom', 4, 'ascii');
  const full = Buffer.alloc(12);
  ftyp.copy(full, 4);
  return full;
}

function movBuffer(): Buffer {
  const ftyp = Buffer.alloc(12);
  ftyp.write('ftyp', 0, 'ascii');
  ftyp.write('qt  ', 4, 'ascii');
  const full = Buffer.alloc(12);
  ftyp.copy(full, 4);
  return full;
}

describe('constants', () => {
  it('MAX_FILE_SIZE is 100MB', () => {
    expect(MAX_FILE_SIZE).toBe(100 * 1024 * 1024);
  });

  it('ALLOWED_TYPES contains expected values', () => {
    expect(ALLOWED_TYPES).toContain('video/mp4');
    expect(ALLOWED_TYPES).toContain('video/quicktime');
    expect(ALLOWED_TYPES).toContain('image/jpeg');
    expect(ALLOWED_TYPES).toContain('image/png');
  });

  it('ALLOWED_TYPES_SET matches ALLOWED_TYPES', () => {
    for (const t of ALLOWED_TYPES) {
      expect(ALLOWED_TYPES_SET.has(t)).toBe(true);
    }
  });

  it('ALLOWED_EXTENSIONS is a string', () => {
    expect(ALLOWED_EXTENSIONS).toContain('mp4');
    expect(ALLOWED_EXTENSIONS).toContain('jpeg');
  });
});

describe('parseMediaUpload', () => {
  it('valid JPEG → success', () => {
    const file = makeFile('image/jpeg');
    const result = parseMediaUpload(file, jpegBuffer());
    expect(result.success).toBe(true);
    if (result.success) expect(result.detectedType).toBe('image/jpeg');
  });

  it('valid PNG → success', () => {
    const file = makeFile('image/png');
    const result = parseMediaUpload(file, pngBuffer());
    expect(result.success).toBe(true);
    if (result.success) expect(result.detectedType).toBe('image/png');
  });

  it('valid MP4 → success', () => {
    const file = makeFile('video/mp4');
    const result = parseMediaUpload(file, mp4Buffer());
    expect(result.success).toBe(true);
    if (result.success) expect(result.detectedType).toBe('video/mp4');
  });

  it('valid MOV → success', () => {
    const file = makeFile('video/quicktime');
    const result = parseMediaUpload(file, movBuffer());
    expect(result.success).toBe(true);
    if (result.success) expect(result.detectedType).toBe('video/quicktime');
  });

  it('null file → FILE_REQUIRED', () => {
    const result = parseMediaUpload(null, Buffer.alloc(12));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.code === 'FILE_REQUIRED')).toBe(true);
    }
  });

  it('empty file → FILE_EMPTY', () => {
    const file = new File([], 'empty.png', { type: 'image/png' });
    const result = parseMediaUpload(file, Buffer.alloc(0));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.code === 'FILE_EMPTY')).toBe(true);
    }
  });

  it('file > MAX_FILE_SIZE → FILE_TOO_LARGE', () => {
    const file = new File([new ArrayBuffer(MAX_FILE_SIZE + 1)], 'big.mp4', { type: 'video/mp4' });
    const result = parseMediaUpload(file, mp4Buffer());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.code === 'FILE_TOO_LARGE')).toBe(true);
    }
  });

  it('disallowed type → FORMAT_NOT_ALLOWED', () => {
    const file = makeFile('video/webm');
    const buf = Buffer.alloc(12);
    const result = parseMediaUpload(file, buf);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.code === 'FORMAT_NOT_ALLOWED')).toBe(true);
    }
  });

  it('type mismatch (declared JPEG, content PNG) → TYPE_MISMATCH', () => {
    const file = makeFile('image/jpeg');
    const result = parseMediaUpload(file, pngBuffer());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.code === 'TYPE_MISMATCH')).toBe(true);
    }
  });

  it('unrecognized content → CONTENT_UNRECOGNIZED', () => {
    const file = makeFile('image/jpeg');
    const random = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B]);
    const result = parseMediaUpload(file, random);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.code === 'CONTENT_UNRECOGNIZED')).toBe(true);
    }
  });
});
