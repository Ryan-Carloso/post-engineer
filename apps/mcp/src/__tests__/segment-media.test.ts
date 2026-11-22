import { describe, expect, it } from 'vitest';
import { CLIP_DENSITY_ITEMS, clipDensityMinCount, isVideoRef } from '../segment-media.js';

describe('segment-media clip helpers', () => {
  it('credits one clip as six photo slots', () => {
    expect(CLIP_DENSITY_ITEMS).toBe(6);
  });

  it('isVideoRef reads the mediaId suffix first', () => {
    expect(isVideoRef({ mediaId: 'abc123.mp4' })).toBe(true);
    expect(isVideoRef({ mediaId: 'ABC123.MP4' })).toBe(true);
    expect(isVideoRef({ mediaId: 'abc123.jpg' })).toBe(false);
    expect(isVideoRef({ mediaId: 'abc123.jpg', url: 'https://e.com/clip.mp4' })).toBe(false);
  });

  it('isVideoRef falls back to the URL path, ignoring query and fragment', () => {
    expect(isVideoRef({ url: 'https://e.com/clip.mp4' })).toBe(true);
    expect(isVideoRef({ url: 'https://e.com/clip.mp4?token=abc#t=2' })).toBe(true);
    expect(isVideoRef({ url: 'https://e.com/photo.jpg' })).toBe(false);
    expect(isVideoRef({ url: 'https://e.com/clip.mp4?x=.jpg' })).toBe(true);
  });

  it('isVideoRef rejects non-media values', () => {
    expect(isVideoRef(null)).toBe(false);
    expect(isVideoRef('clip.mp4')).toBe(false);
    expect(isVideoRef([{ mediaId: 'a.mp4' }])).toBe(false);
    expect(isVideoRef({})).toBe(false);
    expect(isVideoRef({ mediaId: '' })).toBe(false);
    expect(isVideoRef({ url: '' })).toBe(false);
  });

  it('clipDensityMinCount counts photos one for one without clips', () => {
    expect(clipDensityMinCount([{ url: 'https://e.com/a.jpg' }, { url: 'https://e.com/b.jpg' }])).toBe(2);
    expect(clipDensityMinCount([])).toBe(0);
  });

  it('clipDensityMinCount credits each clip as six items', () => {
    expect(clipDensityMinCount([{ url: 'https://e.com/a.mp4' }])).toBe(6);
    expect(clipDensityMinCount([{ url: 'https://e.com/a.mp4' }, { url: 'https://e.com/b.mp4' }])).toBe(12);
    expect(clipDensityMinCount([{ url: 'https://e.com/a.mp4' }, { url: 'https://e.com/b.jpg' }])).toBe(7);
  });
});
