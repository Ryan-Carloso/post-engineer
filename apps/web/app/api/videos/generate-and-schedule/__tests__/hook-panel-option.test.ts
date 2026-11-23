import { describe, it, expect } from 'vitest';

import { HOOK_PANEL_ONLY_HOOK_LIPSYNC_MESSAGE, validateOptions } from '../options-validation';
import { resolvePostWithoutPersona } from '../persona-prep';

describe('validateOptions options.hookPanel', () => {
  it.each([true, false])('passes hookPanel=%s through for hook_lipsync', (hookPanel) => {
    const checked = validateOptions({ videoType: 'hook_lipsync', hookPanel });
    expect(checked).toEqual({ ok: true, value: expect.objectContaining({ hookPanel }) });
  });

  it('leaves hookPanel undefined when omitted, so the persona default applies', () => {
    const checked = validateOptions({ videoType: 'hook_lipsync' });
    expect(checked.ok && checked.value.hookPanel).toBeUndefined();
  });

  it.each(['full_lipsync', 'voiceover'])('rejects hookPanel on %s with a 400 issue naming the field', (videoType) => {
    const photos = videoType === 'full_lipsync' ? { lipsyncPhotos: [{ url: 'https://e.com/a.jpg' }, { url: 'https://e.com/b.jpg' }] } : {};
    expect(validateOptions({ videoType, hookPanel: false, ...photos })).toEqual({
      ok: false,
      issues: [expect.objectContaining({ message: HOOK_PANEL_ONLY_HOOK_LIPSYNC_MESSAGE, field: 'options.hookPanel' })],
    });
  });

  it('passes the per-video videoLayout through instead of dropping it', () => {
    const checked = validateOptions({ videoType: 'hook_lipsync', videoLayout: 'react' });
    expect(checked.ok && checked.value.videoLayout).toBe('react');
  });
});

describe('resolvePostWithoutPersona hookPanel', () => {
  it('keeps the panel by default and honours an explicit choice', () => {
    expect(resolvePostWithoutPersona({}).hookPanel).toBe(true);
    expect(resolvePostWithoutPersona({ hookPanel: false }).hookPanel).toBe(false);
  });
});
