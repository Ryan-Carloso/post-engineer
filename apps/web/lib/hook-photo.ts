/**
 * The hook photo (issue #589): the lip-sync hook opens with the first
 * photo of the video, not the persona avatar. The web pre-charge face
 * preflight and the post detail both derive it from the slot's segments
 * with this one definition — the first photo across segments in
 * order — mirroring the engine's first_segment_media in
 * apps/engine/app/services/user_media.py. A video clip is never the hook
 * photo: clips are skipped, like the engine (segment_video.is_video_ref).
 * A segment media item carries either a mediaId (an engine temp asset,
 * 1h TTL, no durable web URL) or a url. When an item carries both, the
 * mediaId wins: the engine resolves the temp asset first, and the
 * pre-charge face check and the post detail follow the same order.
 */

export interface SegmentMediaRef {
  segmentIndex: number;
  imageIndex: number;
  mediaId?: string;
  url?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// True when a segment media item references a video clip, by its suffix
// — mirroring the engine's segment_video.is_video_ref. The mediaId wins
// when present; otherwise the URL path decides (query and fragment are
// not part of the path). A suffix is admission only: ffprobe is the
// content gate.
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

export type HookPhotoSource = 'segment' | 'persona' | 'upload';

export interface HookPhoto {
  /** Direct URL when the first photo came from a URL; null otherwise. */
  url: string | null;
  /** 'segment': a URL photo from the video. 'upload': a mediaId upload
   *  (an engine temp asset, no durable web URL). 'persona': no segment
   *  photo, so the hook fell back to the persona reference photo. */
  source: HookPhotoSource;
  /** 0-based position of the first photo; null when source is 'persona'. */
  segmentIndex: number | null;
  imageIndex: number | null;
}

export function hookPhotoForSegments(segments: unknown): HookPhoto {
  const first = firstSegmentMedia(segments);
  if (first === null) return { url: null, source: 'persona', segmentIndex: null, imageIndex: null };
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

//---------------
// narrowHookPhoto — the payload crosses a network boundary, so a slot row
// predating the field — or a malformed entry — reads as the persona
// fallback instead of handing the UI an undefined it would have to guard
// at every render. Same defensive pattern as narrowPublishLinks in
// lib/slot-detail.ts. The url is an <img> src, not a navigation surface,
// so it is kept as any string (unlike publish links, which must be
// https). Only a 'segment' source carries a url or indices: any other
// source normalizes to the shape the server produces for it.
//---------------
export function narrowHookPhoto(value: unknown): HookPhoto {
  const fallback: HookPhoto = {
    url: null,
    source: 'persona',
    segmentIndex: null,
    imageIndex: null,
  };
  if (typeof value !== 'object' || value === null) return fallback;
  const record = value as Record<string, unknown>;
  const source = record.source;
  if (source !== 'segment' && source !== 'persona' && source !== 'upload') return fallback;
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
