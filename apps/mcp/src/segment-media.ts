// Video-clip references in segment media: single source of truth for the
// web app and the MCP server, for the clips a segment may carry.
// DO NOT EDIT this copy directly in apps/web or apps/mcp: the files at
// apps/web/lib/generation/segment-media.ts and
// apps/mcp/src/segment-media.ts are generated copies of this file.
// Edit here, then run `node scripts/sync-script-segments.mjs` from the
// repo root (both apps also run it from their prebuild/pretest scripts).
// Mirrors apps/engine/app/services/segment_video.py: same clip rule (a
// .mp4 suffix on the mediaId, else on the URL path) and the same density
// credit (one clip stands in for CLIP_DENSITY_ITEMS photos).

// A video clip covers ~12s of speech, not one 3s photo slot: one clip
// counts as this many items for the density minimum only (the maximum
// still counts items one for one). Same number as CLIP_DENSITY_ITEMS in
// apps/engine/app/services/segment_video.py.
export const CLIP_DENSITY_ITEMS = 4;

// True when a segment media item references a video clip, by its
// suffix — mirroring the engine's segment_video.is_video_ref. The
// mediaId wins when present; otherwise the URL path decides (query and
// fragment are not part of the path).
export function isVideoRef(media: unknown): boolean {
  if (typeof media !== 'object' || media === null || Array.isArray(media)) return false;
  const record = media as Record<string, unknown>;
  const mediaId = record['mediaId'];
  if (typeof mediaId === 'string' && mediaId.length > 0) {
    return mediaId.toLowerCase().endsWith('.mp4');
  }
  const url = record['url'];
  if (typeof url === 'string' && url.length > 0) {
    const path = url.split(/[?#]/, 1)[0] ?? '';
    return path.toLowerCase().endsWith('.mp4');
  }
  return false;
}

// The density minimum a segment's media counts as: each video clip
// stands in for CLIP_DENSITY_ITEMS photos, because a clip covers ~12s
// of speech, not one 3s photo slot. The maximum still counts items one
// for one.
export function clipDensityMinCount(media: readonly unknown[]): number {
  const clips = media.filter((item) => isVideoRef(item)).length;
  return media.length + (CLIP_DENSITY_ITEMS - 1) * clips;
}
