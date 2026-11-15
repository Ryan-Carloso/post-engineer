import 'server-only';

import { AwsClient } from 'aws4fetch';
import { logger } from '@/lib/logger';

//---------------
// Publish media on Cloudflare R2.
//
// Instagram, Threads and Facebook do not take the file in the request: they
// fetch it from a URL. The handlers store the file here and pass a presigned
// GET URL. R2 has no egress fees, so the provider's download costs nothing.
// The file used to live in the Supabase `uploads` bucket, and every provider
// fetch (about 40 MB per video, repeated on each retry) counted against the
// Supabase egress quota.
//
// Objects live in the engine's private R2 bucket under PUBLISH_MEDIA_PREFIX.
// The engine never writes under that prefix, and the cleanup deletes only
// keys with the exact shape this module writes.
//
// Engine-generated finals already live in the same bucket at
// `{userId}/{persona|faceless}/{taskId}/final-1.mp4` (see
// apps/engine/app/services/video_storage.py:storage_object_path). When the
// caller names that key via `videoStoragePath`, the handlers presign it
// directly (presignPublishMedia) instead of uploading a publish-media copy:
// no duplicate bytes, no 24h cleanup for that publish. A file upload still
// gets a publish-media copy, because UI/MCP videos start outside R2.
//---------------

// Same literal as the engine's STORAGE_BUCKET (apps/engine/app/services/video_storage.py),
// pinned by publish-media.test.ts.
export const PUBLISH_MEDIA_BUCKET = 'videos';
export const PUBLISH_MEDIA_PREFIX = 'publish-media';
// The provider fetches the file within minutes; one hour covers slow processing.
export const PUBLISH_MEDIA_URL_TTL_SECONDS = 3600;
// Objects older than this are deleted by the cleanup that runs after each publish.
export const PUBLISH_MEDIA_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const PUT_TIMEOUT_MS = 120_000;
const LIST_DELETE_TIMEOUT_MS = 15_000;

// `<provider>/<epoch ms>_<8 hex>.<ext>`: the shape every handler builds.
const MEDIA_PATH = /^[a-z]+\/\d+_[0-9a-f]{8}\.[a-z0-9]+$/;
// Engine archive shape: {userId}/{persona|faceless}/{taskId}/final-1.mp4.
// Exactly four segments so an arbitrary R2 key can never be presigned; the
// `publish-media/` temp prefix is deliberately excluded.
const ARCHIVE_PATH = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/final-1\.mp4$/;
const PROVIDER = /^[a-z]+$/;
const CONTENTS_BLOCK = /<Contents>([\s\S]*?)<\/Contents>/g;
const KEY_TAG = /<Key>([^<]*)<\/Key>/;
const LAST_MODIFIED_TAG = /<LastModified>([^<]*)<\/LastModified>/;

export interface PublishMediaDeps {
  fetch: typeof fetch;
  now: () => number;
}

const defaultDeps: PublishMediaDeps = { fetch: (input, init) => fetch(input, init), now: () => Date.now() };

interface R2Config {
  client: AwsClient;
  bucketUrl: string;
}

const R2_ENV = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const;

/** The same R2 credentials the engine uses. No fallback: a missing one fails loudly. */
function r2Config(): R2Config {
  const values = new Map<string, string>();
  const missing: string[] = [];
  for (const name of R2_ENV) {
    const value = process.env[name]?.trim();
    if (value === undefined || value === '') missing.push(name);
    else values.set(name, value);
  }
  const accountId = values.get('R2_ACCOUNT_ID');
  const accessKeyId = values.get('R2_ACCESS_KEY_ID');
  const secretAccessKey = values.get('R2_SECRET_ACCESS_KEY');
  if (accountId === undefined || accessKeyId === undefined || secretAccessKey === undefined) {
    throw new Error(`R2 publish media storage is not configured; missing ${missing.join(', ')}`);
  }
  return {
    // R2 ignores the region, but SigV4 needs one; "auto" is the documented value.
    client: new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto', retries: 0 }),
    bucketUrl: `https://${accountId}.r2.cloudflarestorage.com/${PUBLISH_MEDIA_BUCKET}`,
  };
}

function objectUrl(bucketUrl: string, key: string): string {
  return `${bucketUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** Store the media on R2 and return a presigned GET URL for the provider. */
export async function uploadPublishMedia(
  buffer: Buffer,
  path: string,
  contentType: string,
  deps: PublishMediaDeps = defaultDeps,
): Promise<string> {
  if (!MEDIA_PATH.test(path)) {
    throw new Error(`Invalid publish media path: ${path}`);
  }
  const { client, bucketUrl } = r2Config();
  const url = objectUrl(bucketUrl, `${PUBLISH_MEDIA_PREFIX}/${path}`);

  const put = await client.sign(url, {
    method: 'PUT',
    body: new Uint8Array(buffer),
    headers: { 'Content-Type': contentType },
  });
  const response = await deps.fetch(put, { signal: AbortSignal.timeout(PUT_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Failed to upload media to R2: HTTP ${response.status}`);
  }

  const get = await client.sign(`${url}?X-Amz-Expires=${PUBLISH_MEDIA_URL_TTL_SECONDS}`, {
    method: 'GET',
    aws: { signQuery: true },
  });
  return get.url;
}

/**
 * Presign an engine-archived final video without copying it.
 *
 * The object is already durable in R2 (verified at generation time), so
 * this only signs: no PUT, no publish-media copy, no cleanup delete. The
 * caller must prove ownership (the key starts with the caller's userId);
 * this function only proves the key has the exact archive shape.
 */
export async function presignPublishMedia(objectKey: string): Promise<string> {
  if (!ARCHIVE_PATH.test(objectKey)) {
    throw new Error(`Invalid video storage path: ${objectKey}`);
  }
  const { client, bucketUrl } = r2Config();
  const url = objectUrl(bucketUrl, objectKey);
  const get = await client.sign(`${url}?X-Amz-Expires=${PUBLISH_MEDIA_URL_TTL_SECONDS}`, {
    method: 'GET',
    aws: { signQuery: true },
  });
  return get.url;
}

interface ListedObject {
  key: string;
  lastModified: number;
}

function parseListing(xml: string): ListedObject[] {
  const objects: ListedObject[] = [];
  for (const block of xml.matchAll(CONTENTS_BLOCK)) {
    const key = KEY_TAG.exec(block[1])?.[1];
    const lastModified = LAST_MODIFIED_TAG.exec(block[1])?.[1];
    if (key === undefined || lastModified === undefined) continue;
    objects.push({ key, lastModified: Date.parse(lastModified) });
  }
  return objects;
}

/**
 * Delete this provider's publish media older than PUBLISH_MEDIA_MAX_AGE_MS.
 * Returns how many objects were deleted. Errors are logged, never thrown:
 * a failed cleanup must not fail a publish, and the next publish retries it.
 */
export async function cleanupPublishMedia(provider: string, deps: PublishMediaDeps = defaultDeps): Promise<number> {
  try {
    if (!PROVIDER.test(provider)) {
      throw new Error(`Invalid publish media provider: ${provider}`);
    }
    const { client, bucketUrl } = r2Config();
    const prefix = `${PUBLISH_MEDIA_PREFIX}/${provider}/`;
    const list = await client.sign(
      `${bucketUrl}?list-type=2&max-keys=1000&prefix=${encodeURIComponent(prefix)}`,
      { method: 'GET' },
    );
    const listResponse = await deps.fetch(list, { signal: AbortSignal.timeout(LIST_DELETE_TIMEOUT_MS) });
    if (!listResponse.ok) {
      logger.warn('Publish media cleanup: failed to list objects', {
        metadata: { provider, status: listResponse.status },
      });
      return 0;
    }

    const cutoff = deps.now() - PUBLISH_MEDIA_MAX_AGE_MS;
    const stale = parseListing(await listResponse.text()).filter(
      (object) =>
        object.key.startsWith(prefix) &&
        MEDIA_PATH.test(object.key.slice(PUBLISH_MEDIA_PREFIX.length + 1)) &&
        !Number.isNaN(object.lastModified) &&
        object.lastModified < cutoff,
    );

    let removed = 0;
    for (const object of stale) {
      const del = await client.sign(objectUrl(bucketUrl, object.key), { method: 'DELETE' });
      const response = await deps.fetch(del, { signal: AbortSignal.timeout(LIST_DELETE_TIMEOUT_MS) });
      if (!response.ok) {
        logger.warn('Publish media cleanup: failed to delete object', {
          metadata: { provider, key: object.key, status: response.status },
        });
        continue;
      }
      removed += 1;
    }
    if (removed > 0) {
      logger.info('Publish media cleanup completed', { metadata: { provider, removed } });
    }
    return removed;
  } catch (error) {
    logger.warn('Publish media cleanup: unexpected error', {
      metadata: { provider, error: error instanceof Error ? error.message : String(error) },
    });
    return 0;
  }
}
