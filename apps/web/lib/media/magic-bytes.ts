//---------------
// Magic Bytes — detects the real MIME type from the file content.
// The client-declared Content-Type is spoofable; the content is not.
// Formatos suportados: JPEG, PNG, MP4 e MOV.
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
