import { describe, expect, it } from 'vitest';

import { CLONE_PREVIEW_TEXT_MAX_CHARS, PREVIEW_TEXT_INVALID_MESSAGE, parsePreviewTextBody } from '../preview-text';

describe('parsePreviewTextBody', () => {
  it('treats an empty body as no caller text', () => {
    expect(parsePreviewTextBody('')).toEqual({ ok: true, text: null });
    expect(parsePreviewTextBody('  ')).toEqual({ ok: true, text: null });
  });

  it('treats an empty object as no caller text', () => {
    expect(parsePreviewTextBody('{}')).toEqual({ ok: true, text: null });
  });

  it('returns the trimmed text', () => {
    expect(parsePreviewTextBody(JSON.stringify({ text: '  hello  ' }))).toEqual({ ok: true, text: 'hello' });
  });

  it('accepts exactly the max length', () => {
    const text = 'a'.repeat(CLONE_PREVIEW_TEXT_MAX_CHARS);
    expect(parsePreviewTextBody(JSON.stringify({ text }))).toEqual({ ok: true, text });
  });

  it('rejects one char over the max without truncating', () => {
    const text = 'a'.repeat(CLONE_PREVIEW_TEXT_MAX_CHARS + 1);
    expect(parsePreviewTextBody(JSON.stringify({ text }))).toEqual({ ok: false, error: PREVIEW_TEXT_INVALID_MESSAGE });
  });

  it('measures the trimmed length', () => {
    const text = `  ${'b'.repeat(CLONE_PREVIEW_TEXT_MAX_CHARS)}  `;
    expect(parsePreviewTextBody(JSON.stringify({ text }))).toEqual({ ok: true, text: 'b'.repeat(300) });
  });

  it('rejects text that is empty after trimming', () => {
    expect(parsePreviewTextBody(JSON.stringify({ text: '   ' }))).toEqual({ ok: false, error: PREVIEW_TEXT_INVALID_MESSAGE });
  });

  it('rejects a non-string text', () => {
    expect(parsePreviewTextBody(JSON.stringify({ text: 123 }))).toEqual({ ok: false, error: PREVIEW_TEXT_INVALID_MESSAGE });
    expect(parsePreviewTextBody(JSON.stringify({ text: null }))).toEqual({ ok: false, error: PREVIEW_TEXT_INVALID_MESSAGE });
  });

  it('rejects invalid JSON, non-objects and unknown keys', () => {
    expect(parsePreviewTextBody('not-json{')).toEqual({ ok: false, error: 'Invalid JSON body.' });
    expect(parsePreviewTextBody('[]')).toEqual({ ok: false, error: 'Body must be a JSON object.' });
    expect(parsePreviewTextBody('"hi"')).toEqual({ ok: false, error: 'Body must be a JSON object.' });
    expect(parsePreviewTextBody(JSON.stringify({ text: 'hi', voice: 'x' }))).toEqual({
      ok: false,
      error: 'Only "text" is allowed in the body.',
    });
  });

  it('never echoes the submitted text in the error', () => {
    const secretish = `${'z'.repeat(CLONE_PREVIEW_TEXT_MAX_CHARS)}SENTINEL`;
    const result = parsePreviewTextBody(JSON.stringify({ text: secretish }));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result).includes('SENTINEL')).toBe(false);
  });
});
