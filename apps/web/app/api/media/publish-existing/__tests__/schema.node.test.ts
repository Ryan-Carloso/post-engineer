import { describe, it, expect } from 'vitest';

import {
  IMAGE_MAX_BYTES,
  imageProvidersIssue,
  checkPublishExistingSemantics,
  decodeImageMedia,
  parsePublishExistingBody,
} from '../schema';

const ASAP_BODY = {
  media: { kind: 'upload', uploadId: '22222222-2222-4222-8222-222222222222' },
  title: 'A walk in Porto',
  description: 'Walking the riverside at sunset.',
  publishing: {
    mode: 'asap',
    providers: ['youtube'],
    accounts: { youtube: ['UC1'] },
  },
  tags: ['porto'],
  privacyStatus: 'public',
};

const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
]);
const JPEG_BASE64 = JPEG_BYTES.toString('base64');

function scheduledBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    media: { kind: 'upload', uploadId: '22222222-2222-4222-8222-222222222222' },
    title: 'Ready video',
    description: 'Edited outside, scheduled here.',
    publishing: {
      mode: 'scheduled',
      providers: ['youtube'],
      accounts: { youtube: ['UC1'] },
      schedule: { publishAt: '2026-11-20T18:00:00Z', timezone: 'UTC' },
    },
    tags: ['ready'],
    privacyStatus: 'public',
    ...overrides,
  };
}

describe('parsePublishExistingBody', () => {
  it('parses an upload ASAP body', () => {
    const parsed = parsePublishExistingBody(ASAP_BODY);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.media).toEqual({ kind: 'upload', uploadId: '22222222-2222-4222-8222-222222222222' });
      expect(parsed.value.publishing.mode).toBe('asap');
    }
  });

  it('parses an upload scheduled body', () => {
    const parsed = parsePublishExistingBody(scheduledBody());
    expect(parsed.ok).toBe(true);
  });

  it('requires publishing.mode: a publish call never defaults to now or to later', () => {
    const { mode: _mode, ...publishing } = ASAP_BODY.publishing;
    const parsed = parsePublishExistingBody({ ...ASAP_BODY, publishing });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues[0]?.field).toBe('publishing.mode');
  });

  it('rejects a schedule with daily times: one post is one instant', () => {
    const parsed = parsePublishExistingBody(
      scheduledBody({
        publishing: {
          mode: 'scheduled',
          providers: ['youtube'],
          accounts: { youtube: ['UC1'] },
          schedule: { publishAt: '2026-11-20T18:00:00Z', times: ['18:00', '20:00'], timezone: 'UTC' },
        },
      }),
    );
    expect(parsed.ok).toBe(false);
  });

  it('rejects an unknown media kind', () => {
    const parsed = parsePublishExistingBody({
      ...ASAP_BODY,
      media: { kind: 'carrier-pigeon', taskId: 'x' },
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues[0]?.field).toBe('media.kind');
  });

  it('rejects a non-UUID upload id', () => {
    const parsed = parsePublishExistingBody(scheduledBody({ media: { kind: 'upload', uploadId: 'not-a-uuid' } }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues[0]?.field).toBe('media.uploadId');
  });

  it('rejects a missing title', () => {
    const parsed = parsePublishExistingBody({ ...ASAP_BODY, title: undefined });
    expect(parsed.ok).toBe(false);
  });
});

describe('checkPublishExistingSemantics', () => {
  it('accepts a valid upload ASAP body', () => {
    const parsed = parsePublishExistingBody(ASAP_BODY);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(checkPublishExistingSemantics(parsed.value).ok).toBe(true);
  });

  it('rejects a blank title at semantics and an over-long title at parse', () => {
    const blank = parsePublishExistingBody({ ...ASAP_BODY, title: '' });
    expect(blank.ok).toBe(true);
    if (blank.ok) {
      const checked = checkPublishExistingSemantics(blank.value);
      expect(checked.ok).toBe(false);
      if (!checked.ok) expect(checked.issues[0]?.field).toBe('title');
    }
    const long = parsePublishExistingBody({ ...ASAP_BODY, title: 'x'.repeat(101) });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.issues[0]?.field).toBe('title');
  });

  it('rejects a blank description at semantics and an over-long description at parse', () => {
    const blank = parsePublishExistingBody({ ...ASAP_BODY, description: '   ' });
    expect(blank.ok).toBe(true);
    if (blank.ok) {
      const checked = checkPublishExistingSemantics(blank.value);
      expect(checked.ok).toBe(false);
      if (!checked.ok) expect(checked.issues[0]?.field).toBe('description');
    }
    const long = parsePublishExistingBody({ ...ASAP_BODY, description: 'x'.repeat(5001) });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.issues[0]?.field).toBe('description');
  });

  it('rejects an unknown provider', () => {
    const parsed = parsePublishExistingBody({
      ...ASAP_BODY,
      publishing: { ...ASAP_BODY.publishing, providers: ['myspace'] },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const checked = checkPublishExistingSemantics(parsed.value);
      expect(checked.ok).toBe(false);
      if (!checked.ok) expect(checked.issues[0]?.field).toBe('publishing.providers');
    }
  });

  it('rejects ASAP with a schedule and scheduled without one', () => {
    const asapWithSchedule = parsePublishExistingBody({
      ...ASAP_BODY,
      publishing: {
        ...ASAP_BODY.publishing,
        schedule: { publishAt: '2026-11-20T18:00:00Z', timezone: 'UTC' },
      },
    });
    expect(asapWithSchedule.ok).toBe(true);
    if (asapWithSchedule.ok) expect(checkPublishExistingSemantics(asapWithSchedule.value).ok).toBe(false);

    const scheduledWithout = parsePublishExistingBody(scheduledBody());
    expect(scheduledWithout.ok).toBe(true);
    if (scheduledWithout.ok) {
      const noSchedule = { ...scheduledWithout.value, publishing: { ...scheduledWithout.value.publishing, schedule: undefined } };
      expect(checkPublishExistingSemantics(noSchedule).ok).toBe(false);
    }
  });

  it('rejects an image for a video-only network, naming it', () => {
    const parsed = parsePublishExistingBody({
      media: { kind: 'image', imageData: JPEG_BASE64, contentType: 'image/jpeg' },
      title: 'Sunset photo',
      description: 'Edited photo, straight to the feed.',
      publishing: { mode: 'asap', providers: ['rumble'], accounts: { rumble: ['rb-1'] } },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const checked = checkPublishExistingSemantics(parsed.value);
      expect(checked.ok).toBe(false);
      if (!checked.ok) {
        expect(checked.issues[0]?.field).toBe('publishing.providers');
        expect(checked.issues[0]?.message).toBe(
          'Images can be published to instagram, bluesky, linkedin, threads, facebook, pinterest, telegram only; rumble takes video.',
        );
      }
    }
  });

  it('refuses an image for YouTube, which takes video only', () => {
    const parsed = parsePublishExistingBody({
      media: { kind: 'image', imageData: JPEG_BASE64, contentType: 'image/jpeg' },
      title: 'Sunset photo',
      description: 'Edited photo, straight to the feed.',
      publishing: { mode: 'asap', providers: ['youtube'], accounts: { youtube: ['UC1'] } },
      tags: ['sunset'],
      privacyStatus: 'public',
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const checked = checkPublishExistingSemantics(parsed.value);
      expect(checked.ok).toBe(false);
      if (!checked.ok) expect(checked.issues[0]?.message).toContain('youtube takes video');
    }
  });

  it('accepts an image for every image network at once', () => {
    const parsed = parsePublishExistingBody({
      media: { kind: 'image', imageData: JPEG_BASE64, contentType: 'image/jpeg' },
      title: 'Sunset photo',
      description: 'Edited photo, straight to the feed.',
      publishing: {
        mode: 'asap',
        providers: ['instagram', 'bluesky', 'linkedin', 'threads', 'facebook', 'pinterest'],
        accounts: { instagram: ['ig-1'], bluesky: ['did:plc:a'], linkedin: ['li-1'], threads: ['th-1'], facebook: ['fb-1'], pinterest: ['pi-1'] },
        pinterestBoardId: '123',
      },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(checkPublishExistingSemantics(parsed.value)).toMatchObject({ ok: true });
  });

  it('imageProvidersIssue names every video-only network', () => {
    expect(imageProvidersIssue(['instagram', 'rumble', '3speak'])?.message).toContain('rumble, 3speak take video');
    expect(imageProvidersIssue(['youtube'])?.message).toContain('youtube takes video');
    expect(imageProvidersIssue(['bluesky'])).toBeNull();
  });

  it('requires youtube tags and privacyStatus for ASAP, but not for scheduled', () => {
    const noTags = parsePublishExistingBody({ ...ASAP_BODY, tags: undefined, privacyStatus: undefined });
    expect(noTags.ok).toBe(true);
    if (noTags.ok) {
      const checked = checkPublishExistingSemantics(noTags.value);
      expect(checked.ok).toBe(false);
      if (!checked.ok) expect(checked.issues[0]?.field).toBe('tags');
    }
    const scheduledNoTags = parsePublishExistingBody(
      scheduledBody({ tags: undefined, privacyStatus: undefined }),
    );
    expect(scheduledNoTags.ok).toBe(true);
    if (scheduledNoTags.ok) expect(checkPublishExistingSemantics(scheduledNoTags.value).ok).toBe(true);
  });

  it('requires a pinterest board id when pinterest is targeted', () => {
    const parsed = parsePublishExistingBody({
      ...ASAP_BODY,
      publishing: { mode: 'asap', providers: ['pinterest'], accounts: { pinterest: ['pin-1'] } },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const checked = checkPublishExistingSemantics(parsed.value);
      expect(checked.ok).toBe(false);
      if (!checked.ok) expect(checked.issues[0]?.field).toBe('publishing.pinterestBoardId');
    }
  });
});

describe('decodeImageMedia', () => {
  it('decodes a JPEG whose magic bytes match the declared type', () => {
    const decoded = decodeImageMedia({ imageData: JPEG_BASE64, contentType: 'image/jpeg' });
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value.contentType).toBe('image/jpeg');
      expect(decoded.value.buffer.equals(JPEG_BYTES)).toBe(true);
    }
  });

  it('rejects bytes whose magic type differs from the declared type', () => {
    const decoded = decodeImageMedia({ imageData: JPEG_BASE64, contentType: 'image/png' });
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.issues[0]?.field).toBe('media.imageData');
  });

  it('rejects malformed base64', () => {
    const decoded = decodeImageMedia({ imageData: '!!!not-base64!!!', contentType: 'image/jpeg' });
    expect(decoded.ok).toBe(false);
  });

  it('rejects an image over the 8 MB inline limit', () => {
    const big = Buffer.alloc(IMAGE_MAX_BYTES + 1, 0xff);
    big[0] = 0xff;
    big[1] = 0xd8;
    big[2] = 0xff;
    const decoded = decodeImageMedia({ imageData: big.toString('base64'), contentType: 'image/jpeg' });
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.issues[0]?.message).toContain('8 MB');
  });
});

describe('first comment', () => {
  it('trims a first comment and passes it to the request', () => {
    const parsed = parsePublishExistingBody({ ...ASAP_BODY, firstComment: '  Link in bio  ' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const checked = checkPublishExistingSemantics(parsed.value);
    expect(checked.ok && checked.value.firstComment).toBe('Link in bio');
  });

  it.each([undefined, null, '', '   '])('treats %j as no first comment', (value) => {
    const parsed = parsePublishExistingBody({ ...ASAP_BODY, firstComment: value });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const checked = checkPublishExistingSemantics(parsed.value);
    expect(checked.ok && checked.value.firstComment).toBeNull();
  });

  it('answers 400 data for a first comment over the limit, naming the field', () => {
    const parsed = parsePublishExistingBody({ ...ASAP_BODY, firstComment: 'x'.repeat(1001) });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const checked = checkPublishExistingSemantics(parsed.value);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.issues).toEqual([expect.objectContaining({ field: 'firstComment' })]);
  });

  it('rejects a first comment that is not a string', () => {
    expect(parsePublishExistingBody({ ...ASAP_BODY, firstComment: 5 }).ok).toBe(false);
  });

  it('accepts the field even when a selected network cannot comment', () => {
    const parsed = parsePublishExistingBody({
      ...ASAP_BODY,
      publishing: { mode: 'asap', providers: ['youtube', 'pinterest'], accounts: { youtube: ['UC1'], pinterest: ['p1'] }, pinterestBoardId: 'b1' },
      firstComment: 'Link in bio',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(checkPublishExistingSemantics(parsed.value).ok).toBe(true);
  });
});
