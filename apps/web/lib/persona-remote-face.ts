//---------------
// persona-remote-face — ingest a remote http(s) avatar into the personas
// bucket. Public sample assets and data:image URLs stay on avatar_url.
// SSRF: public DNS, fail closed, redirect: 'error', http(s) only, timeout.
//---------------

import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

import type { SupabaseClient } from '@supabase/supabase-js';

import { isHttpUrl, isPublicIp } from '@/lib/generation/custom-audio';
import { isPublicAssetPath, toSameOriginAssetPath } from '@/lib/image-source';
import { logger } from '@/lib/logger';
import { detectMagicMimeType } from '@/lib/media/magic-bytes';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  IMAGE_BUCKET,
  MAX_IMAGE_BYTES,
  personaAssetPath,
  validateImageBuffer,
} from '@/lib/persona-images';

export const REMOTE_FACE_TIMEOUT_MS = 10_000;

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const REMOTE_FACE_ERROR =
  'Could not load the persona image. Use a public image URL, a sample character, or upload a photo.';

export type DnsLookupAll = (
  hostname: string,
  options: { all: true },
) => Promise<Array<{ address: string }>>;

export interface RemoteFaceFetchDeps {
  fetchImpl?: typeof fetch;
  lookupImpl?: DnsLookupAll;
  existingPhotoPath?: string | null;
}

export function isKeptAvatarUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith('data:image')) return true;
  if (trimmed.startsWith('/')) {
    const path = toSameOriginAssetPath(trimmed);
    return path !== null && isPublicAssetPath(path);
  }
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'post-engineer.com' && !host.endsWith('.post-engineer.com')) {
      return false;
    }
    return isPublicAssetPath(parsed.pathname);
  } catch {
    return false;
  }
}

export function isRemoteAvatarUrl(value: string): boolean {
  const trimmed = value.trim();
  return isHttpUrl(trimmed) && !isKeptAvatarUrl(trimmed);
}

async function assertPublicHttpUrl(
  url: string,
  lookupImpl: DnsLookupAll,
): Promise<{ ok: true; addresses: string[] } | { ok: false; error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: REMOTE_FACE_ERROR };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: REMOTE_FACE_ERROR };
  }
  try {
    const records = isIP(parsed.hostname)
      ? [{ address: parsed.hostname }]
      : await lookupImpl(parsed.hostname, { all: true });
    const addresses = records.map((record) => record.address);
    const allPublic = addresses.length > 0 && addresses.every((address) => isPublicIp(address));
    if (!allPublic) {
      return { ok: false, error: REMOTE_FACE_ERROR };
    }
    return { ok: true, addresses };
  } catch {
    return { ok: false, error: REMOTE_FACE_ERROR };
  }
}

function requestPinned(url: string, addresses: string[]): Promise<Response> {
  const parsed = new URL(url);
  const transport = parsed.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      parsed,
      {
        lookup(_hostname, _options, callback) {
          const address = addresses[0];
          callback(null, address, address.includes(':') ? 6 : 4);
        },
      },
      (incoming) => {
        const status = incoming.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          incoming.resume();
          resolve(new Response(null, { status }));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        incoming.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_IMAGE_BYTES) {
            req.destroy();
            resolve(new Response(null, { status: 413 }));
            return;
          }
          chunks.push(chunk);
        });
        incoming.on('end', () => {
          resolve(
            new Response(Buffer.concat(chunks, size), {
              status,
              headers: { 'content-type': String(incoming.headers['content-type'] ?? '') },
            }),
          );
        });
        incoming.on('error', reject);
      },
    );
    const deadline = setTimeout(() => {
      req.destroy(new Error('timeout'));
    }, REMOTE_FACE_TIMEOUT_MS);
    req.on('close', () => clearTimeout(deadline));
    req.on('error', reject);
    req.end();
  });
}

async function readCappedBody(response: Response): Promise<Buffer | null> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) {
    return null;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  if (size === 0) return null;
  return Buffer.concat(chunks, size);
}

export async function downloadPublicImage(
  url: string,
  deps: RemoteFaceFetchDeps = {},
): Promise<{ bytes: Uint8Array; mime: string; extension: string } | { error: string }> {
  const lookupImpl: DnsLookupAll =
    deps.lookupImpl ?? ((hostname) => lookup(hostname, { all: true }));
  const safety = await assertPublicHttpUrl(url, lookupImpl);
  if (!safety.ok) return { error: safety.error };

  let response: Response;
  try {
    response = deps.fetchImpl
      ? await deps.fetchImpl(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(REMOTE_FACE_TIMEOUT_MS),
      })
      : await requestPinned(url, safety.addresses);
  } catch {
    return { error: REMOTE_FACE_ERROR };
  }
  if (!response.ok) {
    return { error: REMOTE_FACE_ERROR };
  }
  let buffer: Buffer;
  try {
    const capped = await readCappedBody(response);
    if (!capped) return { error: REMOTE_FACE_ERROR };
    buffer = capped;
  } catch {
    return { error: REMOTE_FACE_ERROR };
  }
  const detected = detectMagicMimeType(buffer);
  if (!detected || !ALLOWED_IMAGE_MIME_TYPES.has(detected)) {
    return { error: REMOTE_FACE_ERROR };
  }
  const checked = validateImageBuffer(buffer, detected);
  if ('error' in checked) {
    return { error: REMOTE_FACE_ERROR };
  }
  const extension = MIME_TO_EXT[checked.mime];
  if (!extension) {
    return { error: REMOTE_FACE_ERROR };
  }
  return { bytes: new Uint8Array(buffer), mime: checked.mime, extension };
}

export async function uploadPersonaPhotoBytes(
  supabase: SupabaseClient,
  userId: string,
  personaId: string,
  bytes: Uint8Array,
  mime: string,
  extension: string,
  existingPhotoPath?: string | null,
): Promise<string | null> {
  const livePath = personaAssetPath(userId, personaId, `photo.${extension}`);
  const path =
    existingPhotoPath === livePath
      ? personaAssetPath(userId, personaId, `ingest/${randomUUID()}.${extension}`)
      : livePath;
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, bytes, {
    contentType: mime,
    upsert: path === livePath,
  });
  if (error) {
    logger.error('[persona-remote-face] storage upload failed', error.message, { path });
    return null;
  }
  return path;
}

export async function rollbackStoragePath(
  supabase: SupabaseClient,
  path: string | null | undefined,
): Promise<void> {
  if (!path) return;
  const { error } = await supabase.storage.from(IMAGE_BUCKET).remove([path]);
  if (error) {
    logger.error('[persona-remote-face] storage rollback failed', error.message, { path });
  }
}

export type ResolvedPersonaAvatar =
  | { ok: true; photoPath: string | null; avatarUrl: string | null }
  | { ok: false; error: string };

export async function resolvePersonaAvatar(
  supabase: SupabaseClient,
  userId: string,
  personaId: string,
  avatarUrl: string,
  deps: RemoteFaceFetchDeps = {},
): Promise<ResolvedPersonaAvatar> {
  const trimmed = avatarUrl.trim();
  if (isKeptAvatarUrl(trimmed)) {
    return { ok: true, photoPath: null, avatarUrl: trimmed };
  }
  if (!isRemoteAvatarUrl(trimmed)) {
    return { ok: true, photoPath: null, avatarUrl: trimmed };
  }
  const downloaded = await downloadPublicImage(trimmed, deps);
  if ('error' in downloaded) {
    return { ok: false, error: downloaded.error };
  }
  const path = await uploadPersonaPhotoBytes(
    supabase,
    userId,
    personaId,
    downloaded.bytes,
    downloaded.mime,
    downloaded.extension,
    deps.existingPhotoPath,
  );
  if (!path) {
    return { ok: false, error: 'Failed to upload photo.' };
  }
  return { ok: true, photoPath: path, avatarUrl: null };
}

export interface RemoteFaceRow {
  id: string;
  user_id: string;
  avatar_url: string | null;
  photo_path: string | null;
}

export interface IngestRemoteFacesResult {
  migrated: number;
  skipped: number;
  failed: number;
}

const INGEST_PAGE_SIZE = 1000;

export async function ingestRemotePersonaFaces(
  supabase: SupabaseClient,
  deps: RemoteFaceFetchDeps = {},
): Promise<IngestRemoteFacesResult> {
  const rows: RemoteFaceRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('personas')
      .select('id, user_id, avatar_url, photo_path')
      .range(offset, offset + INGEST_PAGE_SIZE - 1);
    if (error || !data) {
      logger.error('[persona-remote-face] list personas failed', error?.message);
      throw new Error('Failed to list personas for remote-face ingest.');
    }
    rows.push(...(data as RemoteFaceRow[]));
    if (data.length < INGEST_PAGE_SIZE) break;
    offset += INGEST_PAGE_SIZE;
  }
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    const avatar = typeof row.avatar_url === 'string' ? row.avatar_url : '';
    if (typeof row.photo_path === 'string' && row.photo_path.length > 0) {
      skipped += 1;
      continue;
    }
    if (!isRemoteAvatarUrl(avatar)) {
      skipped += 1;
      continue;
    }
    const resolved = await resolvePersonaAvatar(supabase, row.user_id, row.id, avatar, deps);
    if (!resolved.ok) {
      failed += 1;
      continue;
    }
    if (resolved.photoPath === null) {
      skipped += 1;
      continue;
    }
    const { error: updateError } = await supabase
      .from('personas')
      .update({ photo_path: resolved.photoPath, avatar_url: null })
      .eq('id', row.id)
      .eq('user_id', row.user_id);
    if (updateError) {
      logger.error('[persona-remote-face] update failed', updateError.message, { personaId: row.id });
      failed += 1;
      continue;
    }
    migrated += 1;
  }
  return { migrated, skipped, failed };
}
