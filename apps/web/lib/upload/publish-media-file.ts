import crypto from 'crypto';
import { MAX_IMAGE_UPLOAD_BYTES } from '@/lib/contracts/videos';
import { presignPublishMedia, uploadPublishMedia } from '@/lib/upload/publish-media';

export { MAX_IMAGE_UPLOAD_BYTES };

export type PublishMediaFile =
  | { kind: 'video'; contentType: 'video/mp4' | 'video/quicktime'; extension: 'mp4' | 'mov'; buffer: Buffer }
  | { kind: 'image'; contentType: 'image/jpeg' | 'image/png'; extension: 'jpg' | 'png'; buffer: Buffer };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sniffPublishMedia(buffer: Buffer, declaredType: string): PublishMediaFile | null {
  if (buffer.length >= 8 && buffer.subarray(4, 8).toString('latin1') === 'ftyp') {
    return declaredType === 'video/quicktime'
      ? { kind: 'video', contentType: 'video/quicktime', extension: 'mov', buffer }
      : { kind: 'video', contentType: 'video/mp4', extension: 'mp4', buffer };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { kind: 'image', contentType: 'image/jpeg', extension: 'jpg', buffer };
  }
  if (buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return { kind: 'image', contentType: 'image/png', extension: 'png', buffer };
  }
  return null;
}

export type StagedPublishMedia =
  | { ok: true; kind: 'video' | 'image'; url: string; usedArchive: boolean }
  | { ok: false; error: string };

export interface StagePublishMediaInput {
  provider: 'threads' | 'facebook';
  label: string;
  rawFile: FormDataEntryValue | null;
  storagePathRaw: FormDataEntryValue | null;
  ownerUserId: string;
  maxVideoBytes: number;
  maxVideoLabel: string;
}

export async function stagePublishMedia(input: StagePublishMediaInput): Promise<StagedPublishMedia> {
  const { rawFile, storagePathRaw, ownerUserId } = input;
  if (storagePathRaw !== null) {
    if (typeof storagePathRaw !== 'string' || storagePathRaw.trim() === '') {
      return { ok: false, error: 'videoStoragePath must be a string' };
    }
    if (rawFile instanceof File) return { ok: false, error: 'Send either a file or videoStoragePath, not both' };
    const objectKey = storagePathRaw.trim();
    if (!objectKey.startsWith(`${ownerUserId}/`)) return { ok: false, error: 'videoStoragePath must belong to this user' };
    return { ok: true, kind: 'video', url: await presignPublishMedia(objectKey), usedArchive: true };
  }
  if (!(rawFile instanceof File)) return { ok: false, error: 'A video or image file is required' };
  if (rawFile.size > input.maxVideoBytes) return { ok: false, error: `Video exceeds the ${input.label} ${input.maxVideoLabel} limit` };
  const media = sniffPublishMedia(Buffer.from(await rawFile.arrayBuffer()), rawFile.type);
  if (media === null) return { ok: false, error: 'File must be an MP4 or MOV video, or a JPEG or PNG image' };
  if (media.kind === 'image' && media.buffer.length > MAX_IMAGE_UPLOAD_BYTES) {
    return { ok: false, error: `Image exceeds the ${MAX_IMAGE_UPLOAD_BYTES / (1024 * 1024)} MB limit` };
  }
  const storagePath = `${input.provider}/${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${media.extension}`;
  const url = await uploadPublishMedia(media.buffer, storagePath, media.contentType);
  return { ok: true, kind: media.kind, url, usedArchive: false };
}
