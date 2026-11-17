//---------------
// upload-types — what a signed upload (POST /api/videos/upload-url) may
// carry: a video (MP4/MOV, 2GB) or, for the image networks, an image
// (JPEG/PNG, 8 MB; the same cap as an inline image and every image
// handler). No imports, so the OpenAPI generator (plain Node) imports it
// directly; videos.ts re-exports it for the endpoint contracts.
//---------------

/** Signed video uploads (issue #561): the 2GB ceiling, same as upload-content. */
export const VIDEO_UPLOAD_CONTENT_TYPES = ['video/mp4', 'video/quicktime'] as const;
export type VideoUploadContentType = (typeof VIDEO_UPLOAD_CONTENT_TYPES)[number];
export const MAX_VIDEO_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
/** A signed upload may also carry an image (JPEG/PNG) for the image
 * networks (IMAGE_PROVIDERS), capped like an inline image. */
export const IMAGE_UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png'] as const;
export type ImageUploadContentType = (typeof IMAGE_UPLOAD_CONTENT_TYPES)[number];
export const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;
export const UPLOAD_CONTENT_TYPES = [...VIDEO_UPLOAD_CONTENT_TYPES, ...IMAGE_UPLOAD_CONTENT_TYPES] as const;
export type UploadContentType = (typeof UPLOAD_CONTENT_TYPES)[number];
export const UPLOAD_CONTENT_TYPE_MESSAGE = 'contentType must be video/mp4, video/quicktime, image/jpeg or image/png.';

export function isImageUploadContentType(value: unknown): value is ImageUploadContentType {
  return typeof value === 'string' && (IMAGE_UPLOAD_CONTENT_TYPES as readonly string[]).includes(value);
}
