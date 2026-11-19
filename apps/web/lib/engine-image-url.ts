import { isIP } from 'node:net';

import { SIGNED_URL_TTL_SECONDS } from '@/app/api/videos/generate-and-schedule/persona-prep';
import { isHttpUrl, isPublicIp, unbracketIpLiteral } from '@/lib/generation/custom-audio';
import { isPublicAssetPath } from '@/lib/image-source';

const IMAGE_BUCKET = 'personas';
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const ASSET_FETCH_TIMEOUT_MS = 15_000;

export interface EngineImageUrlDeps {
  supabase: {
    storage: {
      from: (bucket: string) => {
        upload: (
          path: string,
          data: ArrayBuffer,
          options: { contentType: string; upsert: boolean },
        ) => Promise<{ error: { message: string } | null }>;
        createSignedUrl: (
          path: string,
          expiresIn: number,
        ) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
      };
    };
  };
  userId: string;
  origin: string;
  fetchImpl?: typeof fetch;
}

function isDirectlyUsable(url: string): boolean {
  return url.startsWith('data:image/') || /^https?:\/\//i.test(url);
}

export function isEngineUsablePersonaImageUrl(value: string): boolean {
  const candidate = value.trim();
  if (candidate.startsWith('/')) return isPublicAssetPath(candidate);
  if (candidate.startsWith('data:image/')) return candidate.includes(',');
  if (!isHttpUrl(candidate)) return false;
  let hostname: string;
  try {
    hostname = new URL(candidate).hostname;
  } catch {
    return false;
  }
  if (!hostname) return false;
  const literalIp = unbracketIpLiteral(hostname);
  if (isIP(literalIp) !== 0 && !isPublicIp(literalIp)) return false;
  return true;
}

function objectPathFor(userId: string, relativePath: string): string {
  const cleaned = relativePath.replace(/^\/+/, '').replace(/[^a-zA-Z0-9._/-]/g, '-');
  return `${userId}/engine-images/${cleaned}`;
}

export async function ensureEngineImageUrl(
  url: string | null | undefined,
  deps: EngineImageUrlDeps,
): Promise<string | undefined> {
  const candidate = typeof url === 'string' ? url.trim() : '';
  if (candidate.length === 0) return undefined;
  if (isDirectlyUsable(candidate)) return candidate;

  if (!isPublicAssetPath(candidate)) {
    throw new Error('persona image is not usable by the engine and is not a site asset path');
  }

  const origin = new URL(deps.origin).origin;
  const resolved = new URL(candidate, origin);
  if (resolved.origin !== origin) {
    throw new Error('persona image is not usable by the engine and is not a site asset path');
  }

  const doFetch = deps.fetchImpl ?? fetch;
  const response = await doFetch(resolved.toString(), {
    redirect: 'error',
    signal: AbortSignal.timeout(ASSET_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `could not read the persona image asset ${candidate}: HTTP ${response.status}`,
    );
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ASSET_BYTES) {
    throw new Error(
      `persona image asset ${candidate} has an unusable size (${bytes.byteLength} bytes)`,
    );
  }

  const objectPath = objectPathFor(deps.userId, candidate);
  const client = deps.supabase.storage.from(IMAGE_BUCKET);
  const { error: uploadError } = await client.upload(objectPath, bytes, {
    contentType: 'image/png',
    upsert: true,
  });
  if (uploadError) {
    throw new Error(`could not host the persona image ${candidate}: ${uploadError.message}`);
  }

  const { data, error: signError } = await client.createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
  if (signError || !data?.signedUrl) {
    throw new Error(
      `could not sign the hosted persona image ${candidate}: ${signError?.message ?? 'no url returned'}`,
    );
  }
  return data.signedUrl;
}