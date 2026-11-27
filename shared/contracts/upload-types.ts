export const VIDEO_UPLOAD_CONTENT_TYPES = ['video/mp4', 'video/quicktime'] as const;
export type VideoUploadContentType = (typeof VIDEO_UPLOAD_CONTENT_TYPES)[number];
export const MAX_VIDEO_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const IMAGE_UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png'] as const;
type ImageUploadContentType = (typeof IMAGE_UPLOAD_CONTENT_TYPES)[number];
export const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;
export const UPLOAD_CONTENT_TYPES = [...VIDEO_UPLOAD_CONTENT_TYPES, ...IMAGE_UPLOAD_CONTENT_TYPES] as const;
export type UploadContentType = (typeof UPLOAD_CONTENT_TYPES)[number];
export const UPLOAD_CONTENT_TYPE_MESSAGE = 'contentType must be video/mp4, video/quicktime, image/jpeg or image/png.';

export function isImageUploadContentType(value: unknown): value is ImageUploadContentType {
  return typeof value === 'string' && (IMAGE_UPLOAD_CONTENT_TYPES as readonly string[]).includes(value);
}
