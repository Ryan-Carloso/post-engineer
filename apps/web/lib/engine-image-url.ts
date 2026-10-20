//---------------
// ensureEngineImageUrl — make the persona image reachable by the engine.
//
// The engine downloads this image through an SSRF guard that refuses loopback
// and private addresses, and accepts only `data:image/…` or an absolute
// http(s) URL. Two shapes reach us:
//
//   * an absolute signed Supabase URL (a photo the user uploaded) — used as-is;
//   * a RELATIVE path to our own static asset (`/caracter-samples/file-1.png`,
//     what picking a house character stores) — unusable, and not fixable by
//     prefixing the origin: in local dev the web sits on 127.0.0.1, which the
//     guard blocks by design.
//
// So the relative case is read from our own origin and re-hosted in the
// personas bucket, which yields a real public URL in every environment.
//---------------

import { isIP } from 'node:net';

import { isHttpUrl, isPublicIp } from '@/lib/generation/custom-audio';

const IMAGE_BUCKET = 'personas';
const MAX_ASSET_BYTES = 5 * 1024 * 1024;

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

//---------------
// isDirectlyUsable — already something the engine can fetch itself.
//---------------
function isDirectlyUsable(url: string): boolean {
  return url.startsWith('data:image/') || /^https?:\/\//i.test(url);
}

//---------------
// isEngineUsablePersonaImageUrl — true when a stored persona image URL is
// a shape the engine can consume, mirroring the acceptance rules of
// prepare_persona_lipsync_video + ssrf.assert_public_url in the engine
// (the engine re-checks everything at download time; this pre-flight check
// exists only so a bad stored URL fails before any token charge):
// - a site path (`/caracter-samples/...`): ensureEngineImageUrl re-hosts it
//   into a public URL before the engine ever sees it;
// - a `data:image/` URI with the payload separator the engine splits on;
// - an http(s) URL with a hostname, where a literal IP host must be public
//   (hostnames are left to the engine's resolve-and-check, like the other
//   pre-flight URL checks in the generate-and-schedule route).
// Anything else (a relative non-site path, a non-http scheme, a host-less
// URL) is guaranteed to die mid-pipeline, so callers reject it up front.
//---------------
export function isEngineUsablePersonaImageUrl(value: string): boolean {
  const candidate = value.trim();
  if (candidate.startsWith('/')) return true;
  if (candidate.startsWith('data:image/')) return candidate.includes(',');
  if (!isHttpUrl(candidate)) return false;
  let hostname: string;
  try {
    hostname = new URL(candidate).hostname;
  } catch {
    return false;
  }
  if (!hostname) return false;
  const literalIp = hostname.replace(/^\[|\]$/g, '');
  if (isIP(literalIp) !== 0 && !isPublicIp(literalIp)) return false;
  return true;
}

//---------------
// objectPathFor — stable per-user path, so re-hosting the same character
// overwrites instead of accumulating copies on every video.
//---------------
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

  if (!candidate.startsWith('/')) {
    throw new Error(
      `persona image is not usable by the engine and is not a site path: ${candidate}`,
    );
  }

  const doFetch = deps.fetchImpl ?? fetch;
  const source = new URL(candidate, deps.origin).toString();
  const response = await doFetch(source);
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

  const { data, error: signError } = await client.createSignedUrl(objectPath, 3600);
  if (signError || !data?.signedUrl) {
    throw new Error(
      `could not sign the hosted persona image ${candidate}: ${signError?.message ?? 'no url returned'}`,
    );
  }
  return data.signedUrl;
}