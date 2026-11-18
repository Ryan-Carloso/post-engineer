import { describe, it, expect } from 'vitest';

import { MAX_IMAGE_UPLOAD_BYTES } from '../contracts/videos.js';
import { MAX_SEGMENT_MEDIA_BYTES } from '../limits.js';

describe('publish_existing image size limit', () => {
  it('matches the shared MAX_IMAGE_UPLOAD_BYTES', () => {
    expect(MAX_IMAGE_UPLOAD_BYTES).toBe(8 * 1024 * 1024);
    expect(MAX_SEGMENT_MEDIA_BYTES).toBe(MAX_IMAGE_UPLOAD_BYTES);
  });
});
