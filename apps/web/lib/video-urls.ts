//---------------
// video-urls — maps engine file URIs to the authenticated web download
// proxy. Single source of truth shared by the video-status route and the
// persona delete-preview endpoint, so both produce identical download URLs.
//---------------

/**
 * Engine task ids are engine-generated uuid4-ish slugs. Guard interpolating
 * DB-sourced ids into engine URLs: encoding alone blocks `/` traversal, but
 * a visibly-malformed id is a caller bug worth skipping loudly, not a
 * request to send.
 */
export const SAFE_TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Rewrite engine `/api/v1/download|stream/...` URIs (relative or absolute
 * on the engine origin) to `/api/persona/video-download/:taskId/...`.
 * Absolute URLs from any other origin are nulled — the proxy must never
 * fetch third-party hosts. Non-URL values pass through untouched.
 */
export function rewriteVideoUrls(body: unknown, taskId: string, baseUrl: string): unknown {
  if (typeof body === 'string') {
    let candidate = body;
    let internalAbsolute = false;
    try {
      const absolute = new URL(body);
      if (absolute.origin === new URL(baseUrl).origin) {
        candidate = `${absolute.pathname}${absolute.search}`;
        internalAbsolute = true;
      }
    } catch {
      // Non-URL strings are ordinary status data.
    }
    const relative = candidate.match(/^\/api\/v1\/(download|stream)\/([^?]+)(\?.*)?$/);
    if (relative) {
      const path = relative[2].split('/');
      if (path[0] === taskId) path.shift();
      if (path.length === 0) return body;
      return `/api/persona/video-download/${encodeURIComponent(taskId)}/${path.map(encodeURIComponent).join('/')}${relative[1] === 'stream' ? '?source=stream' : ''}`;
    }
    return internalAbsolute ? null : body;
  }
  if (Array.isArray(body)) return body.map((item) => rewriteVideoUrls(item, taskId, baseUrl));
  if (typeof body !== 'object' || body === null) return body;
  return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, rewriteVideoUrls(value, taskId, baseUrl)]));
}

/**
 * Best-effort extraction of the first downloadable video URL from a
 * rewritten engine task body. Returns null when the body carries no
 * downloadable file (task gone, failed, or engine unreachable) — callers
 * must render "download unavailable", never a broken link.
 */
export function firstDownloadUrl(rewrittenBody: unknown): string | null {
  const found: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.startsWith('/api/persona/video-download/') && !value.includes('?source=stream')) {
        // Validate every segment: a pre-formed string from the engine body
        // must not smuggle an arbitrary same-origin path into the href.
        const segments = value.slice('/api/persona/video-download/'.length).split('/');
        if (segments.length > 0 && segments.every((s) => s.length > 0 && SAFE_TASK_ID.test(s))) {
          found.push(value);
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === 'object' && value !== null) {
      for (const v of Object.values(value)) visit(v);
    }
  };
  visit(rewrittenBody);
  return found.length > 0 ? found[0] : null;
}
