import { describe, it, expect } from 'vitest';
import { buildDirectPublishForm, requireDirectPublishFields } from '../direct-publish-form.js';

const video = new Blob(['bytes'], { type: 'video/mp4' });

describe('requireDirectPublishFields', () => {
  it('requires title + description for youtube and rumble, tags + privacyStatus only for youtube', () => {
    expect(
      requireDirectPublishFields({
        provider: 'youtube',
        videoPath: 'clip.mp4',
        accountIds: ['chan-1'],
        title: 'T',
        description: 'D',
        tags: ['tech'],
        privacyStatus: 'public',
      }),
    ).toEqual({ title: 'T', description: 'D', tags: ['tech'], privacyStatus: 'public', caption: '' });
    expect(
      requireDirectPublishFields({
        provider: 'rumble',
        videoPath: 'clip.mp4',
        accountIds: ['chan-1'],
        title: 'T',
        description: 'D',
      }),
    ).toEqual({ title: 'T', description: 'D', tags: [], privacyStatus: '', caption: '' });
    expect(() =>
      requireDirectPublishFields({ provider: 'youtube', videoPath: 'clip.mp4', accountIds: ['c'], title: 'T', description: 'D' }),
    ).toThrow(/tags is required for youtube/);
  });

  it('fails fast when the rumble title or description is missing or blank', () => {
    const base = { provider: 'rumble' as const, videoPath: 'clip.mp4', accountIds: ['chan-1'] };
    expect(() => requireDirectPublishFields({ ...base, description: 'D' })).toThrow(/title is required for rumble/);
    expect(() => requireDirectPublishFields({ ...base, title: '   ', description: 'D' })).toThrow(/title is required for rumble/);
    expect(() => requireDirectPublishFields({ ...base, title: 'T' })).toThrow(/description is required for rumble/);
    expect(() => requireDirectPublishFields({ ...base, title: 'T', description: '   ' })).toThrow(
      /description is required for rumble/,
    );
  });

  it('requires a caption for the caption providers', () => {
    expect(() =>
      requireDirectPublishFields({ provider: 'facebook', videoPath: 'clip.mp4', accountIds: ['p'] }),
    ).toThrow(/caption is required for facebook/);
    expect(
      requireDirectPublishFields({ provider: 'facebook', videoPath: 'clip.mp4', accountIds: ['p'], caption: ' hi ' }),
    ).toEqual({ title: '', description: '', tags: [], privacyStatus: '', caption: 'hi' });
  });
});

describe('buildDirectPublishForm', () => {
  it('sends title + description (no caption) to rumbleAccountIds for rumble', () => {
    const fields = requireDirectPublishFields({
      provider: 'rumble',
      videoPath: 'clip.mp4',
      accountIds: ['chan-1', 'chan-2'],
      title: 'T',
      description: 'D',
    });
    const form = buildDirectPublishForm(
      { provider: 'rumble', videoPath: 'clip.mp4', accountIds: ['chan-1', 'chan-2'], title: 'T', description: 'D' },
      fields,
      video,
      'clip.mp4',
    );
    expect(form.get('provider')).toBe('rumble');
    expect(form.getAll('rumbleAccountIds')).toEqual(['chan-1', 'chan-2']);
    expect(form.get('title')).toBe('T');
    expect(form.get('description')).toBe('D');
    expect(form.get('caption')).toBeNull();
    expect(form.get('video')).toBeInstanceOf(Blob);
  });

  it('keeps the youtube tags/privacyStatus shape and the instagram file + caption shape', () => {
    const ytFields = requireDirectPublishFields({
      provider: 'youtube',
      videoPath: 'clip.mp4',
      accountIds: ['c'],
      title: 'T',
      description: 'D',
      tags: ['a', 'b'],
      privacyStatus: 'public',
    });
    const yt = buildDirectPublishForm(
      { provider: 'youtube', videoPath: 'clip.mp4', accountIds: ['c'], title: 'T', description: 'D', tags: ['a', 'b'], privacyStatus: 'public' },
      ytFields,
      video,
      'clip.mp4',
    );
    expect(yt.get('tags')).toBe('a,b');
    expect(yt.get('privacyStatus')).toBe('public');
    expect(yt.getAll('accountIds')).toEqual(['c']);

    const igFields = requireDirectPublishFields({
      provider: 'instagram',
      videoPath: 'clip.mp4',
      accountIds: ['ig-1'],
      caption: 'hi',
    });
    const ig = buildDirectPublishForm(
      { provider: 'instagram', videoPath: 'clip.mp4', accountIds: ['ig-1'], caption: 'hi' },
      igFields,
      video,
      'clip.mp4',
    );
    expect(ig.get('file')).toBeInstanceOf(Blob);
    expect(ig.get('caption')).toBe('hi');
    expect(ig.getAll('igAccountIds')).toEqual(['ig-1']);
  });
});
