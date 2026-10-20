import { ApiError } from './errors.js';

const UPLOAD_TIMEOUT_MS = 120_000;

export interface ClonedVoiceClientHost {
  getHeaders(includeContentType?: boolean): Record<string, string>;
  request(
    path: string,
    init: RequestInit,
    label: string,
    timeoutMs?: number,
  ): Promise<unknown>;
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
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new Error('Downloaded audio is empty');
    }
    const maxBytes = 20 * 1024 * 1024;
    if (buffer.length > maxBytes) {
      throw new Error(`Downloaded audio exceeds ${maxBytes / (1024 * 1024)} MB`);
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
): Promise<unknown> {
  if (!consent) {
    throw new Error('consent must be true to create a voice clone');
  }
  const blob = await fetchCloneReferenceAudio(audioUrl);
  const formData = new FormData();
  formData.set('consent', 'true');
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
  const response = await client.request(
    path,
    { method: 'POST', headers: client.getHeaders() },
    'preview cloned voice',
  );
  if (typeof response !== 'object' || response === null) {
    throw new Error('unexpected preview response');
  }
  const record = response as Record<string, unknown>;
  if (typeof record.audioBase64 !== 'string') {
    throw new Error('preview response missing audioBase64');
  }
  return record;
}
