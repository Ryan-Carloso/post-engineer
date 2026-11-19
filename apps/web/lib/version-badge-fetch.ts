export const VERSION_BADGE_FALLBACK_LABEL = 'BETA';

async function readVersionBody(): Promise<unknown> {
  try {
    const response = await fetch('/api/version', { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

let inflight: Promise<unknown> | null = null;

export function fetchVersionBadgeBody(): Promise<unknown> {
  if (inflight !== null) return inflight;
  const request = readVersionBody().finally(() => {
    if (inflight === request) inflight = null;
  });
  inflight = request;
  return request;
}
