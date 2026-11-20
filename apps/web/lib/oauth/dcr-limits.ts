export const DCR_MAX_BODY_BYTES = 32 * 1024;
export const DCR_MAX_REDIRECT_URIS = 10;
export const DCR_MAX_REDIRECT_URI_LENGTH = 2048;
export const DCR_MAX_CLIENT_NAME_LENGTH = 128;

export type BoundedText = { ok: true; text: string } | { ok: false };

function declaredLengthExceeds(request: Request, maxBytes: number): boolean {
  const header = request.headers.get('content-length');
  if (header === null || !/^\d+$/.test(header)) return false;
  return Number(header) > maxBytes;
}

export async function readBoundedText(request: Request, maxBytes: number): Promise<BoundedText> {
  if (declaredLengthExceeds(request, maxBytes)) return { ok: false };
  if (request.body === null) return { ok: true, text: '' };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return { ok: false };
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}
