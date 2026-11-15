// @vitest-environment node
import { describe, it, expect } from 'vitest';

import {
  IMAGE_MAX_BYTES,
  checkPublishExistingSemantics,
  decodeImageMedia,
  parsePublishExistingBody,
} from '../schema';

const TASK_BODY = {
  media: { kind: 'task', taskId: '11111111-1111-4111-8111-111111111111' },
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

// Minimal JPEG: SOI + JFIF marker, enough for magic-byte detection.
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
      schedule: { startAt: '2026-11-20T18:00:00Z', times: ['18:00'], timezone: 'UTC' },
    },
    tags: ['ready'],
    privacyStatus: 'public',
    ...overrides,
  };
}

describe('parsePublishExistingBody', () => {
  it('parses a task ASAP body', () => {
    const parsed = parsePublishExistingBody(TASK_BODY);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.media).toEqual({ kind: 'task', taskId: '11111111-1111-4111-8111-111111111111' });
      expect(parsed.value.publishing.mode).toBe('asap');
    }
  });

  it('parses an upload scheduled body', () => {
    const parsed = parsePublishExistingBody(scheduledBody());
    expect(parsed.ok).toBe(true);
  });

  it('rejects an unknown media kind', () => {
    const parsed = parsePublishExistingBody({
      ...TASK_BODY,
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
    const parsed = parsePublishExistingBody({ ...TASK_BODY, title: undefined });
    expect(parsed.ok).toBe(false);
  });
});

describe('checkPublishExistingSemantics', () => {
  it('accepts a valid task ASAP body', () => {
    const parsed = parsePublishExistingBody(TASK_BODY);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(checkPublishExistingSemantics(parsed.value).ok).toBe(true);
  });

  it('rejects a blank title at semantics and an over-long title at parse', () => {
    const blank = parsePublishExistingBody({ ...TASK_BODY, title: '' });
    expect(blank.ok).toBe(true);
    if (blank.ok) {
      const checked = checkPublishExistingSemantics(blank.value);
      expect(checked.ok).toBe(false);
      if (!checked.ok) expect(checked.issues[0]?.field).toBe('title');
    }
    const long = parsePublishExistingBody({ ...TASK_BODY, title: 'x'.repeat(101) });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.issues[0]?.field).toBe('title');
  });

  it('rejects a blank description at semantics and an over-long description at parse', () => {
    const blank = parsePublishExistingBody({ ...TASK_BODY, description: '   ' });
    expect(blank.ok).toBe(true);
    if (blank.ok) {
      const checked = checkPublishExistingSemantics(blank.value);
      expect(checked.ok).toBe(false);
      if (!checked.ok) expect(checked.issues[0]?.field).toBe('description');
    }
    const long = parsePublishExistingBody({ ...TASK_BODY, description: 'x'.repeat(5001) });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.issues[0]?.field).toBe('description');
  });

  it('rejects an unknown provider', () => {
    const parsed = parsePublishExistingBody({
      ...TASK_BODY,
      publishing: { ...TASK_BODY.publishing, providers: ['myspace'] },
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
      ...TASK_BODY,
      publishing: {
        ...TASK_BODY.publishing,
        schedule: { startAt: '2026-11-20T18:00:00Z', times: ['18:00'], timezone: 'UTC' },
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

  it('rejects an image for any provider but instagram', () => {
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
      if (!checked.ok) expect(checked.issues[0]?.field).toBe('publishing.providers');
    }
  });

  it('accepts an image for instagram', () => {
    const parsed = parsePublishExistingBody({
      media: { kind: 'image', imageData: JPEG_BASE64, contentType: 'image/jpeg' },
      title: 'Sunset photo',
      description: 'Edited photo, straight to the feed.',
      publishing: { mode: 'asap', providers: ['instagram'], accounts: { instagram: ['ig-1'] } },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(checkPublishExistingSemantics(parsed.value).ok).toBe(true);
  });

  it('requires youtube tags and privacyStatus for ASAP, but not for scheduled', () => {
    const noTags = parsePublishExistingBody({ ...TASK_BODY, tags: undefined, privacyStatus: undefined });
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
      ...TASK_BODY,
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
    // Keep the JPEG magic so only the size check fires.
    big[0] = 0xff;
    big[1] = 0xd8;
    big[2] = 0xff;
    const decoded = decodeImageMedia({ imageData: big.toString('base64'), contentType: 'image/jpeg' });
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.issues[0]?.message).toContain('8 MB');
  });
});
