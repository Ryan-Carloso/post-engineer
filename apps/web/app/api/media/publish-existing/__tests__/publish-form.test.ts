// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { buildExistingMediaForm } from '../publish-form';

const BASE_FIELDS = {
  title: 'Porto walk',
  description: 'Walking the riverside at sunset.',
  caption: 'Walking the riverside at sunset.',
  tags: ['porto'],
  privacyStatus: 'public',
  boardId: '123456',
  accountIds: ['acc-1', 'acc-2'],
  aiLabel: true,
};

function formEntries(form: FormData): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of form.entries()) {
    entries.push([key, value instanceof File ? `FILE:${value.name}:${value.type}` : value]);
  }
  return entries;
}

describe('buildExistingMediaForm', () => {
  it('builds the youtube form (video + title + description + tags + privacy)', () => {
    const form = buildExistingMediaForm('youtube', BASE_FIELDS, Buffer.from([1, 2]), 'video/mp4');
    const entries = formEntries(form);
    expect(entries).toContainEqual(['provider', 'youtube']);
    expect(entries).toContainEqual(['video', 'FILE:video.mp4:video/mp4']);
    expect(entries).toContainEqual(['title', 'Porto walk']);
    expect(entries).toContainEqual(['description', 'Walking the riverside at sunset.']);
    expect(entries).toContainEqual(['tags', 'porto']);
    expect(entries).toContainEqual(['privacyStatus', 'public']);
    expect(entries).toContainEqual(['aiLabel', 'true']);
    expect(entries).toContainEqual(['accountIds', 'acc-1']);
    expect(entries).toContainEqual(['accountIds', 'acc-2']);
  });

  it('builds the instagram form (file + caption + ig ids) for a video', () => {
    const form = buildExistingMediaForm('instagram', BASE_FIELDS, Buffer.from([1, 2]), 'video/mp4');
    const entries = formEntries(form);
    expect(entries).toContainEqual(['provider', 'instagram']);
    expect(entries).toContainEqual(['file', 'FILE:video.mp4:video/mp4']);
    expect(entries).toContainEqual(['caption', 'Walking the riverside at sunset.']);
    expect(entries).toContainEqual(['aiLabel', 'true']);
    expect(entries).toContainEqual(['igAccountIds', 'acc-1']);
    expect(entries).not.toContainEqual(['video', 'FILE:video.mp4:video/mp4']);
  });

  it('builds the instagram form for an image with an image filename', () => {
    const form = buildExistingMediaForm('instagram', BASE_FIELDS, Buffer.from([0xff, 0xd8]), 'image/jpeg');
    const entries = formEntries(form);
    expect(entries).toContainEqual(['file', 'FILE:image.jpg:image/jpeg']);
    expect(entries).toContainEqual(['caption', 'Walking the riverside at sunset.']);
  });

  it('uses a .mov filename for quicktime video', () => {
    const form = buildExistingMediaForm('youtube', BASE_FIELDS, Buffer.from([1, 2]), 'video/quicktime');
    expect(formEntries(form)).toContainEqual(['video', 'FILE:video.mov:video/quicktime']);
  });

  it('builds the pinterest form (video + title + description + board)', () => {
    const form = buildExistingMediaForm('pinterest', BASE_FIELDS, Buffer.from([1, 2]), 'video/mp4');
    const entries = formEntries(form);
    expect(entries).toContainEqual(['provider', 'pinterest']);
    expect(entries).toContainEqual(['boardId', '123456']);
    expect(entries).toContainEqual(['title', 'Porto walk']);
    expect(entries).toContainEqual(['pinterestAccountIds', 'acc-1']);
    expect(entries).toContainEqual(['aiLabel', 'true']);
  });

  it('builds the threads form (video + caption + ai label)', () => {
    const form = buildExistingMediaForm('threads', BASE_FIELDS, Buffer.from([1, 2]), 'video/mp4');
    const entries = formEntries(form);
    expect(entries).toContainEqual(['provider', 'threads']);
    expect(entries).toContainEqual(['caption', 'Walking the riverside at sunset.']);
    expect(entries).toContainEqual(['aiLabel', 'true']);
    expect(entries).toContainEqual(['threadsAccountIds', 'acc-1']);
  });

  it('builds the facebook form (video + caption + ai label)', () => {
    const form = buildExistingMediaForm('facebook', BASE_FIELDS, Buffer.from([1, 2]), 'video/mp4');
    const entries = formEntries(form);
    expect(entries).toContainEqual(['provider', 'facebook']);
    expect(entries).toContainEqual(['caption', 'Walking the riverside at sunset.']);
    expect(entries).toContainEqual(['aiLabel', 'true']);
    expect(entries).toContainEqual(['facebookAccountIds', 'acc-1']);
  });

  it('builds the bluesky form (video + caption + did)', () => {
    const form = buildExistingMediaForm('bluesky', BASE_FIELDS, Buffer.from([1, 2]), 'video/mp4');
    const entries = formEntries(form);
    expect(entries).toContainEqual(['did', 'acc-1']);
    expect(entries).toContainEqual(['caption', 'Walking the riverside at sunset.']);
    expect(entries).not.toContainEqual(['aiLabel', 'true']);
  });

  it('builds the rumble form (video + title + description)', () => {
    const form = buildExistingMediaForm('rumble', BASE_FIELDS, Buffer.from([1, 2]), 'video/mp4');
    const entries = formEntries(form);
    expect(entries).toContainEqual(['title', 'Porto walk']);
    expect(entries).toContainEqual(['description', 'Walking the riverside at sunset.']);
    expect(entries).toContainEqual(['rumbleAccountIds', 'acc-1']);
  });
});
