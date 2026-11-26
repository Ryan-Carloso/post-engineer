import { describe, expect, it } from 'vitest';
import { narrowSlotFields, narrowSlotMedia } from '../slot-detail';

describe('narrowSlotMedia', () => {
  it('keeps a well-formed upload media payload', () => {
    expect(narrowSlotMedia({ kind: 'upload', url: 'https://s.test/v.mp4', contentType: 'video/mp4' })).toEqual({
      kind: 'upload',
      url: 'https://s.test/v.mp4',
      contentType: 'video/mp4',
    });
  });

  it('nulls an empty or non-string url and content type', () => {
    expect(narrowSlotMedia({ kind: 'image', url: '', contentType: 3 })).toEqual({
      kind: 'image',
      url: null,
      contentType: null,
    });
  });

  it('drops an unknown kind or a non-object payload', () => {
    expect(narrowSlotMedia({ kind: 'audio', url: 'https://s.test/a.mp3' })).toBeNull();
    expect(narrowSlotMedia('upload')).toBeNull();
    expect(narrowSlotMedia(null)).toBeNull();
    expect(narrowSlotMedia(undefined)).toBeNull();
  });
});

describe('narrowSlotFields', () => {
  it('narrows media alongside the publish links', () => {
    const fields = narrowSlotFields({
      media: { kind: 'upload', url: 'https://s.test/v.mp4', contentType: 'video/mp4' },
      publishLinks: 'bad',
    });
    expect(fields.media).toEqual({ kind: 'upload', url: 'https://s.test/v.mp4', contentType: 'video/mp4' });
    expect(fields.publishLinks).toEqual([]);
  });

  it('defaults media to null when the route omits it', () => {
    expect(narrowSlotFields({}).media).toBeNull();
  });
});
