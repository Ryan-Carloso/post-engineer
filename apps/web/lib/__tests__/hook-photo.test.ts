import { describe, expect, it } from 'vitest';

import { firstSegmentMedia, hookPhotoForSegments, narrowHookPhoto } from '../hook-photo';

describe('firstSegmentMedia', () => {
  it('returns the first photo of the first segment with media', () => {
    expect(
      firstSegmentMedia([
        { kind: 'hook', text: 'Welcome.', media: [{ url: 'https://e.com/hook.jpg' }] },
        { kind: 'content', text: 'More.', media: [{ url: 'https://e.com/body.jpg' }] },
      ]),
    ).toEqual({ segmentIndex: 0, imageIndex: 0, mediaId: undefined, url: 'https://e.com/hook.jpg' });
  });

  it('skips text-only segments and empty media items', () => {
    expect(
      firstSegmentMedia([
        { kind: 'hook', text: 'Welcome.' },
        { kind: 'content', text: 'More.', media: [{}, { mediaId: '' }, { mediaId: 'aabbcc.jpg' }] },
      ]),
    ).toEqual({ segmentIndex: 1, imageIndex: 2, mediaId: 'aabbcc.jpg', url: undefined });
  });

  it('returns null for null, non-arrays and segments without media', () => {
    expect(firstSegmentMedia(null)).toBeNull();
    expect(firstSegmentMedia('segments')).toBeNull();
    expect(firstSegmentMedia([{ kind: 'hook', text: 'Welcome.' }])).toBeNull();
    expect(firstSegmentMedia([{ kind: 'hook', text: 'Welcome.', media: [] }])).toBeNull();
  });
});

describe('hookPhotoForSegments', () => {
  it('returns the URL photo when the first photo came from a URL', () => {
    expect(
      hookPhotoForSegments([
        { kind: 'hook', text: 'Welcome.', media: [{ url: 'https://e.com/hook.jpg' }] },
      ]),
    ).toEqual({
      url: 'https://e.com/hook.jpg',
      source: 'segment',
      segmentIndex: 0,
      imageIndex: 0,
    });
  });

  it('returns an upload source with no URL when the first photo is a media id', () => {
    expect(
      hookPhotoForSegments([
        { kind: 'hook', text: 'Welcome.', media: [{ mediaId: 'aabbcc.jpg' }] },
      ]),
    ).toEqual({ url: null, source: 'upload', segmentIndex: 0, imageIndex: 0 });
  });

  it('returns the persona source when no segment carries a photo', () => {
    expect(hookPhotoForSegments([{ kind: 'hook', text: 'Welcome.' }])).toEqual({
      url: null,
      source: 'persona',
      segmentIndex: null,
      imageIndex: null,
    });
  });
});

describe('narrowHookPhoto', () => {
  it('returns a valid segment photo unchanged', () => {
    expect(
      narrowHookPhoto({
        url: 'https://e.com/hook.jpg',
        source: 'segment',
        segmentIndex: 0,
        imageIndex: 0,
      }),
    ).toEqual({
      url: 'https://e.com/hook.jpg',
      source: 'segment',
      segmentIndex: 0,
      imageIndex: 0,
    });
  });

  it('returns the upload shape for a media-id first photo', () => {
    expect(
      narrowHookPhoto({ url: null, source: 'upload', segmentIndex: 1, imageIndex: 2 }),
    ).toEqual({ url: null, source: 'upload', segmentIndex: 1, imageIndex: 2 });
  });

  it('falls back to the persona source for null, non-objects and unknown sources', () => {
    const fallback = { url: null, source: 'persona', segmentIndex: null, imageIndex: null };
    expect(narrowHookPhoto(null)).toEqual(fallback);
    expect(narrowHookPhoto('segment')).toEqual(fallback);
    expect(narrowHookPhoto({ source: 'avatar' })).toEqual(fallback);
  });

  it('normalizes a non-segment source to the shape the server produces for it', () => {
    expect(
      narrowHookPhoto({
        url: 'https://e.com/hook.jpg',
        source: 'persona',
        segmentIndex: 0,
        imageIndex: 0,
      }),
    ).toEqual({ url: null, source: 'persona', segmentIndex: null, imageIndex: null });
    expect(narrowHookPhoto({ url: 42, source: 'segment', segmentIndex: '0' })).toEqual({
      url: null,
      source: 'segment',
      segmentIndex: null,
      imageIndex: null,
    });
  });
});
