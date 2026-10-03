//---------------
// image-source — diagnostics helper for persona avatar/photo URLs.
//
// Why it exists: a persona can have its face in three different places
// (avatar_url from the AI generator, a signed Supabase storage URL, or a
// path under public/caracter-samples) and every one of them fails silently
// in the UI — the <img> just renders the initials fallback. Logging the raw
// value would leak the Supabase signed-URL token (it lives in the query
// string) and any userinfo, so logs get the shape only: origin + pathname,
// no query, no fragment, no credentials, length-capped.
//---------------

/** Longest source we ever print; anything longer is an opaque blob anyway. */
const MAX_SOURCE_CHARS = 120;

/**
 * describeImageSource — loggable, non-secret form of an image URL.
 * - null/undefined/empty -> null (the caller can then say "no source at all").
 * - relative path -> the path itself (public/ assets are not secret).
 * - absolute URL -> `origin + pathname`, query/hash/credentials dropped.
 * - unparseable -> a short marker, never the raw string.
 */
export function describeImageSource(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.startsWith('/')) {
    return cap(trimmed.split('#')[0] ?? trimmed);
  }

  try {
    const url = new URL(trimmed);
    // origin + pathname: username/password are dropped by `origin`, and the
    // query (where Supabase puts the signature token) is never read.
    const origin = `${url.protocol}//${url.host}`;
    return cap(`${origin}${url.pathname}`);
  } catch {
    // Not a URL and not a path (a bare token, a data: blob): the marker says
    // "there was something, it is unusable" without printing it.
    return `<unparseable:${trimmed.length}chars>`;
  }
}

/**
 * isPublicAssetPath — true when the value points at a file this app serves
 * from public/ (e.g. /caracter-samples/file-3.png), including an absolute URL
 * on any host that ends with that path. Used to normalize stored absolute
 * URLs back to same-origin so local dev does not depend on production.
 */
export function isPublicAssetPath(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\/(caracter-samples|voice-samples)\//.test(value.trim());
}

/**
 * toSameOriginAssetPath — strips an absolute origin from one of our own
 * public asset paths, leaving the path. Third-party URLs are returned
 * untouched: they are genuinely remote and rewriting them would break them.
 */
export function toSameOriginAssetPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!trimmed.startsWith('/')) {
    try {
      const url = new URL(trimmed);
      if (!isPublicAssetPath(url.pathname)) return trimmed;
      return url.pathname;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function cap(value: string): string {
  return value.length > MAX_SOURCE_CHARS ? `${value.slice(0, MAX_SOURCE_CHARS)}…` : value;
}
