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

/** Directories under public/ whose files may be stored as a persona asset path. */
const PUBLIC_ASSET_DIRS: readonly string[] = ['caracter-samples', 'voice-samples'];

/**
 * One path segment of an asset file: plain characters only, never starting
 * with a dot. That excludes `.`/`..` traversal, hidden files, backslashes,
 * percent-encoding (`%2F`, `%5C`, `%2e`), query/fragment markers, whitespace
 * and control characters.
 */
const ASSET_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/**
 * isPublicAssetPath — true when the value is a same-origin path to a file
 * this app serves from public/ (e.g. /caracter-samples/file-3.png). It is the
 * single gate for "safe to fetch against our own origin" (issue #448): every
 * form that would change the host or leave the asset directory once resolved
 * by `new URL(value, origin)` — `//host`, `/\host`, `..` segments, encoded
 * slashes — is refused. Callers holding an absolute URL pass its pathname.
 */
export function isPublicAssetPath(value: string | null | undefined): value is string {
  if (typeof value !== 'string') return false;
  const segments = value.trim().split('/');
  const [root, dir, ...rest] = segments;
  if (root !== '' || dir === undefined || !PUBLIC_ASSET_DIRS.includes(dir)) return false;
  if (rest.length === 0) return false;
  return rest.every((segment) => ASSET_SEGMENT.test(segment));
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
