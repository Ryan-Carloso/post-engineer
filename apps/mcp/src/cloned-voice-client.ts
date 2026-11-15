import { request as httpsRequest } from 'node:https';
import { lookup } from 'node:dns/promises';
import { readFile, stat } from 'node:fs/promises';
import { isIP } from 'node:net';
import { basename, extname } from 'node:path';
import type { LookupFunction } from 'node:net';
import type { IncomingMessage } from 'node:http';

import { readApiFailure } from './errors.js';
import { MAX_CLONE_AUDIO_BYTES, MAX_CLONE_AUDIO_MB } from './limits.js';
import { isPublicIp } from './public-ip.js';

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

export type HostLookup = (hostname: string) => Promise<ReadonlyArray<{ address: string }>>;

export interface CloneAudioFetchOptions {
  /** Remote (hosted) server: https only, and every resolved address must be public. */
  readonly remote?: boolean;
  /** DNS resolution, injectable for tests; defaults to node:dns/promises lookup(all). */
  readonly lookup?: HostLookup;
}

const defaultLookup: HostLookup = (hostname) => lookup(hostname, { all: true });

// Fail closed: a resolution error, no address, or any non-public address rejects.
// Returns the validated addresses so the fetch pins to them (see below).
async function assertPublicHost(
  hostname: string,
  resolve: HostLookup,
): Promise<ReadonlyArray<{ address: string }>> {
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  let addresses: ReadonlyArray<{ address: string }>;
  try {
    addresses = isIP(bare) ? [{ address: bare }] : await resolve(bare);
  } catch {
    throw new Error('audioUrl must point to a public host');
  }
  if (addresses.length === 0 || !addresses.every((a) => isPublicIp(a.address))) {
    throw new Error('audioUrl must point to a public host');
  }
  return addresses;
}

// A lookup that answers only with the addresses the SSRF check validated:
// the TLS connection can only go to a validated public address, so a second
// DNS answer (DNS rebinding: the check sees a public address, the fetch
// sees 169.254.169.254 / 127.0.0.1) cannot diverge from the first. The
// hostname argument is ignored on purpose — the validated set is the only
// source of truth. A family the validated set cannot serve fails closed
// instead of falling back to a fresh resolution.
function pinnedLookup(addresses: ReadonlyArray<{ address: string }>): LookupFunction {
  return (hostname, options, callback) => {
    const wantedFamily = typeof options.family === 'number' ? options.family : 0;
    const matching = addresses.filter((a) => {
      const family = isIP(a.address);
      return wantedFamily === 0 || family === wantedFamily;
    });
    if (matching.length === 0) {
      const error = Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
        code: 'ENOTFOUND',
      });
      callback(error, '', 0);
      return;
    }
    if (options.all === true) {
      callback(
        null,
        matching.map((a) => ({ address: a.address, family: isIP(a.address) })),
        0,
      );
      return;
    }
    const first = matching[0];
    callback(null, first.address, isIP(first.address));
  };
}

// Download over pinned DNS: the https request resolves through pinnedLookup,
// so the socket connects to a validated public address with the original
// hostname as SNI (the certificate is still verified against the hostname).
// Redirects are rejected, exactly like redirect: 'error' on the fetch path.
async function fetchRemoteAudioPinned(
  parsed: URL,
  addresses: ReadonlyArray<{ address: string }>,
  signal: AbortSignal,
): Promise<{ buffer: Buffer; contentType: string }> {
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = httpsRequest(
      parsed.toString(),
      { lookup: pinnedLookup(addresses), signal },
      resolve,
    );
    request.on('error', reject);
    request.end();
  });
  const status = response.statusCode ?? 0;
  if (status >= 300 && status < 400) {
    response.resume();
    throw new Error('Failed to download audio: redirect not allowed');
  }
  if (status < 200 || status >= 300) {
    response.resume();
    throw new Error(`Failed to download audio: HTTP ${status}`);
  }
  const buffer = await readNodeBodyWithCap(response, MAX_CLONE_AUDIO_BYTES);
  if (buffer.length === 0) {
    throw new Error('Downloaded audio is empty');
  }
  const contentTypeHeader = response.headers['content-type'];
  const contentType =
    (Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader) ??
    'application/octet-stream';
  return { buffer, contentType };
}

// Stream a Node response body without buffering past maxBytes: cancel the
// stream as soon as the cap is exceeded, mirroring readBodyWithCap.
async function readNodeBodyWithCap(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of response) {
      const buffer = Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > maxBytes) {
        response.destroy();
        throw new Error(`Downloaded audio exceeds ${maxBytes / (1024 * 1024)} MB`);
      }
      chunks.push(buffer);
    }
  } catch (error) {
    response.destroy();
    throw error;
  }
  return Buffer.concat(chunks);
}

export async function fetchCloneReferenceAudio(
  audioUrl: string,
  options: CloneAudioFetchOptions = {},
): Promise<Blob> {
  let parsed: URL;
  try {
    parsed = new URL(audioUrl);
  } catch {
    throw new Error('audioUrl must be a valid URL');
  }
  if (options.remote === true) {
    if (parsed.protocol !== 'https:') {
      throw new Error('audioUrl must use https');
    }
    // The fetch pins DNS to the addresses this check validated (pinnedLookup
    // in fetchRemoteAudioPinned): a second resolution cannot rebind the host
    // to a private address after the check passed.
    const addresses = await assertPublicHost(parsed.hostname, options.lookup ?? defaultLookup);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    try {
      const { buffer, contentType } = await fetchRemoteAudioPinned(
        parsed,
        addresses,
        controller.signal,
      );
      return new Blob([buffer], { type: contentType });
    } finally {
      clearTimeout(timeout);
    }
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
    const buffer = await readBodyWithCap(response, MAX_CLONE_AUDIO_BYTES);
    if (buffer.length === 0) {
      throw new Error('Downloaded audio is empty');
    }
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    return new Blob([buffer], { type: contentType });
  } finally {
    clearTimeout(timeout);
  }
}

// Accepted local reference extensions and the MIME type each is sent with.
// The web route re-validates the real content; this only fails fast.
const CLONE_AUDIO_MIME_TYPES: ReadonlyMap<string, string> = new Map([
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.m4a', 'audio/mp4'],
  ['.webm', 'audio/webm'],
]);

function assertCloneAudioSize(bytes: number, name: string): void {
  if (bytes > MAX_CLONE_AUDIO_BYTES) {
    throw new Error(`Audio "${name}" exceeds ${MAX_CLONE_AUDIO_MB} MB.`);
  }
}

/**
 * Read a local reference recording for a voice clone. Extension and stat()
 * size are checked before the file is read (bounded memory), the size is
 * re-checked after the read, and errors carry only the file's basename,
 * never the full local path.
 */
export async function readCloneReferenceFile(
  path: string,
): Promise<{ blob: Blob; filename: string }> {
  const name = basename(path);
  const mimeType = CLONE_AUDIO_MIME_TYPES.get(extname(name).toLowerCase());
  if (mimeType === undefined) {
    throw new Error(`Audio "${name}" must be an MP3, WAV, M4A, or WebM file.`);
  }
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch {
    throw new Error(`Failed to read audio "${name}".`);
  }
  if (!fileStat.isFile()) {
    throw new Error(`Audio "${name}" is not a file.`);
  }
  assertCloneAudioSize(fileStat.size, name);
  let buffer: Buffer;
  try {
    buffer = await readFile(path);
  } catch {
    throw new Error(`Failed to read audio "${name}".`);
  }
  if (buffer.length === 0) {
    throw new Error(`Audio "${name}" is empty.`);
  }
  assertCloneAudioSize(buffer.length, name);
  return { blob: new Blob([buffer], { type: mimeType }), filename: name };
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
  options: CloneAudioFetchOptions = {},
): Promise<unknown> {
  if (!consent) {
    throw new Error('consent must be true to create a voice clone');
  }
  const blob = await fetchCloneReferenceAudio(audioUrl, options);
  return postCloneReference(client, blob, 'reference.bin', language, denoise);
}

export async function createClonedVoiceFromFile(
  client: ClonedVoiceClientHost,
  audioPath: string,
  language: string,
  consent: boolean,
  denoise: boolean,
): Promise<unknown> {
  if (!consent) {
    throw new Error('consent must be true to create a voice clone');
  }
  const { blob, filename } = await readCloneReferenceFile(audioPath);
  return postCloneReference(client, blob, filename, language, denoise);
}

async function postCloneReference(
  client: ClonedVoiceClientHost,
  blob: Blob,
  filename: string,
  language: string,
  denoise: boolean,
): Promise<unknown> {
  const formData = new FormData();
  formData.set('consent', 'true');
  formData.set('denoise', denoise ? 'true' : 'false');
  formData.set('language', language);
  formData.set('file', blob, filename);
  return client.request(
    '/api/persona/cloned-voices',
    { method: 'POST', headers: client.getHeaders(false), body: formData },
    'create cloned voice',
    UPLOAD_TIMEOUT_MS,
  );
}

export async function getClonedVoice(
  client: ClonedVoiceClientHost,
  cloneId: string,
): Promise<unknown> {
  return client.request(
    `/api/persona/cloned-voices/${encodeURIComponent(cloneId)}`,
    { method: 'GET', headers: client.getHeaders() },
    'get cloned voice',
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
  text?: string,
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
    // Caller text travels in the JSON body, never the URL.
    ...(text === undefined ? {} : { body: JSON.stringify({ text }) }),
    redirect: 'error',
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    const errorText = await response.text();
    // Same contract as client.request: structured `error`, and every
    // message in an `errors` list, capped inside readApiFailure.
    const failure = readApiFailure(errorText);
    throw new Error(`Failed to preview cloned voice: ${response.status} ${failure.detail}`);
  }
  const bytes = await readBodyWithCap(response, MAX_CLONE_AUDIO_BYTES, 'Preview audio');
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

// House-voice preview: same own-fetch pattern as previewClonedVoice, but
// the voice is a catalog id (`chatterbox:<name>`) and there is no language
// override — house voices are English-only.
export async function previewHouseVoice(
  client: ClonedVoiceClientHost,
  voiceId: string,
  text?: string,
): Promise<unknown> {
  const path = `/api/persona/voices/${encodeURIComponent(voiceId)}/preview`;
  // The preview route answers with raw audio bytes, not JSON, so it cannot
  // go through the client's JSON request path: fetch the bytes here and
  // surface them as base64 (same own-fetch pattern as the download above).
  // The upload timeout applies: preview synthesis can cold-start the local TTS server.
  const response = await fetch(`${client.baseUrl}${path}`, {
    method: 'POST',
    headers: client.getHeaders(),
    // Caller text travels in the JSON body, never the URL.
    ...(text === undefined ? {} : { body: JSON.stringify({ text }) }),
    redirect: 'error',
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    const errorText = await response.text();
    // Same contract as client.request: structured `error`, and every
    // message in an `errors` list, capped inside readApiFailure.
    const failure = readApiFailure(errorText);
    throw new Error(`Failed to preview house voice: ${response.status} ${failure.detail}`);
  }
  const bytes = await readBodyWithCap(response, MAX_CLONE_AUDIO_BYTES, 'Preview audio');
  if (bytes.length === 0) {
    throw new Error(
      `Failed to preview house voice: preview audio was empty (status ${response.status}).`,
    );
  }
  return {
    audioBase64: bytes.toString('base64'),
    contentType: response.headers.get('content-type'),
  };
}
