const OWN_VERCEL_PREVIEW_HOST =
  /^post-enginner-(?:[a-z0-9]{9}|git-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)-ryan-carlosos-projects\.vercel\.app$/;
const DNS_LABEL_MAX_LENGTH = 63;

export function isOwnVercelPreviewHost(hostname: string): boolean {
  const firstLabel = hostname.split('.', 1)[0];
  if (firstLabel.length > DNS_LABEL_MAX_LENGTH) return false;
  return OWN_VERCEL_PREVIEW_HOST.test(hostname);
}
