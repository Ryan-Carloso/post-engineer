export const CLIP_DENSITY_ITEMS = 4;

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

export function clipDensityMinCount(media: readonly unknown[]): number {
  const clips = media.filter((item) => isVideoRef(item)).length;
  return media.length + (CLIP_DENSITY_ITEMS - 1) * clips;
}
