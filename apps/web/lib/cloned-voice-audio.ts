/** Client/server guards for voice-clone reference uploads (engine enforces duration). */

export const MAX_CLONE_REFERENCE_BYTES = 20 * 1024 * 1024;
export const MAX_CLONE_REFERENCE_SECONDS = 60;
export const MIN_CLONE_REFERENCE_SECONDS = 1;
// Mirrors MAX_CLONE_NAME_LENGTH in the engine's cloned_voices constants.
export const MAX_CLONE_NAME_LENGTH = 60;

export const ALLOWED_CLONE_REFERENCE_MIME_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/webm',
  'audio/x-m4a',
] as const;

export type AllowedCloneReferenceMime = (typeof ALLOWED_CLONE_REFERENCE_MIME_TYPES)[number];

const MIME_SET = new Set<string>(ALLOWED_CLONE_REFERENCE_MIME_TYPES);

export function isAllowedCloneReferenceMime(mime: string): boolean {
  return MIME_SET.has(mime);
}

type ByteSource = Buffer | Uint8Array;

function byteAt(buffer: ByteSource, index: number): number {
  return buffer[index] ?? 0;
}

/** Detect audio container from magic bytes (declared MIME is not trusted). */
export function detectCloneReferenceMime(buffer: ByteSource): AllowedCloneReferenceMime | null {
  if (buffer.length < 12) {
    return null;
  }

  const riff =
    byteAt(buffer, 0) === 0x52 &&
    byteAt(buffer, 1) === 0x49 &&
    byteAt(buffer, 2) === 0x46 &&
    byteAt(buffer, 3) === 0x46;
  const wave =
    byteAt(buffer, 8) === 0x57 &&
    byteAt(buffer, 9) === 0x41 &&
    byteAt(buffer, 10) === 0x56 &&
    byteAt(buffer, 11) === 0x45;
  if (riff && wave) {
    return 'audio/wav';
  }

  if (byteAt(buffer, 0) === 0xff && (byteAt(buffer, 1) & 0xe0) === 0xe0) {
    return 'audio/mpeg';
  }
  if (byteAt(buffer, 0) === 0x49 && byteAt(buffer, 1) === 0x44 && byteAt(buffer, 2) === 0x33) {
    return 'audio/mpeg';
  }

  const ftyp =
    byteAt(buffer, 4) === 0x66 &&
    byteAt(buffer, 5) === 0x74 &&
    byteAt(buffer, 6) === 0x79 &&
    byteAt(buffer, 7) === 0x70;
  if (ftyp) {
    return 'audio/mp4';
  }

  if (
    byteAt(buffer, 0) === 0x1a &&
    byteAt(buffer, 1) === 0x45 &&
    byteAt(buffer, 2) === 0xdf &&
    byteAt(buffer, 3) === 0xa3
  ) {
    return 'audio/webm';
  }

  return null;
}

export function validateCloneReferenceBuffer(
  buffer: ByteSource,
): { ok: true } | { ok: false; error: string } {
  if (buffer.length === 0) {
    return { ok: false, error: 'Reference audio is empty.' };
  }
  if (buffer.length > MAX_CLONE_REFERENCE_BYTES) {
    return { ok: false, error: 'Reference audio exceeds the 20 MB limit.' };
  }
  const detected = detectCloneReferenceMime(buffer);
  if (detected === null) {
    return { ok: false, error: 'Only MP3, WAV, M4A, or WebM reference audio is accepted.' };
  }
  return { ok: true };
}
