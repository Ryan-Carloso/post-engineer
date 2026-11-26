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
  it('narrows media alongside the other slot leaves', () => {
    const fields = narrowSlotFields({
      media: { kind: 'upload', url: 'https://s.test/v.mp4', contentType: 'video/mp4' },
      publishLinks: 'bad',
      progressHistory: null,
      scriptAngle: 7,
    });
    expect(fields.media).toEqual({ kind: 'upload', url: 'https://s.test/v.mp4', contentType: 'video/mp4' });
    expect(fields.publishLinks).toEqual([]);
    expect(fields.progressHistory).toEqual([]);
    expect(fields.scriptAngle).toBeNull();
  });

  it('defaults media to null when the route omits it', () => {
    expect(narrowSlotFields({}).media).toBeNull();
  });
});
