//---------------
// persona-remote-face — ingest a remote http(s) avatar into the personas
// bucket. Public sample assets and data:image URLs stay on avatar_url.
// SSRF: public DNS, fail closed, redirect: 'error', http(s) only, timeout.
//---------------

import { lookup } from 'node:dns/promises';
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
}

export function isKeptAvatarUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith('data:image')) return true;
  const sameOrigin = toSameOriginAssetPath(trimmed);
  if (sameOrigin !== null && isPublicAssetPath(sameOrigin)) return true;
  return false;
}

export function isRemoteAvatarUrl(value: string): boolean {
  const trimmed = value.trim();
  return isHttpUrl(trimmed) && !isKeptAvatarUrl(trimmed);
}

async function assertPublicHttpUrl(url: string, lookupImpl: DnsLookupAll): Promise<{ ok: true } | { ok: false; error: string }> {
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
    const addresses = isIP(parsed.hostname)
      ? [{ address: parsed.hostname }]
      : await lookupImpl(parsed.hostname, { all: true });
    const allPublic = addresses.length > 0 && addresses.every((a) => isPublicIp(a.address));
    if (!allPublic) {
      return { ok: false, error: REMOTE_FACE_ERROR };
    }
  } catch {
    return { ok: false, error: REMOTE_FACE_ERROR };
  }
  return { ok: true };
}

export async function downloadPublicImage(
  url: string,
  deps: RemoteFaceFetchDeps = {},
): Promise<{ bytes: Uint8Array; mime: string; extension: string } | { error: string }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const lookupImpl: DnsLookupAll =
    deps.lookupImpl ?? ((hostname) => lookup(hostname, { all: true }));
  const safety = await assertPublicHttpUrl(url, lookupImpl);
  if (!safety.ok) return { error: safety.error };

  let response: Response;
  try {
    response = await fetchImpl(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(REMOTE_FACE_TIMEOUT_MS),
    });
  } catch {
    return { error: REMOTE_FACE_ERROR };
  }
  if (!response.ok) {
    return { error: REMOTE_FACE_ERROR };
  }
  let buffer: Buffer;
  try {
    buffer = Buffer.from(await response.arrayBuffer());
  } catch {
    return { error: REMOTE_FACE_ERROR };
  }
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
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
): Promise<string | null> {
  const path = personaAssetPath(userId, personaId, `photo.${extension}`);
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, bytes, {
    contentType: mime,
  });
  if (error) {
    logger.error('[persona-remote-face] storage upload failed', error, { path });
    return null;
  }
  return path;
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

export async function ingestRemotePersonaFaces(
  supabase: SupabaseClient,
  deps: RemoteFaceFetchDeps = {},
): Promise<IngestRemoteFacesResult> {
  const { data, error } = await supabase
    .from('personas')
    .select('id, user_id, avatar_url, photo_path');
  if (error || !data) {
    logger.error('[persona-remote-face] list personas failed', error);
    throw new Error('Failed to list personas for remote-face ingest.');
  }
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of data as RemoteFaceRow[]) {
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
      logger.error('[persona-remote-face] update failed', updateError, { personaId: row.id });
      failed += 1;
      continue;
    }
    migrated += 1;
  }
  return { migrated, skipped, failed };
}
