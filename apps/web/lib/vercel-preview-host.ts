export const VERCEL_PREVIEW_HOST_SUFFIX = '-ryan-carlosos-projects.vercel.app';
const VERCEL_PREVIEW_HOST_PREFIX = 'post-enginner-';

export function isOwnVercelPreviewHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return (
    host.startsWith(VERCEL_PREVIEW_HOST_PREFIX) &&
    host.endsWith(VERCEL_PREVIEW_HOST_SUFFIX)
  );
}
