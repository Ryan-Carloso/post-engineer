export const SAFE_TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

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

export function firstDownloadUrl(rewrittenBody: unknown): string | null {
  const found: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.startsWith('/api/persona/video-download/') && !value.includes('?source=stream')) {
        const segments = value.slice('/api/persona/video-download/'.length).split('/');
        const valid = segments.length > 0 && segments.every((s) => {
          if (s.length === 0) return false;
          try {
            return SAFE_TASK_ID.test(decodeURIComponent(s));
          } catch {
            return false;
          }
        });
        if (valid) {
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
