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
    ).toEqual({ title: 'T', description: 'D', tags: ['tech'], privacyStatus: 'public', caption: '', boardId: '' });
    expect(
      requireDirectPublishFields({
        provider: 'rumble',
        videoPath: 'clip.mp4',
        accountIds: ['chan-1'],
        title: 'T',
        description: 'D',
      }),
    ).toEqual({ title: 'T', description: 'D', tags: [], privacyStatus: '', caption: '', boardId: '' });
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
    ).toEqual({ title: '', description: '', tags: [], privacyStatus: '', caption: 'hi', boardId: '' });
  });

  it('requires a boardId for pinterest and falls back from description to caption', () => {
    const base = { provider: 'pinterest' as const, videoPath: 'clip.mp4', accountIds: ['user-9'] };
    expect(() => requireDirectPublishFields({ ...base, caption: 'c' })).toThrow(/boardId is required for pinterest/);
    expect(() => requireDirectPublishFields({ ...base, boardId: 'b1' })).toThrow(
      /description or caption is required for pinterest/,
    );
    expect(requireDirectPublishFields({ ...base, boardId: 'b1', caption: 'pin text' })).toEqual({
      title: '',
      description: 'pin text',
      tags: [],
      privacyStatus: '',
      caption: 'pin text',
      boardId: 'b1',
    });
    expect(
      requireDirectPublishFields({ ...base, boardId: 'b1', title: 'T', description: 'explicit', caption: 'c' }),
    ).toEqual({ title: 'T', description: 'explicit', tags: [], privacyStatus: '', caption: 'c', boardId: 'b1' });
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

  it('sends title, description and boardId to pinterestAccountIds for pinterest', () => {
    const fields = requireDirectPublishFields({
      provider: 'pinterest',
      videoPath: 'clip.mp4',
      accountIds: ['user-9'],
      caption: 'pin text',
      boardId: 'b1',
    });
    const form = buildDirectPublishForm(
      { provider: 'pinterest', videoPath: 'clip.mp4', accountIds: ['user-9'], caption: 'pin text', boardId: 'b1' },
      fields,
      video,
      'clip.mp4',
    );
    expect(form.get('provider')).toBe('pinterest');
    expect(form.getAll('pinterestAccountIds')).toEqual(['user-9']);
    expect(form.get('caption')).toBe('pin text');
    expect(form.get('description')).toBe('pin text');
    expect(form.get('boardId')).toBe('b1');
    expect(form.get('video')).toBeInstanceOf(Blob);
  });

  it('sends the caption to fanvueAccountIds for fanvue', () => {
    expect(() =>
      requireDirectPublishFields({ provider: 'fanvue', videoPath: 'clip.mp4', accountIds: ['fan-1'] }),
    ).toThrow(/caption is required for fanvue/);
    const fields = requireDirectPublishFields({
      provider: 'fanvue',
      videoPath: 'clip.mp4',
      accountIds: ['fan-1'],
      caption: ' hello fanvue ',
    });
    const form = buildDirectPublishForm(
      { provider: 'fanvue', videoPath: 'clip.mp4', accountIds: ['fan-1'], caption: 'hello fanvue' },
      fields,
      video,
      'clip.mp4',
    );
    expect(form.get('provider')).toBe('fanvue');
    expect(form.getAll('fanvueAccountIds')).toEqual(['fan-1']);
    expect(form.get('caption')).toBe('hello fanvue');
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
