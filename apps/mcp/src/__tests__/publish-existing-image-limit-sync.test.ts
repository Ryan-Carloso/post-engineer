import { describe, it, expect } from 'vitest';

import { MAX_IMAGE_UPLOAD_BYTES } from '../contracts/videos.js';
import { MAX_SEGMENT_MEDIA_BYTES } from '../limits.js';

//---------------
// publish_existing reads a local image with the MCP's photo limit
// (readLocalImage, MAX_SEGMENT_MEDIA_BYTES) and the web rejects an image
// over MAX_IMAGE_UPLOAD_BYTES (shared/contracts/videos.ts: the inline
// image, the image signed upload and every image handler use it). The two
// must be the same number, or the MCP would read a file the server then
// refuses (or refuse one the server takes).
//---------------

describe('publish_existing image size limit', () => {
  it('matches the shared MAX_IMAGE_UPLOAD_BYTES', () => {
    expect(MAX_IMAGE_UPLOAD_BYTES).toBe(8 * 1024 * 1024);
    expect(MAX_SEGMENT_MEDIA_BYTES).toBe(MAX_IMAGE_UPLOAD_BYTES);
  });
});
