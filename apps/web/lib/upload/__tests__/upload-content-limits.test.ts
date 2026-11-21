import { describe, expect, it } from 'vitest';

import { LINKEDIN_VIDEO_MAX_BYTES } from '@/lib/linkedin';
import { MAX_FILE_SIZE } from '@/lib/media/upload-schema';
import { MULTIPART_OVERHEAD_BYTES } from '@/lib/upload/bounded-form-data';
import {
  PROVIDER_FILE_CAPS_BYTES,
  UPLOAD_CONTENT_MAX_BODY_BYTES,
} from '@/lib/upload/upload-content-limits';

describe('UPLOAD_CONTENT_MAX_BODY_BYTES', () => {
  it('is the largest provider file cap plus the multipart overhead', () => {
    expect(UPLOAD_CONTENT_MAX_BODY_BYTES).toBe(LINKEDIN_VIDEO_MAX_BYTES + MULTIPART_OVERHEAD_BYTES);
  });

  it('leaves room for every provider cap', () => {
    for (const cap of PROVIDER_FILE_CAPS_BYTES) {
      expect(UPLOAD_CONTENT_MAX_BODY_BYTES).toBeGreaterThan(cap);
    }
    expect(PROVIDER_FILE_CAPS_BYTES).toContain(MAX_FILE_SIZE);
  });
});
