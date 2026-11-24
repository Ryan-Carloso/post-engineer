export interface SegmentMediaRef {
  segmentIndex: number;
  imageIndex: number;
  mediaId?: string;
  url?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVideoRef(mediaId: string | undefined, url: string | undefined): boolean {
  if (mediaId !== undefined) return mediaId.toLowerCase().endsWith('.mp4');
  if (url !== undefined) {
    const path = url.split(/[?#]/, 1)[0] ?? '';
    return path.toLowerCase().endsWith('.mp4');
  }
  return false;
}

export function firstSegmentMedia(segments: unknown): SegmentMediaRef | null {
  if (!Array.isArray(segments)) return null;
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    if (!isRecord(segment) || !Array.isArray(segment.media)) continue;
    for (let imageIndex = 0; imageIndex < segment.media.length; imageIndex += 1) {
      const item = segment.media[imageIndex];
      if (!isRecord(item)) continue;
      const mediaId =
        typeof item.mediaId === 'string' && item.mediaId !== '' ? item.mediaId : undefined;
      const url = typeof item.url === 'string' && item.url !== '' ? item.url : undefined;
      if (mediaId === undefined && url === undefined) continue;
      if (isVideoRef(mediaId, url)) continue;
      return { segmentIndex, imageIndex, mediaId, url };
    }
  }
  return null;
}

export type HookPhotoSource = 'segment' | 'upload' | 'none';

export interface HookPhoto {
  url: string | null;
  source: HookPhotoSource;
  segmentIndex: number | null;
  imageIndex: number | null;
}

export function hookPhotoForSegments(segments: unknown): HookPhoto {
  const first = firstSegmentMedia(segments);
  if (first === null) return { url: null, source: 'none', segmentIndex: null, imageIndex: null };
  if (first.mediaId !== undefined) {
    return { url: null, source: 'upload', segmentIndex: first.segmentIndex, imageIndex: first.imageIndex };
  }
  if (first.url !== undefined) {
    return {
      url: first.url,
      source: 'segment',
      segmentIndex: first.segmentIndex,
      imageIndex: first.imageIndex,
    };
  }
  return { url: null, source: 'upload', segmentIndex: first.segmentIndex, imageIndex: first.imageIndex };
}

export function narrowHookPhoto(value: unknown): HookPhoto {
  const fallback: HookPhoto = {
    url: null,
    source: 'none',
    segmentIndex: null,
    imageIndex: null,
  };
  if (typeof value !== 'object' || value === null) return fallback;
  const record = value as Record<string, unknown>;
  const source = record.source;
  if (source !== 'segment' && source !== 'upload' && source !== 'none') return fallback;
  const index = (key: string): number | null =>
    typeof record[key] === 'number' && Number.isFinite(record[key])
      ? (record[key] as number)
      : null;
  if (source === 'segment') {
    return {
      url: typeof record.url === 'string' ? record.url : null,
      source,
      segmentIndex: index('segmentIndex'),
      imageIndex: index('imageIndex'),
    };
  }
  return {
    url: null,
    source,
    segmentIndex: source === 'upload' ? index('segmentIndex') : null,
    imageIndex: source === 'upload' ? index('imageIndex') : null,
  };
}
