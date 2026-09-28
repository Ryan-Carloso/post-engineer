//---------------
// Magic Bytes — detects the real MIME type from the file content.
// The client-declared Content-Type is spoofable; the content is not.
// Supported formats: JPEG, PNG, WebP, GIF, MP4 and MOV.
//---------------

export function detectMagicMimeType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }

  // WebP: 'RIFF' at 0-3 and 'WEBP' at 8-11 (length >= 12 is guaranteed by
  // the early return above, so no redundant length check here).
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  // GIF: 'GIF87a' or 'GIF89a' — not an accepted upload type, but detecting
  // it lets callers report a precise mismatch instead of "unrecognized".
  const gifHeader = buffer.subarray(0, 6).toString('ascii');
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
    return 'image/gif';
  }

  // MP4: 'ftyp' box at bytes 4-7 (brand varies: isom, mp42, etc.)
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    // MOV also uses ftyp — the 'qt ' brand indicates QuickTime
    const brand = buffer.subarray(8, 12).toString('ascii').trim();
    if (brand === 'qt') {
      return 'video/quicktime';
    }
    return 'video/mp4';
  }

  return null;
}
