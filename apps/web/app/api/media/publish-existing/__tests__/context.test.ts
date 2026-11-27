// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { fieldsFor } from '../context';
import type { PublishExistingRequest } from '../schema';

function request(overrides: Partial<PublishExistingRequest> = {}): PublishExistingRequest {
  return {
    media: { kind: 'upload', uploadId: '11111111-1111-4111-8111-111111111111' },
    title: 'Porto walk',
    description: 'Walking the riverside at sunset.',
    personaId: null,
    publishing: {
      mode: 'asap',
      providers: ['youtube'],
      accounts: undefined,
      schedule: undefined,
      pinterestBoardId: '123456',
    },
    tags: ['porto'],
    privacyStatus: 'public',
    caption: undefined,
    firstComment: null,
    promptVersionId: undefined,
    idempotencyKey: undefined,
    ...overrides,
  };
}

describe('fieldsFor', () => {
  it('defaults aiLabel to false', () => {
    const fields = fieldsFor(request(), 'youtube', ['acc-1']);
    expect(fields.aiLabel).toBe(false);
  });

  it('passes an explicit aiLabel through', () => {
    const fields = fieldsFor(request(), 'threads', ['acc-1'], true);
    expect(fields.aiLabel).toBe(true);
  });

  it('falls back to the description when the caption is blank', () => {
    const fields = fieldsFor(request({ caption: '   ' }), 'threads', ['acc-1'], true);
    expect(fields.caption).toBe('Walking the riverside at sunset.');
    expect(fields.aiLabel).toBe(true);
  });

  it('keeps a non-blank caption', () => {
    const fields = fieldsFor(request({ caption: '  My caption  ' }), 'threads', ['acc-1'], true);
    expect(fields.caption).toBe('My caption');
    expect(fields.aiLabel).toBe(true);
  });

  it('passes the first comment through to the form fields', () => {
    expect(fieldsFor(request({ firstComment: 'Link in bio' }), 'youtube', ['acc-1']).firstComment).toBe('Link in bio');
    expect(fieldsFor(request(), 'youtube', ['acc-1']).firstComment).toBeNull();
  });
});
