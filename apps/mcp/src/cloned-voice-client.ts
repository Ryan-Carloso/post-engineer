const UPLOAD_TIMEOUT_MS = 120_000;

export interface ClonedVoiceClientHost {
  getHeaders(includeContentType?: boolean): Record<string, string>;
  request(
    path: string,
    init: RequestInit,
    label: string,
    timeoutMs?: number,
  ): Promise<unknown>;
  readonly baseUrl: string;
}

/**
 * Read a fetch response body without buffering past `maxBytes`: stream the
 * chunks and cancel the stream as soon as the cap is exceeded, so a hostile
 * or broken server cannot exhaust memory with an oversized body. Falls back
 * to a capped arrayBuffer read when the response has no readable stream.
 */
async function readBodyWithCap(
  response: Response,
  maxBytes: number,
  subject = 'Downloaded audio',
): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error(`${subject} exceeds ${maxBytes / (1024 * 1024)} MB`);
    }
    return buffer;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`${subject} exceeds ${maxBytes / (1024 * 1024)} MB`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function fetchCloneReferenceAudio(audioUrl: string): Promise<Blob> {
  let parsed: URL;
  try {
    parsed = new URL(audioUrl);
  } catch {
    throw new Error('audioUrl must be a valid URL');
  }
  const loopback =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '::1' ||
    parsed.hostname === '[::1]';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new Error('audioUrl must use https (http is allowed only on loopback)');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`Failed to download audio: HTTP ${response.status}`);
    }
    const maxBytes = 20 * 1024 * 1024;
    const buffer = await readBodyWithCap(response, maxBytes);
    if (buffer.length === 0) {
      throw new Error('Downloaded audio is empty');
    }
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    return new Blob([buffer], { type: contentType });
  } finally {
    clearTimeout(timeout);
  }
}

export async function listClonedVoices(client: ClonedVoiceClientHost): Promise<unknown> {
  return client.request(
    '/api/persona/cloned-voices',
    { method: 'GET', headers: client.getHeaders() },
    'list cloned voices',
  );
}

export async function createClonedVoiceFromUrl(
  client: ClonedVoiceClientHost,
  audioUrl: string,
  language: string,
  consent: boolean,
  denoise: boolean,
): Promise<unknown> {
  if (!consent) {
    throw new Error('consent must be true to create a voice clone');
  }
  const blob = await fetchCloneReferenceAudio(audioUrl);
  const formData = new FormData();
  formData.set('consent', 'true');
  formData.set('denoise', denoise ? 'true' : 'false');
  formData.set('language', language);
  formData.set('file', blob, 'reference.bin');
  return client.request(
    '/api/persona/cloned-voices',
    { method: 'POST', headers: client.getHeaders(false), body: formData },
    'create cloned voice',
    UPLOAD_TIMEOUT_MS,
  );
}

export async function deleteClonedVoice(
  client: ClonedVoiceClientHost,
  cloneId: string,
): Promise<unknown> {
  return client.request(
    `/api/persona/cloned-voices/${encodeURIComponent(cloneId)}`,
    { method: 'DELETE', headers: client.getHeaders() },
    'delete cloned voice',
  );
}

export async function previewClonedVoice(
  client: ClonedVoiceClientHost,
  cloneId: string,
  language?: string,
): Promise<unknown> {
  const suffix =
    language && language.trim() ? `?language=${encodeURIComponent(language.trim())}` : '';
  const path = `/api/persona/cloned-voices/${encodeURIComponent(cloneId)}/preview${suffix}`;
  // The preview route answers with raw audio bytes, not JSON, so it cannot
  // go through the client's JSON request path: fetch the bytes here and
  // surface them as base64 (same own-fetch pattern as the download above).
  // The upload timeout applies: preview synthesis can cold-start the local TTS server.
  const response = await fetch(`${client.baseUrl}${path}`, {
    method: 'POST',
    headers: client.getHeaders(),
    redirect: 'error',
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    const errorText = await response.text();
    // Mirror the client's error contract: prefer the structured `error`
    // message, capped like MAX_ERROR_BODY_CHARS in client.ts.
    let detail = errorText.slice(0, 200);
    try {
      const parsed: unknown = JSON.parse(errorText);
      if (typeof parsed === 'object' && parsed !== null) {
        const record = parsed as Record<string, unknown>;
        if (typeof record.error === 'string' && record.error.length > 0) {
          detail = record.error.slice(0, 200);
        }
      }
    } catch {
      // Non-JSON body: detail stays the capped raw text.
    }
    throw new Error(`Failed to preview cloned voice: ${response.status} ${detail}`);
  }
  const bytes = await readBodyWithCap(response, 20 * 1024 * 1024, 'Preview audio');
  if (bytes.length === 0) {
    throw new Error(
      `Failed to preview cloned voice: preview audio was empty (status ${response.status}).`,
    );
  }
  return {
    audioBase64: bytes.toString('base64'),
    contentType: response.headers.get('content-type'),
  };
}
