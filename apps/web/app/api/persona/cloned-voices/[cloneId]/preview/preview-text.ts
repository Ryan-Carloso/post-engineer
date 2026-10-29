//---------------
// Preview text parsing — the optional JSON body of the cloned-voice
// preview route: `{ "text": "..." }`. The cap is one constant per app with
// the same literal (engine app/services/cloned_voices/preview_text.py, MCP
// src/limits.ts), pinned by apps/mcp/src/__tests__/clone-preview-text-sync.test.ts.
// Error messages carry only the bound, never the submitted text.
//---------------

export const CLONE_PREVIEW_TEXT_MAX_CHARS = 300;

export const PREVIEW_TEXT_INVALID_MESSAGE = `Preview text must be 1 to ${CLONE_PREVIEW_TEXT_MAX_CHARS} characters after trimming.`;

export type PreviewTextParse =
  | { ok: true; text: string | null }
  | { ok: false; error: string };

export function parsePreviewTextBody(rawBody: string): PreviewTextParse {
  if (rawBody.trim() === '') {
    return { ok: true, text: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: 'Invalid JSON body.' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'Body must be a JSON object.' };
  }
  const keys = Object.keys(parsed);
  if (keys.some((key) => key !== 'text')) {
    return { ok: false, error: 'Only "text" is allowed in the body.' };
  }
  if (!('text' in parsed)) {
    return { ok: true, text: null };
  }
  const value: unknown = parsed.text;
  if (typeof value !== 'string') {
    return { ok: false, error: PREVIEW_TEXT_INVALID_MESSAGE };
  }
  const text = value.trim();
  if (text.length === 0 || text.length > CLONE_PREVIEW_TEXT_MAX_CHARS) {
    return { ok: false, error: PREVIEW_TEXT_INVALID_MESSAGE };
  }
  return { ok: true, text };
}
