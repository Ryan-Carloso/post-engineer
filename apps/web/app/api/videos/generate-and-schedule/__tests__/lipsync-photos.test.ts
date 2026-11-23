import { describe, expect, it } from 'vitest';

import { MAX_LIPSYNC_PHOTOS, MIN_LIPSYNC_PHOTOS } from '@/lib/contracts/videos';
import {
  LIPSYNC_PHOTOS_ONLY_FULL_MESSAGE,
  LIPSYNC_PHOTOS_REQUIRED_MESSAGE,
  validateLipsyncPhotos,
} from '../lipsync-photos';
import { validateOptions } from '../options-validation';

const photos = (count: number) => Array.from({ length: count }, (_, i) => ({ url: `https://e.com/face-${i}.jpg` }));

describe('validateLipsyncPhotos', () => {
  it('accepts 2-5 different photos for full_lipsync and trims them', () => {
    for (let count = MIN_LIPSYNC_PHOTOS; count <= MAX_LIPSYNC_PHOTOS; count += 1) {
      expect(validateLipsyncPhotos(photos(count), 'full_lipsync')).toEqual({ ok: true, value: photos(count) });
    }
    expect(
      validateLipsyncPhotos([{ mediaId: ' aabbccddeeff00112233445566778899.jpg ' }, { url: ' https://e.com/b.jpg ' }], 'full_lipsync'),
    ).toEqual({ ok: true, value: [{ mediaId: 'aabbccddeeff00112233445566778899.jpg' }, { url: 'https://e.com/b.jpg' }] });
  });

  it('requires the photos for full_lipsync, explaining the 12s windows', () => {
    const checked = validateLipsyncPhotos(undefined, 'full_lipsync');
    expect(checked).toEqual({
      ok: false,
      issues: [expect.objectContaining({ message: LIPSYNC_PHOTOS_REQUIRED_MESSAGE, field: 'options.lipsyncPhotos' })],
    });
    expect(LIPSYNC_PHOTOS_REQUIRED_MESSAGE).toContain('one per 12s window');
  });

  it.each([0, 1, MAX_LIPSYNC_PHOTOS + 1])('rejects %i photos', (count) => {
    const checked = validateLipsyncPhotos(photos(count), 'full_lipsync');
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.issues[0]?.message).toBe(
        `options.lipsyncPhotos has ${count} photos: send 2-5 different face photos of the persona, one per 12s window.`,
      );
    }
  });

  it.each(['hook_lipsync', 'faceless'] as const)('rejects the photos on %s', (mode) => {
    expect(validateLipsyncPhotos(photos(2), mode)).toEqual({
      ok: false,
      issues: [expect.objectContaining({ message: LIPSYNC_PHOTOS_ONLY_FULL_MESSAGE, field: 'options.lipsyncPhotos' })],
    });
  });

  it('passes other modes without photos and skips an unknown mode', () => {
    expect(validateLipsyncPhotos(undefined, 'hook_lipsync')).toEqual({ ok: true, value: undefined });
    expect(validateLipsyncPhotos(photos(9), undefined)).toEqual({ ok: true, value: undefined });
  });

  it('rejects a repeated photo, naming both indexes', () => {
    const checked = validateLipsyncPhotos(
      [{ url: 'https://e.com/a.jpg' }, { url: 'https://e.com/b.jpg' }, { url: ' https://e.com/a.jpg' }],
      'full_lipsync',
    );
    expect(checked).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          message: 'options.lipsyncPhotos.2 repeats photo 0: every window needs a different photo of the persona.',
          field: 'options.lipsyncPhotos.2',
        }),
      ],
    });
  });

  it('keeps a mediaId and a url with the same text distinct', () => {
    expect(validateLipsyncPhotos([{ mediaId: 'x.jpg' }, { url: 'https://x.jpg' }], 'full_lipsync').ok).toBe(true);
  });

  it.each([
    [{}, 'options.lipsyncPhotos.0 must carry exactly one of mediaId or url.'],
    [{ mediaId: '  ' }, 'options.lipsyncPhotos.0 must carry exactly one of mediaId or url.'],
    [{ mediaId: 'a.jpg', url: 'https://e.com/a.jpg' }, 'options.lipsyncPhotos.0 must carry exactly one of mediaId or url.'],
    [{ url: 'ftp://e.com/a.jpg' }, 'options.lipsyncPhotos.0.url must be a valid http(s) URL.'],
    [{ mediaId: 'aabbccddeeff00112233445566778899.mp4' }, "options.lipsyncPhotos.0 is a video clip: full lip sync needs a still photo of the persona's face."],
    [{ url: 'https://e.com/clip.MP4?x=1' }, "options.lipsyncPhotos.0 is a video clip: full lip sync needs a still photo of the persona's face."],
    [{ mediaId: ' aabbccddeeff00112233445566778899.mp4 ' }, "options.lipsyncPhotos.0 is a video clip: full lip sync needs a still photo of the persona's face."],
    [{ url: ' https://e.com/clip.mp4 ' }, "options.lipsyncPhotos.0 is a video clip: full lip sync needs a still photo of the persona's face."],
    [{ mediaId: '  ', url: 'https://e.com/clip.mp4' }, "options.lipsyncPhotos.0 is a video clip: full lip sync needs a still photo of the persona's face."],
  ])('rejects the malformed photo %j', (photo, message) => {
    const checked = validateLipsyncPhotos([photo, { url: 'https://e.com/b.jpg' }], 'full_lipsync');
    expect(checked).toEqual({
      ok: false,
      issues: [expect.objectContaining({ message, field: 'options.lipsyncPhotos.0' })],
    });
  });
});

describe('validateOptions options.lipsyncPhotos', () => {
  it('passes the validated photos through for full_lipsync', () => {
    const checked = validateOptions({ videoType: 'full_lipsync', lipsyncPhotos: photos(3) });
    expect(checked.ok && checked.value.lipsyncPhotos).toEqual(photos(3));
  });

  it('reports a missing list next to the other option issues', () => {
    const checked = validateOptions({ videoType: 'full_lipsync', voiceId: ' ' });
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.issues.map((issue) => issue.field)).toEqual(['options.voiceId', 'options.lipsyncPhotos']);
    }
  });
});
